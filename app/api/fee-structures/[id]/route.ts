// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Structure Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup → read / update with
//          nested components → response.
// ACCESS : GET   — UNIVERSITY_ADMIN · FACULTY
//          PATCH — UNIVERSITY_ADMIN
//          STUDENT and PARENT have no access to fee structures.
// BACKEND: Prisma
// PURPOSE: View a single fee structure with its components, and edit the
//          structure together with them.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import {
  feeStructureIdParamSchema,
  updateFeeStructureSchema,
} from "@/lib/validations/fee-structure";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for each component of the structure.
 *
 * FeeComponent has no updatedAt column, so createdAt is the only timestamp there
 * is to report — the same situation as CurriculumSubject.
 *
 * amount and taxPercent are Decimal columns. Prisma's Decimal defines its own
 * toJSON and serialises to a string, so the shared serialize() helper is not
 * needed — it exists for BigInt, which this model does not carry. As elsewhere
 * the string form is normalised, so a stored 150000.00 is returned as "150000".
 */
const FEE_COMPONENT_SELECT = {
  id: true,
  feeStructureId: true,
  name: true,
  type: true,
  amount: true,
  isOptional: true,
  isTaxable: true,
  taxPercent: true,
  createdAt: true,
} as const;

/**
 * Ordering applied to the nested components.
 *
 * Declared separately and typed with `satisfies` rather than `as const`, exactly
 * as SUBJECT_ORDER_BY is in the curriculum detail route: the SELECT constants are
 * frozen with `as const` to keep their `true` literals from widening to
 * `boolean`, but `as const` would also make this array `readonly`, and Prisma's
 * orderBy input is a mutable array.
 *
 * FeeComponent carries no ordinal column — nothing like CurriculumSubject's
 * semesterNumber — so there is no domain order to apply and the row's own
 * creation order is used. createdAt alone is not deterministic, because every
 * component of a structure is written by a single nested create and so shares a
 * timestamp; the id tiebreaker is what makes the list stable between requests.
 */
const FEE_COMPONENT_ORDER_BY = [
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.FeeComponentOrderByWithRelationInput[];

/**
 * Columns returned for a fee structure detail. Declared once so both handlers
 * answer with the same shape.
 *
 * Unlike FEE_STRUCTURE_SELECT in the collection route, this select expands the
 * components. That is the project's collection/detail split: CURRICULUM_SELECT
 * omits its subjects on app/api/curricula/route.ts and nests them on
 * app/api/curricula/[id]/route.ts, and the README describes this endpoint the
 * same way — "Manage structure + components".
 *
 * No other relation is expanded. FeeStructure also declares a demands relation,
 * which is left alone: a fee demand is a separate resource with its own README
 * endpoints, and a structure may accumulate one per student, so nesting it would
 * make this response unbounded. FeeStructure declares no relation at all for
 * programmeId, batchId or academicYearId, so those three could not be expanded
 * even if the convention allowed it.
 */
const FEE_STRUCTURE_DETAIL_SELECT = {
  id: true,
  tenantId: true,
  programmeId: true,
  batchId: true,
  academicYearId: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  components: {
    select: FEE_COMPONENT_SELECT,
    orderBy: FEE_COMPONENT_ORDER_BY,
  },
} as const;

/**
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so an unknown id and one owned by another tenant
 * cannot drift apart: both produce the identical status, code and message, byte
 * for byte. A distinguishable response would confirm that a given id exists
 * somewhere.
 */
function feeStructureNotFound(): NextResponse {
  return NextResponse.json(fail("Fee structure not found", "NOT_FOUND"), { status: 404 });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A single requireRole call decides
//              access — both roles read the same row, and a fee structure carries
//              no publication or visibility concept in the schema, so nothing
//              narrows either role's scope.
// VALIDATION : feeStructureIdParamSchema — the [id] segment must be non-empty
//              once trimmed. FeeStructure.id is a cuid, not a UUID, so no format
//              assertion is applied; an unrecognised-but-well-formed id is a 404
//              rather than a 400. No query parameters are read: this addresses a
//              single resource, and the nested components are returned whole
//              rather than paged — a structure's component list is bounded by the
//              fees it charges, not by tenant growth.
// FLOW       : Authorise → resolve tenant → read the structure filtered by BOTH
//              id and tenantId, with its components.
//
//              findFirst, never findUnique(id). The tenant filter is part of the
//              lookup itself rather than a check applied to a row already
//              fetched, so another tenant's structure is never loaded, never
//              acknowledged and cannot leak through a mistake in a later branch.
//              FeeStructure carries no foreign key on any column — not even on
//              tenantId — so this predicate is the only record of ownership the
//              read has.
//
//              The components need no tenant predicate of their own: they are
//              reached through the structure, and FeeComponent.feeStructureId is
//              a real foreign key, so a component can only belong to the row it
//              hangs from.
//
//              A structure with no components returns 200 with components: [],
//              not a 404 — the structure exists and is readable; it simply
//              charges nothing yet.
// RESPONSE   : { success: true, data: <FeeStructure with components> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = feeStructureIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const feeStructure = await prisma.feeStructure.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: FEE_STRUCTURE_DETAIL_SELECT,
    });

    if (!feeStructure) {
      return feeStructureNotFound();
    }

    return NextResponse.json(ok(feeStructure));
  } catch (err) {
    console.error("[GET /api/fee-structures/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN only. A caller holding FACULTY reads fee
//              structures but does not edit them, so a faculty member receives
//              the guard's 403 — the same 403 any other unpermitted role
//              receives, and the same split the collection route applies.
// VALIDATION : feeStructureIdParamSchema for the [id] segment,
//              updateFeeStructureSchema for the body. Every field optional but at
//              least one required, so an empty body is a client error rather than
//              a silent no-op that would still advance updatedAt.
//
//              Mutable: programmeId, batchId, academicYearId, name, description,
//              isActive and components.
//
//              id, tenantId, createdAt and updatedAt are absent from the create
//              schema, so .partial() cannot introduce them — a structure can
//              never be moved between tenants through this endpoint. A component's
//              id, feeStructureId and createdAt are absent for the same reason.
// FLOW       : Authorise → resolve tenant → validate param and body → prove the
//              structure belongs to this tenant → revalidate any changed
//              reference → apply one nested update.
//
//              Each of programmeId, batchId and academicYearId is revalidated
//              only when supplied, tenant-scoped, exactly as on create. All three
//              lookups are skipped when none is present, so a name-only edit
//              costs no extra reads. That check is the only protection any of
//              them has: FeeStructure declares no relation for them and the
//              migration emits no foreign key for the model at all. An unknown id
//              and one owned by another tenant return the identical 404 for each,
//              and precedence follows the schema's column order — programme, then
//              batch, then academic year.
//
//              COMPONENTS. The body carries no component id: feeComponentSchema
//              omits it deliberately, so a supplied element cannot address an
//              existing row. A supplied array is therefore the complete new set,
//              and the update replaces what is stored — deleteMany followed by
//              create, both nested inside the same prisma.feeStructure.update, so
//              Prisma issues them in one transaction and the structure is never
//              observable without its components. Supplying [] removes every
//              component; omitting the key entirely leaves the stored set exactly
//              as it was. Replacement is not a policy choice — it is the only
//              operation the accepted body can express, because nothing in it
//              identifies a row to amend.
//
//              Component ids are therefore not stable across a components-bearing
//              PATCH: a replaced set is a new set of rows. Nothing in the schema
//              or the README treats a component id as durable — FeeDemand
//              references the structure, not its components — so no reference is
//              broken by this.
//
//              No uniqueness is inferred and no total is calculated. Neither
//              FeeStructure nor FeeComponent declares a unique constraint, so two
//              structures with the same name, and two components of the same name
//              and type within one structure, are both permitted exactly as the
//              database permits them. No lifecycle rule is applied: isActive is a
//              plain writable boolean with no transition rules anywhere, and
//              nothing here generates a demand, applies a waiver or touches
//              payment.
// RESPONSE   : { success: true, data: <FeeStructure with components>,
//                message: "Fee structure updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable: neither model
//              declares a unique constraint on any column or combination, so
//              Prisma cannot raise P2002 here. It is mapped only from a real
//              Prisma conflict, never from an application rule.
//
//              No foreign-key branch is handled, and none is reachable.
//              FeeStructure has no foreign key on any column, so a programme,
//              batch or academic year deleted between its check and the write
//              leaves a dangling id rather than raising anything. The only
//              foreign key involved is FeeComponent.feeStructureId, which points
//              at the row being updated. P2025 remains the race backstop: if the
//              structure is removed between the lookup and the update, that is
//              reported as the same 404 the lookup would have produced.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = feeStructureIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = updateFeeStructureSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const feeStructureId = parsedParams.data.id;
    const { components, ...scalars } = parsedBody.data;

    const existing = await prisma.feeStructure.findFirst({
      where: { id: feeStructureId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return feeStructureNotFound();
    }

    // All three lookups are skipped when nothing is being re-scoped, so a
    // name-only edit costs no extra reads. When a reference is supplied it is
    // re-proven against this tenant, exactly as on create.
    const [programme, batch, academicYear] = await Promise.all([
      scalars.programmeId === undefined
        ? Promise.resolve(null)
        : prisma.programme.findFirst({
            where: { id: scalars.programmeId, tenantId: tenant.id },
            select: { id: true },
          }),
      scalars.batchId === undefined
        ? Promise.resolve(null)
        : prisma.batch.findFirst({
            where: { id: scalars.batchId, tenantId: tenant.id },
            select: { id: true },
          }),
      scalars.academicYearId === undefined
        ? Promise.resolve(null)
        : prisma.academicYear.findFirst({
            where: { id: scalars.academicYearId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order.
    if (scalars.programmeId !== undefined && !programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (scalars.batchId !== undefined && !batch) {
      return NextResponse.json(fail("Batch not found", "NOT_FOUND"), { status: 404 });
    }

    if (scalars.academicYearId !== undefined && !academicYear) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. The nested deleteMany and create
    // run inside this single update, which Prisma issues as one transaction, so
    // the component set is replaced atomically and never observed half-written.
    // The nested clause is omitted entirely when the key was absent, leaving the
    // stored components untouched.
    const feeStructure = await prisma.feeStructure.update({
      where: { id: feeStructureId, tenantId: tenant.id },
      data: {
        ...scalars,
        ...(components === undefined
          ? {}
          : {
              components: {
                deleteMany: {},
                ...(components.length > 0 ? { create: components } : {}),
              },
            }),
      },
      select: FEE_STRUCTURE_DETAIL_SELECT,
    });

    return NextResponse.json(ok(feeStructure, "Fee structure updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — neither FeeStructure nor FeeComponent declares a
      // unique constraint — but mapped so a real constraint violation would never
      // surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Fee structure already exists", "CONFLICT"), { status: 409 });
      }

      // The structure was deleted between the lookup and the update.
      if (isRecordNotFound(err)) {
        return feeStructureNotFound();
      }
    }

    console.error("[PATCH /api/fee-structures/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

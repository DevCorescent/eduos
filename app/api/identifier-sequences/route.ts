// ============================================================================
// OWNER  : Gauransh
// MODULE : Identifier Engine — Sequence Configuration (PRD §9)
// FLOW   : Guard → tenant → validate → tenant-scoped read/write → response.
// ACCESS : UNIVERSITY_ADMIN only, and only for their own institution.
// BACKEND: Prisma
// PURPOSE: List and create the identifier sequences one university issues from.
//
// WHY THERE IS NO "GENERATE" ENDPOINT HERE
//   Issuing an identifier is a side effect of creating a record, never a
//   request a client makes on its own. A public generate endpoint would let a
//   caller burn numbers without creating anything — inflating a register's
//   sequence, and on a certificate series producing gaps an auditor would have
//   to explain. Generation is reachable only through generateIdentifier(),
//   called inside the transaction that creates the entity.
//
// WHY UNIVERSITY_ADMIN AND NOT SUPER_ADMIN
//   IdSequence carries a tenantId and configures one institution's numbering.
//   PRD §5.5 gives the platform owner global MASTERS — currencies, languages,
//   document types — not another university's enrolment format. A registrar
//   owns their own numbering, so the guard is the same pair /api/users uses:
//   requireRole("UNIVERSITY_ADMIN") then requireTenant(), which together mean a
//   caller can only ever reach rows their own session's tenant owns.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { createIdSequenceSchema } from "@/lib/validations/identifier";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a sequence.
 *
 * `lastSequence` IS exposed: a registrar needs to know where the counter
 * stands before changing a format, and it is not a secret — it is visible on
 * the most recent record the sequence issued.
 */
const SEQUENCE_SELECT = {
  id: true,
  tenantId: true,
  entityType: true,
  scopeKey: true,
  prefix: true,
  suffix: true,
  format: true,
  padding: true,
  lastSequence: true,
  resetCycle: true,
  lastResetYear: true,
  lastResetMonth: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : None. The collection is bounded by the entity union — at most a
//              handful of rows per tenant — so it is returned whole rather than
//              paginated. A pagination envelope on a four-row table is a
//              contract to maintain for no benefit.
// RESPONSE   : { success: true, data: { sequences } }
// STATUS     : 200 · 401 · 403 · 404 · 500
export async function GET() {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const sequences = await prisma.idSequence.findMany({
      where: { tenantId: tenantGuard.tenant.id },
      select: SEQUENCE_SELECT,
      orderBy: [{ entityType: "asc" }, { scopeKey: "asc" }],
    });

    return NextResponse.json(ok({ sequences }));
  } catch (err) {
    console.error("[GET /api/identifier-sequences]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createIdSequenceSchema — entityType from the closed union,
//              format must contain {SEQ} and may reference only known tokens,
//              padding 0–12. tenantId is NOT accepted from the body; it comes
//              from the resolved tenant, so a caller cannot configure another
//              institution's numbering by naming it.
//
//              lastSequence is absent from the schema, so a new sequence always
//              starts at 0 and issues 1 first. Seeding a counter mid-series is
//              a migration concern, not a create-form field.
// RESPONSE   : { success: true, data: <sequence>, message }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createIdSequenceSchema.safeParse(body);
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

    const sequence = await prisma.idSequence.create({
      data: { ...parsed.data, tenantId: tenantGuard.tenant.id },
      select: SEQUENCE_SELECT,
    });

    return NextResponse.json(ok(sequence, "Sequence created"), { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_VIOLATION
    ) {
      // (tenantId, entityType, scopeKey) already exists. Reported as a conflict
      // rather than silently updating the existing row: a second sequence for
      // one entity would issue numbers the first has already used, and an
      // upsert here would overwrite a live counter's format without saying so.
      return NextResponse.json(
        fail("A sequence already exists for this entity and scope", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[POST /api/identifier-sequences]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

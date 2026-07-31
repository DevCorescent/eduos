// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Demand Waiver
// FLOW   : Guard → tenant → param → body → tenant-scoped lookup → single-column
//          update → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT have no access to
//          waivers.
// BACKEND: Prisma
// PURPOSE: Record a waived amount against a single fee demand.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import {
  feeDemandIdParamSchema,
  waiveFeeDemandSchema,
} from "@/lib/validations/fee-demand";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a fee demand.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded. FeeDemand declares student, semester, feeStructure and
 * payments relations; none is taken. payments in particular is left alone —
 * reading it would be the first step of a balance calculation, which this
 * endpoint does not perform.
 *
 * totalAmount, paidAmount and waivedAmount are reported exactly as stored. No
 * outstanding balance is derived from them here or anywhere else: no source
 * defines whether a balance is total minus paid, total minus paid minus waived,
 * or something else.
 *
 * All three are Decimal columns. Prisma's Decimal defines its own toJSON and
 * serialises to a string, so the shared serialize() helper is not needed — it
 * exists for BigInt, which this model does not carry.
 */
const FEE_DEMAND_SELECT = {
  id: true,
  tenantId: true,
  studentId: true,
  semesterId: true,
  feeStructureId: true,
  dueDate: true,
  totalAmount: true,
  paidAmount: true,
  waivedAmount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The single 404 this route answers with.
 *
 * Built here rather than inline so an unknown id, one owned by another tenant,
 * and one deleted between the lookup and the write all produce the identical
 * status, code and message, byte for byte. A distinguishable response would
 * confirm that a given id exists somewhere.
 */
function feeDemandNotFound(): NextResponse {
  return NextResponse.json(fail("Fee demand not found", "NOT_FOUND"), { status: 404 });
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN only. A caller holding FACULTY reads fee demands
//              but does not waive them, so a faculty member receives the guard's
//              403 — the same 403 any other unpermitted role receives.
// VALIDATION : feeDemandIdParamSchema for the [id] segment — non-empty once
//              trimmed. FeeDemand.id is a cuid, not a UUID, so no format
//              assertion is applied; an unrecognised-but-well-formed id is a 404
//              rather than a 400.
//
//              waiveFeeDemandSchema for the body — waivedAmount only, required,
//              bounded to the precision its Decimal(10, 2) column declares and to
//              non-negative values. It is the sole writable field, so an empty
//              body fails validation without needing an at-least-one-key refine.
//              Every other column is absent from the schema and so is stripped
//              from any body that supplies it.
//
//              Both are parsed before any database work is done, so a malformed
//              request costs no reads.
// FLOW       : Authorise → resolve tenant → validate param and body → prove the
//              demand belongs to this tenant → write one column.
//
//              findFirst, never findUnique(id). The tenant filter is part of the
//              lookup itself rather than a check applied to a row already
//              fetched, so another tenant's demand is never loaded, never
//              acknowledged and cannot leak through a mistake in a later branch.
//              FeeDemand.tenantId carries no foreign key, so that predicate is
//              the only record of ownership the read has.
//
//              The update writes waivedAmount and nothing else. totalAmount,
//              paidAmount, status, dueDate, studentId, semesterId,
//              feeStructureId, tenantId and createdAt are all absent from the
//              data, so their stored values are left exactly as they were.
//              updatedAt moves because the column is @updatedAt and the row
//              changed; that is the schema's own behaviour, not an assignment
//              made here.
//
//              No rule beyond the column's own type is applied. The supplied
//              amount replaces whatever was stored — it is not added to a
//              previous waiver, not capped against totalAmount, not reduced by
//              paidAmount and not expressed as a percentage. Nothing in the
//              schema relates the three money columns, and the README defines no
//              waiver policy, so none is invented.
//
//              No status transition is performed. FeeStatus.WAIVED exists, but no
//              source states when a demand enters it — whether a full waiver
//              qualifies, whether a partial one does, or how a waiver interacts
//              with PARTIAL and PAID — so status is neither read as a guard nor
//              written. Equally, paidAmount is untouched and no payment is
//              recalculated: the waiver is recorded, and what it means for the
//              balance is left to whoever computes one.
//
//              Nothing records who waived, when, why, or what the previous value
//              was. FeeDemand carries no column for any of those, so no approval,
//              reason, timestamp or history is written. A waiver overwrites the
//              previous figure and leaves no trace of it.
// RESPONSE   : { success: true, data: <FeeDemand>, message: "Waiver applied" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No conflict status is reachable and none is handled. FeeDemand
//              declares no unique constraint on any column or combination, and
//              waivedAmount participates in none, so Prisma cannot raise P2002
//              here. No lifecycle transition can be refused either, because none
//              is attempted. P2025 is the race backstop: if the demand is removed
//              between the lookup and the write, that is reported as the same 404
//              the lookup would have produced.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = feeDemandIdParamSchema.safeParse(await params);
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

    const parsedBody = waiveFeeDemandSchema.safeParse(body);
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

    const feeDemandId = parsedParams.data.id;
    const { waivedAmount } = parsedBody.data;

    // Ownership is proven before anything is written. A foreign or unknown id
    // stops here and no write is issued at all.
    const existing = await prisma.feeDemand.findFirst({
      where: { id: feeDemandId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return feeDemandNotFound();
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own. waivedAmount is the only key in the data, so every
    // other column keeps its stored value; updatedAt moves because the column is
    // @updatedAt.
    const feeDemand = await prisma.feeDemand.update({
      where: { id: feeDemandId, tenantId: tenant.id },
      data: { waivedAmount },
      select: FEE_DEMAND_SELECT,
    });

    return NextResponse.json(ok(feeDemand, "Waiver applied"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The demand was deleted between the lookup and the update. Reported as the
      // same 404 the lookup would have produced, so a losing racer and an unknown
      // id are indistinguishable.
      if (isRecordNotFound(err)) {
        return feeDemandNotFound();
      }
    }

    console.error("[PATCH /api/fee-demands/[id]/waive]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Identifier Engine — Sequence Configuration, one row (PRD §9)
// FLOW   : Guard → tenant → param → body → tenant-scoped update → response.
// ACCESS : UNIVERSITY_ADMIN only, own institution only.
// BACKEND: Prisma
// PURPOSE: Change how one sequence formats, or retire it.
//
// THE COUNTER CANNOT BE MOVED FROM HERE
//   updateIdSequenceSchema does not accept lastSequence, and neither does this
//   handler. Rewinding a counter reissues identifiers already printed on
//   certificates and quoted in transcripts — the single change to this table
//   that can corrupt records which have already left the institution. Changing
//   a prefix must never be able to do that as a side effect.
//
//   The same reasoning removes DELETE. Deleting a sequence loses lastSequence;
//   recreating it starts at zero and reissues a whole series. `isActive: false`
//   stops it issuing while keeping the counter, which is what "retire" actually
//   means here.
//
// ENTITY AND SCOPE ARE IMMUTABLE
//   They form the unique key that the atomic issue statement locks on. Moving a
//   live counter to a different entity would hand its numbers to records of
//   another kind, so both are absent from the update contract; a different
//   entity needs a different sequence.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  idSequenceParamSchema,
  updateIdSequenceSchema,
} from "@/lib/validations/identifier";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

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

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : idSequenceParamSchema for [id]; updateIdSequenceSchema for the
//              body, which is strict and requires at least one field — an
//              empty PATCH that answered 200 would report a change nobody made.
// FLOW       : updateMany scoped by BOTH id and tenantId, so a caller holding
//              another institution's sequence id updates zero rows and receives
//              404. Reading first and comparing tenants would answer the same
//              way but leaks existence through timing; this cannot.
// RESPONSE   : { success: true, data: <sequence>, message }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = idSequenceParamSchema.safeParse(await context.params);
    if (!parsedParam.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = updateIdSequenceSchema.safeParse(body);
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

    // Tenant-scoped write. A foreign id matches nothing.
    const result = await prisma.idSequence.updateMany({
      where: { id: parsedParam.data.id, tenantId: tenantGuard.tenant.id },
      data: parsed.data,
    });

    if (result.count === 0) {
      return NextResponse.json(fail("Sequence not found", "NOT_FOUND"), { status: 404 });
    }

    const sequence = await prisma.idSequence.findFirst({
      where: { id: parsedParam.data.id, tenantId: tenantGuard.tenant.id },
      select: SEQUENCE_SELECT,
    });

    return NextResponse.json(ok(sequence, "Sequence updated"));
  } catch (err) {
    console.error("[PATCH /api/identifier-sequences/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

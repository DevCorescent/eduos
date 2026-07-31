// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Collection Report
// FLOW   : Guard → tenant → query → tenant-scoped filter validation → single
//          aggregate read → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT have no access to
//          the finance report.
// BACKEND: Prisma
// PURPOSE: Report three raw aggregate facts over the authenticated tenant's fee
//          demands, optionally narrowed to one programme or one semester.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Query schema for GET /api/finance/report.
 *
 * programmeId and semesterId are the only parameters, and they are the only two
 * the README documents: its Phase 11 table describes this endpoint as a
 * "Collection report by programme/semester". Both are optional and independent.
 *
 * No pagination is accepted. The response is a single aggregate object rather
 * than a list, so there is nothing to page through — this is the first read
 * endpoint in the project that does not consume paginationQuerySchema, and the
 * reason is that it returns no rows at all.
 *
 * Every other query parameter is stripped by the plain z.object() and ignored,
 * exactly as an unknown key is on every other route.
 *
 * Declared here rather than in a validation module because no fee-report
 * validation module exists and this phase generates only this file. It is the
 * third route-local validation contract in the project, after the examination
 * results upload and the fee-demand list filters.
 */
const financeReportQuerySchema = z.object({
  programmeId: z.string().trim().min(1).optional(),
  semesterId: z.string().trim().min(1).optional(),
});

// GET
// ACCESS     : UNIVERSITY_ADMIN only. A caller holding FACULTY reads individual
//              fee demands but does not read the tenant's aggregate financial
//              position, so a faculty member receives the guard's 403 — the same
//              403 any other unpermitted role receives.
// VALIDATION : financeReportQuerySchema — ?programmeId and ?semesterId, both
//              optional. Any other query parameter is stripped and ignored.
// FLOW       : Authorise → resolve tenant → validate query → verify each supplied
//              filter against this tenant → read one aggregate.
//
//              A supplied filter id is proven to exist AND to belong to this
//              tenant before it is used, so an unknown id and one owned by
//              another tenant return the identical 404 and no id is ever
//              confirmed to exist elsewhere. Without that check a caller could
//              filter by another tenant's programme and receive a zeroed report,
//              which would silently answer a question about a foreign resource.
//              Precedence is programme, then semester — a request with both
//              filters bad always reports the same one.
//
//              PROGRAMME. A fee demand has no programme of its own: FeeDemand
//              declares no programmeId column. Programme membership is resolved
//              through the student and only through the student —
//              FeeDemand.studentId then Student.programmeId. Batch.programmeId is
//              deliberately not consulted even though Student.batchId leads to
//              it, and FeeStructure.programmeId is deliberately not consulted
//              even though FeeDemand.feeStructureId leads to it. The three can
//              disagree; Student.programmeId is the single authoritative source.
//
//              NULLS. Both Student.programmeId and FeeDemand.semesterId are
//              nullable, and a null simply does not match an equality filter. A
//              demand whose student has no programme is therefore absent from any
//              programme-filtered report, and one with no semester is absent from
//              any semester-filtered report. With no filter supplied, every
//              demand in the tenant is counted, nulls included.
//
//              The tenant predicate is always present and is never replaced by a
//              filter. FeeDemand.tenantId carries no foreign key, so it is the
//              only record of ownership this read has.
// REPORT     : Three facts, each a direct aggregate over FeeDemand rows:
//                totalDemands       COUNT(*)
//                totalDemandAmount  SUM(totalAmount)
//                totalWaivedAmount  SUM(waivedAmount)
//
//              Nothing else is returned and nothing is derived. No outstanding,
//              payable, balance, overdue, ageing, reconciliation, tax, discount
//              or waiver-adjusted figure is computed, and no collected amount is
//              reported — paidAmount is not summed. The Payment model is not read
//              at all: the report is derived exclusively from FeeDemand.
//
//              Duplicate demands are counted exactly as stored. Fee demand
//              generation is deliberately not idempotent, so a batch generated
//              twice contributes twice to every figure here. The report reflects
//              database contents rather than an inferred intent, and nothing
//              deduplicates.
//
//              The two sums are Decimal columns. Prisma's Decimal defines its own
//              toJSON and serialises to a string, so the shared serialize()
//              helper is not needed. Postgres SUM over an empty set is NULL, so a
//              report matching no rows would otherwise return null amounts
//              alongside a zero count; each is reported as "0" instead, keeping
//              the field a string in every response. That substitution is
//              arithmetic rather than policy — the sum of no amounts is zero —
//              and it derives nothing the rows do not already say.
// RESPONSE   : { success: true, data: { totalDemands, totalDemandAmount,
//                totalWaivedAmount } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              This endpoint performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = financeReportQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
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

    const { programmeId, semesterId } = parsed.data;

    // Two independent reads, so they are issued together rather than in
    // sequence. Each is skipped entirely when its filter was not supplied, so an
    // unfiltered report costs no extra reads at all.
    const [programme, semester] = await Promise.all([
      programmeId === undefined
        ? Promise.resolve(null)
        : prisma.programme.findFirst({
            where: { id: programmeId, tenantId: tenant.id },
            select: { id: true },
          }),
      semesterId === undefined
        ? Promise.resolve(null)
        : prisma.semester.findFirst({
            where: { id: semesterId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: programme, then semester.
    if (programmeId !== undefined && !programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (semesterId !== undefined && !semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    // The tenant predicate is always present; each filter is added only when it
    // was supplied and proven. Programme is reached through the student, which is
    // the single authoritative path — the batch's programme and the fee
    // structure's programme are both ignored.
    const where = {
      tenantId: tenant.id,
      ...(programmeId === undefined ? {} : { student: { programmeId } }),
      ...(semesterId === undefined ? {} : { semesterId }),
    };

    // One aggregate read. Postgres computes the count and both sums in a single
    // statement, so the three figures always describe the same set of rows.
    const aggregate = await prisma.feeDemand.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAmount: true, waivedAmount: true },
    });

    return NextResponse.json(
      ok({
        totalDemands: aggregate._count._all,
        // SUM over an empty set is NULL in Postgres; reported as "0" so the field
        // is a string in every response.
        totalDemandAmount: aggregate._sum.totalAmount ?? "0",
        totalWaivedAmount: aggregate._sum.waivedAmount ?? "0",
      })
    );
  } catch (err) {
    console.error("[GET /api/finance/report]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

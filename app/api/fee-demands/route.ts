// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Demand Collection
// FLOW   : Guard → tenant → query → tenant-scoped filter validation → paginated
//          read → response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
//          A student's own fee ledger is GET /api/students/[id]/fee-demands,
//          a separate README endpoint; STUDENT and PARENT have no access here.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's fee demands, optionally narrowed to
//          one student or one semester.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { ok, fail } from "@/types";

/**
 * Query schema for GET /api/fee-demands.
 *
 * Built on the shared pagination contract rather than restating it, so ?page and
 * ?limit keep their project-wide defaults and bounds — page 1, limit 20, maximum
 * 100.
 *
 * studentId and semesterId are the only filters, and they are the only two the
 * README documents: its Phase 11 table describes this endpoint as "List demands
 * (filter by student/semester)". Nothing else is accepted. There is no
 * ?feeStructureId, no ?status and no date range, because no source defines them —
 * a supplied one is stripped by the plain z.object() and ignored, exactly as an
 * unknown key is on every other route.
 *
 * Both filters are optional and independent. Supplying both narrows on each,
 * since a demand carries one student and one semester.
 *
 * Declared here rather than in lib/validations/fee-demand.ts because that module
 * is specified to export exactly three schemas and this phase generates only this
 * file. It is the second route-local validation contract in the project, after
 * the examination results upload, and should move to the validation layer if the
 * fee-demand list ever gains a sibling endpoint.
 */
const feeDemandQuerySchema = paginationQuerySchema.extend({
  studentId: z.string().trim().min(1).optional(),
  semesterId: z.string().trim().min(1).optional(),
});

/**
 * Columns returned for a fee demand.
 *
 * Scalars only — no relation is expanded, following the project's
 * collection-route convention: CURRICULUM_SELECT omits its subjects and
 * FEE_STRUCTURE_SELECT omits its components, each leaving the nesting to a detail
 * route. FeeDemand declares student, semester, feeStructure and payments
 * relations; none is taken here. The response carries the three reference ids and
 * the client resolves them through their own endpoints.
 *
 * payments in particular is left alone. A demand accumulates one row per payment,
 * so nesting it would make a collection page unbounded, and summing it would be a
 * balance calculation — which this endpoint does not perform.
 *
 * totalAmount, paidAmount and waivedAmount are reported exactly as stored. No
 * outstanding balance is derived from them: no source defines whether a balance
 * is total minus paid, total minus paid minus waived, or something else, and the
 * three columns are returned so a client can apply whatever rule it holds.
 *
 * All three are Decimal columns. Prisma's Decimal defines its own toJSON and
 * serialises to a string, so the shared serialize() helper is not needed — it
 * exists for BigInt, which this model does not carry. As elsewhere the string
 * form is normalised, so a stored 150000.00 is returned as "150000".
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

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A single requireRole call decides
//              access — both roles read the same rows, and a fee demand carries
//              no publication or visibility concept in the schema, so nothing
//              narrows either role's scope. FeeStatus is not used as a visibility
//              predicate: it is state, and it gates nothing here.
// VALIDATION : feeDemandQuerySchema — ?page and ?limit from the shared contract,
//              plus the two documented filters ?studentId and ?semesterId. Any
//              other query parameter is stripped and ignored rather than
//              rejected.
// FLOW       : Authorise → resolve tenant → validate query → verify each supplied
//              filter against this tenant → read one page alongside the total in
//              a single transaction.
//
//              A supplied filter id is proven to exist AND to belong to this
//              tenant before it is used. Without that check a caller could filter
//              by another tenant's student id and receive an empty page, which
//              would confirm nothing but would also silently answer a question
//              about a foreign resource; with it, an unknown id and one owned by
//              another tenant return the identical 404, so no id is ever
//              confirmed to exist elsewhere. Precedence follows the schema's
//              column order — student, then semester — so a request with both
//              filters bad always reports the same one.
//
//              The filters are then applied alongside the tenant predicate rather
//              than in place of it. FeeDemand.tenantId carries no foreign key, so
//              that predicate is the only record of ownership the read has, and
//              both it and the filters are applied to the count as well as the
//              page — a total can never describe a wider set than the caller can
//              read.
//
//              Ordering is by dueDate then id, both descending. dueDate is the
//              model's domain date and is NOT NULL, so it sorts cleanly; this
//              matches Attendance and Examination, whose collections order by
//              their own date column descending rather than by createdAt. The id
//              tiebreaker is required for correctness rather than presentation:
//              offset pagination over an unordered result can repeat or skip rows
//              across pages, and a generation run writes every demand of a batch
//              with the same dueDate, so dueDate alone is emphatically not
//              deterministic here.
//
//              Nothing is computed. No balance, no outstanding amount, no total
//              across rows, no status transition — the endpoint reports stored
//              columns and nothing else.
// RESPONSE   : { success: true, data: { feeDemands, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = feeDemandQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { page, limit, studentId, semesterId } = parsed.data;

    // Two independent reads, so they are issued together rather than in
    // sequence. Each is skipped entirely when its filter was not supplied, so an
    // unfiltered list costs no extra reads at all.
    const [student, semester] = await Promise.all([
      studentId === undefined
        ? Promise.resolve(null)
        : prisma.student.findFirst({
            where: { id: studentId, tenantId: tenant.id },
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
    // resolved first. The order follows the schema's column order.
    if (studentId !== undefined && !student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    if (semesterId !== undefined && !semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    // The tenant predicate is always present; each filter is added only when it
    // was supplied and proven. Both apply to the count as well as the page.
    const where = {
      tenantId: tenant.id,
      ...(studentId === undefined ? {} : { studentId }),
      ...(semesterId === undefined ? {} : { semesterId }),
    };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [feeDemands, total] = await prisma.$transaction([
      prisma.feeDemand.findMany({
        where,
        orderBy: [{ dueDate: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: FEE_DEMAND_SELECT,
      }),
      prisma.feeDemand.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        feeDemands,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/fee-demands]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

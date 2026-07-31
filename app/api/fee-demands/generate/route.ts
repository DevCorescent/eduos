// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Demand Generation
// FLOW   : Guard → tenant → body → tenant-scoped reference checks → resolve the
//          batch's ACTIVE students → atomic bulk insert → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT have no access to
//          fee demand generation.
// BACKEND: Prisma
// PURPOSE: Create one FeeDemand per ACTIVE student of a batch, from a single
//          supplied amount and due date.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { generateFeeDemandSchema } from "@/lib/validations/fee-demand";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// POST
// ACCESS     : UNIVERSITY_ADMIN only. A caller holding FACULTY, STUDENT or any
//              other role receives the guard's 403 — generating a tenant's fee
//              demands is an administrative act and no other role performs it.
// VALIDATION : generateFeeDemandSchema — batchId, dueDate and totalAmount
//              required; semesterId and feeStructureId optional. totalAmount is
//              bounded to the precision its Decimal(10, 2) column declares and to
//              non-negative values. id, tenantId, studentId, paidAmount,
//              waivedAmount, status, createdAt and updatedAt are absent from the
//              schema and so are stripped from any body that supplies them.
//              The body is parsed before any database work is done, so a
//              malformed request costs no reads.
// FLOW       : Authorise → resolve tenant → parse body → verify the supplied
//              references against this tenant → read the batch's ACTIVE students
//              → insert one demand per student in a single statement.
//
//              REFERENCES. batchId is always checked; semesterId and
//              feeStructureId are checked only when supplied, since both columns
//              are nullable. Precedence follows the body's order — batch, then
//              semester, then fee structure — so a request with several bad
//              references always reports the same one. An unknown id and one
//              owned by another tenant return the identical 404 for each, so no
//              id is ever confirmed to exist elsewhere.
//
//              No consistency is asserted between them. A semester need not
//              relate to the batch, and a fee structure's own programmeId,
//              batchId and academicYearId are not compared against the batch
//              being generated for: feeStructureId is provenance, recorded on
//              each demand rather than used to price it. Nothing in the schema
//              relates a Semester to a Batch except indirectly through Section,
//              and no source requires the comparison, so none is made.
//
//              STUDENT SELECTION. Students come only from the batch, resolved as
//              Student.batchId within this tenant, and only those whose status is
//              ACTIVE. INACTIVE, GRADUATED, WITHDRAWN, SUSPENDED, ON_LEAVE and
//              TRANSFERRED students are excluded and receive no demand. No
//              semester relationship takes any part in selecting them: neither
//              Student.section.semesterId nor Student.currentSemester is read,
//              and a supplied semesterId narrows nothing. studentId is therefore
//              derived entirely from resolved batch membership and never from
//              anything the caller sent — the request body carries no student
//              field at all.
//
//              A batch with no ACTIVE students generates nothing and returns 201
//              with a count of zero. That is a successful run over an empty set,
//              not a failure: the batch exists and was read.
//
//              AMOUNTS. totalAmount is copied unchanged into every demand. It is
//              never derived from the fee structure, never adjusted for tax, and
//              never varied per student — the supplied figure is the amount each
//              student owes. paidAmount, waivedAmount and status are omitted from
//              the write entirely so the schema defaults apply: 0, 0 and PENDING.
//              No payment is recorded, no waiver is applied and no lifecycle
//              transition is performed here.
//
//              WRITE. A single createMany, which Postgres executes as one
//              statement, so the run is atomic and no partial set of demands can
//              be observed. This is the same bulk-write shape POST /api/attendance
//              uses; the results upload needs an explicit transaction only because
//              upsert cannot be expressed as one statement, and nothing here
//              upserts.
//
//              DUPLICATES. None are prevented. FeeDemand declares no unique
//              constraint on any column or combination, so a second run over the
//              same batch creates a second complete set of demands. No pre-check
//              is performed, no existing demand is consulted and nothing is
//              skipped — the endpoint is deliberately not idempotent.
// RESPONSE   : { success: true, data: { count },
//                message: "Fee demands generated" }
//
//              The created rows are not echoed. createMany does not return them,
//              and a batch-sized response would be unbounded; the count is what
//              can be stated, matching POST /api/attendance and the results
//              upload. The demands are read back through the fee-demand list
//              endpoints.
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch maps a genuine Prisma unique violation only. It is
//              not reachable today — FeeDemand has no unique constraint — but it
//              is handled rather than omitted so a real constraint violation would
//              surface as a conflict rather than a 500 if the schema ever gains
//              one. It is never raised by an application rule.
//
//              A foreign-key branch is reachable and is handled: a student,
//              semester or fee structure disappearing between its check and the
//              insert makes the write fail, and which one it was is not
//              recoverable from the error, so they are reported together.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below. Parsing happens
    // before any database work, so a bad request costs no reads.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = generateFeeDemandSchema.safeParse(body);
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

    const { batchId, semesterId, feeStructureId, dueDate, totalAmount } = parsed.data;

    // Three independent reads, so they are issued together rather than in
    // sequence. Each is scoped to this tenant. The two optional lookups are
    // skipped entirely when their column was not supplied.
    const [batch, semester, feeStructure] = await Promise.all([
      prisma.batch.findFirst({
        where: { id: batchId, tenantId: tenant.id },
        select: { id: true },
      }),
      semesterId === undefined
        ? Promise.resolve(null)
        : prisma.semester.findFirst({
            where: { id: semesterId, tenantId: tenant.id },
            select: { id: true },
          }),
      feeStructureId === undefined
        ? Promise.resolve(null)
        : prisma.feeStructure.findFirst({
            where: { id: feeStructureId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the request body's own order.
    if (!batch) {
      return NextResponse.json(fail("Batch not found", "NOT_FOUND"), { status: 404 });
    }

    if (semesterId !== undefined && !semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    if (feeStructureId !== undefined && !feeStructure) {
      return NextResponse.json(fail("Fee structure not found", "NOT_FOUND"), { status: 404 });
    }

    // Students come from the batch and nowhere else. ACTIVE only — every other
    // StudentStatus is excluded and receives no demand. No semester relationship
    // participates in this query.
    const students = await prisma.student.findMany({
      where: { tenantId: tenant.id, batchId, status: "ACTIVE" },
      select: { id: true },
    });

    // A batch with no ACTIVE students is a successful run over an empty set. No
    // write is issued at all.
    if (students.length === 0) {
      return NextResponse.json(ok({ count: 0 }, "Fee demands generated"), { status: 201 });
    }

    // One statement, so the run is atomic and no partial set of demands can be
    // observed. tenantId comes from the resolved tenant context and studentId
    // from resolved batch membership, never from the request body. semesterId
    // and feeStructureId are stored exactly as supplied, and totalAmount is
    // copied unchanged into every row. status, paidAmount, waivedAmount,
    // createdAt and updatedAt are omitted so the schema defaults apply.
    const created = await prisma.feeDemand.createMany({
      data: students.map((student) => ({
        tenantId: tenant.id,
        studentId: student.id,
        semesterId,
        feeStructureId,
        dueDate,
        totalAmount,
      })),
    });

    return NextResponse.json(ok({ count: created.count }, "Fee demands generated"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — FeeDemand declares no unique constraint — but
      // mapped so a real constraint violation would never surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Fee demand already exists", "CONFLICT"), { status: 409 });
      }

      // A student, semester or fee structure was deleted between its check and
      // the insert, so the foreign key rejected the reference. Which of the three
      // it was is not recoverable from the error, so they are reported together.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced student, semester or fee structure not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/fee-demands/generate]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

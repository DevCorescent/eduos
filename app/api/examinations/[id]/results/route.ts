// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Examination Results
// FLOW   : Guard → tenant → param → examination lookup → query/body → student
//          validation → marks bounds → derived fields → list / atomic bulk
//          upsert → response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
//          Students read their own results through
//          GET /api/students/[id]/results, not here.
// BACKEND: Prisma
// PURPOSE: List one examination's results and upload them in bulk.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { examinationIdParamSchema } from "@/lib/validations/examination";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an examination result. Declared once so both handlers
 * answer with the same shape.
 *
 * No relation is expanded, matching every other route in the project. Neither the
 * examination nor the student is embedded even though this endpoint is keyed on
 * the first: the caller already holds the examination id from the URL, and every
 * row carries the same one.
 *
 * There is no tenantId to report. ExamResult is one of only two models in the
 * schema that store tenant-owned data with no tenant column — ownership is
 * reachable only through the examination or through the student, and the two are
 * not reconciled by any constraint. Every query here is therefore anchored on an
 * examination already proven to belong to the caller's tenant.
 *
 * marksObtained and gradePoint are Decimal columns. Prisma's Decimal defines its
 * own toJSON and serialises to a string, so the shared serialize() helper is not
 * needed — it exists for BigInt, which this model does not carry. As elsewhere in
 * the project, the string form is normalised, so a stored 8.50 is returned as
 * "8.5".
 */
const EXAM_RESULT_SELECT = {
  id: true,
  examinationId: true,
  studentId: true,
  marksObtained: true,
  grade: true,
  gradePoint: true,
  isPassed: true,
  isAbsent: true,
  remarks: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so an unknown examination id and one owned by
 * another tenant cannot drift apart: both produce the identical status, code and
 * message, byte for byte. A distinguishable response would confirm that a given
 * id exists somewhere.
 */
function examinationNotFound(): NextResponse {
  return NextResponse.json(fail("Examination not found", "NOT_FOUND"), { status: 404 });
}

/**
 * Body schema for POST /api/examinations/[id]/results.
 *
 * Declared here rather than in lib/validations/examination.ts because that module
 * is specified to export exactly three schemas and this phase generates only this
 * file. It is the one validation contract in the project that does not live in
 * the validation layer; if the result upload gains a sibling endpoint it should
 * move.
 *
 * The envelope is { records: [...] } with at least one record, the same shape
 * POST /api/attendance established for bulk writes: every other POST in the
 * project takes an object, and an envelope leaves room for batch-level fields
 * without breaking a client.
 *
 * Client-writable per record: studentId, marksObtained, grade, gradePoint,
 * isAbsent and remarks.
 *
 * marksObtained is a number rather than an integer. ExamResult.marksObtained is
 * Decimal(6,2), so a fractional mark such as 72.5 is storable and rejecting it
 * would be stricter than the column. Its upper bound depends on the parent
 * examination's maxMarks, which no schema can read, so only the lower bound is
 * applied here and the ceiling is enforced in the route after the examination is
 * loaded — the same split already used for marks <= Assignment.maxMarks in the
 * submission grading route.
 *
 * grade and gradePoint are accepted as given and never computed. The schema
 * declares no GradeScale model anywhere, so no mapping from marks to a grade is
 * derivable from any existing data; inventing one would be a business rule.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id            — server-managed, a cuid from the database default.
 *   examinationId — taken from the [id] route segment, never the body, so results
 *                   cannot be filed against a different examination than the one
 *                   addressed in the URL.
 *   isPassed      — derived from the marks and the examination's passMark. A
 *                   client able to set it could declare a failing student passed.
 *   publishedAt   — server-managed. It is the visibility predicate every
 *                   student-facing read uses.
 *   createdAt,
 *   updatedAt     — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is the
 * project-wide behaviour of a plain z.object(): no schema in this project uses
 * .strict().
 */
const uploadResultsSchema = z.object({
  records: z
    .array(
      z.object({
        studentId: z.string().trim().min(1),
        marksObtained: z.number().nonnegative().optional(),
        grade: z.string().trim().min(1).optional(),
        gradePoint: z.number().nonnegative().optional(),
        isAbsent: z.boolean().optional(),
        remarks: z.string().trim().min(1).optional(),
      })
    )
    .min(1),
});

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. This is the marking workspace, so it
//              shows every result including unpublished ones — a student reaches
//              their own results through GET /api/students/[id]/results, which
//              applies the publication predicate.
// VALIDATION : examinationIdParamSchema for the [id] segment, and
//              paginationQuerySchema for ?page and ?limit, consumed directly as
//              in every other collection route. No filter parameter is defined.
// FLOW       : Authorise → resolve tenant → prove the parent examination → read
//              one page of its results with the total.
//
//              The examination is resolved first and tenant-scoped, and the
//              result query is anchored on its id. That is what establishes
//              ownership: ExamResult carries no tenantId, so a query on result
//              columns alone could reach any tenant's rows.
//
//              Ordering is by id ascending. ExamResult has no natural sort key —
//              no date, no sequence, and a bulk upload writes every row in one
//              transaction so createdAt is not discriminating — and id is unique,
//              so it supplies the total order that offset pagination requires
//              without implying a meaning the data does not carry.
// RESPONSE   : { success: true, data: { results, pagination } }
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
    const parsedParam = examinationIdParamSchema.safeParse(await params);
    if (!parsedParam.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParam.error),
        },
        { status: 400 }
      );
    }

    const parsedQuery = paginationQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedQuery.error),
        },
        { status: 400 }
      );
    }

    const examinationId = parsedParam.data.id;
    const { page, limit } = parsedQuery.data;

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's examination can never be resolved or acknowledged.
    const examination = await prisma.examination.findFirst({
      where: { id: examinationId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!examination) {
      return examinationNotFound();
    }

    const where = { examinationId };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [results, total] = await prisma.$transaction([
      prisma.examResult.findMany({
        where,
        orderBy: [{ id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: EXAM_RESULT_SELECT,
      }),
      prisma.examResult.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/examinations/[id]/results]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN · FACULTY.
// VALIDATION : examinationIdParamSchema for the [id] segment, uploadResultsSchema
//              for the body. Every record is validated; a single bad record fails
//              the whole request before any write is attempted.
// FLOW       : The order is fixed, and each step is a precondition of the next:
//
//              1. Examination lookup — resolved tenant-scoped, so an unknown id
//                 and one owned by another tenant return the identical 404. Its
//                 maxMarks and passMark are loaded here because the marks ceiling
//                 and the isPassed derivation both depend on them and no schema
//                 can read a stored value.
//              2. Tenant validation — the same lookup is the tenant check: the
//                 examination is the only thing anchoring these rows to a tenant,
//                 because ExamResult carries no tenantId of its own.
//              3. Student validation — the distinct studentIds across the batch
//                 are checked with one query, filtered by id AND tenantId. That
//                 is the same predicate the project's per-row findFirst lookups
//                 apply, issued once instead of once per record, so a
//                 two-hundred-row upload costs one read rather than two hundred.
//                 Ownership is still proven for every id individually — the set
//                 is accepted only if every member came back. An unknown student
//                 and one owned by another tenant return the identical 404.
//              4. Marks bounds — 0 <= marksObtained <= examination.maxMarks. The
//                 lower bound is in the schema; the ceiling is applied here.
//                 A present student must carry a mark and an absent one must not.
//              5. Derived fields — isPassed is computed, never accepted.
//              6. Atomic upsert — one transaction, all or nothing.
//
//              Absence rules follow the stated contract: isAbsent true forces
//              marksObtained to null and isPassed to false, so a supplied mark for
//              an absent student is discarded rather than stored; isAbsent false
//              or omitted requires a mark. isPassed is null when the examination
//              declares no passMark, because the column is a tri-state Boolean?
//              and "not determinable" is exactly what a missing pass mark means.
//
//              grade and gradePoint are stored as supplied. Nothing computes them:
//              the schema declares no GradeScale model, so no mapping from marks
//              to a grade exists in any source.
//
//              The write is an upsert keyed on @@unique([examinationId, studentId]),
//              so re-uploading a batch corrects the stored results rather than
//              failing. Both columns of that constraint are NOT NULL, so
//              PostgreSQL enforces it completely and the key is reliable — unlike
//              the nullable-column constraints recorded as TD-001 and in the
//              attendance module. publishedAt is absent from both the create and
//              the update payloads, so an already-published result keeps its
//              publication timestamp when corrected.
//
//              Every upsert is issued inside one prisma.$transaction, so a
//              failure anywhere rolls the whole batch back and no partial upload
//              is observable. Records naming the same student twice in one batch
//              are applied in order and the last one wins, which is what an upsert
//              means; no rule anywhere forbids it, so none is invented.
// RESPONSE   : { success: true, data: { count },
//                message: "Results uploaded" }
//
//              The rows are not echoed. A bulk upsert returns each row, but
//              reporting the count keeps the response bounded for a
//              several-hundred-row upload and matches POST /api/attendance.
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch maps a genuine Prisma unique violation only. It is
//              not reachable through the natural key — that is what the upsert
//              resolves — but a concurrent insert racing the same key can still
//              surface P2002 between the upsert's own read and write, and that is
//              a real conflict rather than an application rule.
export async function POST(
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

    const parsedParam = examinationIdParamSchema.safeParse(await params);
    if (!parsedParam.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParam.error),
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

    const parsedBody = uploadResultsSchema.safeParse(body);
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

    const examinationId = parsedParam.data.id;
    const { records } = parsedBody.data;

    // 1 & 2. Examination lookup doubles as the tenant check — it is the only
    // thing anchoring these rows to a tenant. maxMarks and passMark are loaded
    // because steps 4 and 5 depend on them.
    const examination = await prisma.examination.findFirst({
      where: { id: examinationId, tenantId: tenant.id },
      select: { maxMarks: true, passMark: true },
    });

    if (!examination) {
      return examinationNotFound();
    }

    // 3. Student validation, as a set rather than per record. The batch is
    // accepted only if every distinct id came back from a tenant-scoped read.
    const studentIds = [...new Set(records.map((record) => record.studentId))];

    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, tenantId: tenant.id },
      select: { id: true },
    });

    if (students.length !== studentIds.length) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    // 4 & 5. Marks bounds and derived fields, applied to every record before any
    // write is attempted so a rejection leaves the database untouched.
    const rows = [];

    for (const record of records) {
      const isAbsent = record.isAbsent ?? false;

      if (isAbsent) {
        // An absent student has no mark. A supplied one is discarded rather than
        // stored, and isPassed is false by the stated rule.
        rows.push({
          studentId: record.studentId,
          marksObtained: null,
          grade: record.grade,
          gradePoint: record.gradePoint,
          isPassed: false,
          isAbsent: true,
          remarks: record.remarks,
        });
        continue;
      }

      if (record.marksObtained === undefined) {
        return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
      }

      if (record.marksObtained > examination.maxMarks) {
        return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
      }

      // Null when the examination declares no pass mark: the column is a
      // tri-state Boolean? and "not determinable" is what a missing passMark
      // means. Never accepted from the client.
      const isPassed =
        examination.passMark === null ? null : record.marksObtained >= examination.passMark;

      rows.push({
        studentId: record.studentId,
        marksObtained: record.marksObtained,
        grade: record.grade,
        gradePoint: record.gradePoint,
        isPassed,
        isAbsent: false,
        remarks: record.remarks,
      });
    }

    // 6. One transaction, so a failure anywhere rolls the whole batch back and no
    // partial upload is observable. examinationId comes from the route segment,
    // never the body. publishedAt is absent from both payloads, so an
    // already-published result keeps its publication timestamp when corrected.
    await prisma.$transaction(
      rows.map((row) =>
        prisma.examResult.upsert({
          where: {
            examinationId_studentId: { examinationId, studentId: row.studentId },
          },
          create: { examinationId, ...row },
          update: {
            marksObtained: row.marksObtained,
            grade: row.grade,
            gradePoint: row.gradePoint,
            isPassed: row.isPassed,
            isAbsent: row.isAbsent,
            remarks: row.remarks,
          },
          select: { id: true },
        })
      )
    );

    return NextResponse.json(ok({ count: rows.length }, "Results uploaded"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent insert took the same natural key between this upsert's own
      // read and write. A genuine conflict rather than an application rule.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Result already recorded for this student", "CONFLICT"),
          { status: 409 }
        );
      }

      // The examination or a referenced student was deleted between its check and
      // the write, so the foreign key rejected the reference. Which of the two it
      // was is not recoverable from the error.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced examination or student not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/examinations/[id]/results]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

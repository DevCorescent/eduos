// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Examination Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup → read / update →
//          response.
// ACCESS : GET   — UNIVERSITY_ADMIN · FACULTY · STUDENT
//          PATCH — UNIVERSITY_ADMIN · FACULTY
//          PARENT is not implemented anywhere yet.
// BACKEND: Prisma
// PURPOSE: View and edit a single examination within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import {
  examinationIdParamSchema,
  updateExaminationSchema,
} from "@/lib/validations/examination";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an examination.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there — the same reason
 * ASSIGNMENT_SELECT, SUBMISSION_SELECT and the rest are restated in their own
 * detail routes.
 *
 * No relation is expanded. Examination carries real semester and course
 * relations, so those joins are possible and are simply not taken; the response
 * carries the two ids and the client resolves names through their own endpoints.
 */
const EXAMINATION_SELECT = {
  id: true,
  tenantId: true,
  semesterId: true,
  courseId: true,
  title: true,
  type: true,
  status: true,
  date: true,
  startTime: true,
  endTime: true,
  venue: true,
  maxMarks: true,
  passMark: true,
  duration: true,
  instructions: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Examination holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

/**
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so an unknown id and one owned by another tenant
 * cannot drift apart: both produce the identical status, code and message, byte
 * for byte. A distinguishable response would confirm that a given id exists
 * somewhere.
 */
function examinationNotFound(): NextResponse {
  return NextResponse.json(fail("Examination not found", "NOT_FOUND"), { status: 404 });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, all with the same scope.
//
//              No two-tier logic exists here, matching the collection route. An
//              examination has no publication concept — the model carries no
//              publishedAt column and nothing in the schema hides a scheduled
//              examination from the students sitting it — so a single requireRole
//              call decides access and every permitted role reads the same row.
//              ExamStatus is not a visibility predicate either: it is descriptive
//              and gates nothing.
// VALIDATION : examinationIdParamSchema — the [id] segment must be non-empty once
//              trimmed. Examination.id is a cuid, not a UUID, so no format
//              assertion is applied; an unrecognised-but-well-formed id is a 404
//              rather than a 400. No query parameters are read: this addresses a
//              single resource.
// FLOW       : Authorise → resolve tenant → read the examination filtered by BOTH
//              id and tenantId.
//
//              findFirst, never findUnique(id). The tenant filter is part of the
//              lookup itself rather than a check applied to a row already
//              fetched, so another tenant's examination is never loaded, never
//              acknowledged and cannot leak through a mistake in a later branch.
//              Examination.tenantId carries no foreign key, so the column is the
//              only record of ownership and this query is the only thing
//              enforcing it.
// RESPONSE   : { success: true, data: <Examination> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY", "STUDENT");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = examinationIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const examination = await prisma.examination.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: EXAMINATION_SELECT,
    });

    if (!examination) {
      return examinationNotFound();
    }

    return NextResponse.json(ok(examination));
  } catch (err) {
    console.error("[GET /api/examinations/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A caller holding only STUDENT is
//              rejected by the guard with 403 — students read the examination
//              schedule but do not change it.
// VALIDATION : examinationIdParamSchema for the [id] segment,
//              updateExaminationSchema for the body. Every field optional but at
//              least one required, so an empty body is a client error rather than
//              a silent no-op that would still advance updatedAt.
//
//              Mutable: semesterId, courseId, title, type, date, startTime,
//              endTime, venue, maxMarks, passMark, duration, instructions.
//
//              id, tenantId, status, createdAt and updatedAt are absent from the
//              create schema, so .partial() cannot introduce them — an
//              examination can never be moved between tenants, nor advanced
//              through its lifecycle, by this endpoint. A body supplying any of
//              them has it stripped in the project-wide manner rather than being
//              refused. This differs from PATCH /api/assignments/[id], which
//              answers 409 for an attempted lifecycle write: there, publication
//              has a dedicated endpoint whose existence a silent strip would
//              hide, whereas here no transition endpoint exists at all and
//              ExamStatus is descriptive, so there is no action being bypassed.
// FLOW       : Authorise → resolve tenant → validate param and body → load the
//              stored examination → revalidate any changed reference → apply the
//              two cross-field rules to the merged values → apply one atomic
//              update scoped by id and tenantId.
//
//              semesterId and courseId are revalidated only when supplied,
//              tenant-scoped, exactly as on create. Both lookups are skipped when
//              neither key is present, so a title-only edit costs no extra reads.
//              An unknown id and one owned by another tenant return the identical
//              404 for each reference, and the semester is reported before the
//              course so a body with both bad always names the same one.
//
//              The two cross-field rules are re-evaluated against merged values —
//              the supplied key where given, the stored column otherwise. The
//              validation module can only compare keys present in the same body,
//              so a PATCH supplying only passMark, or only endTime, would
//              otherwise slip past a rule the create path enforces and store a
//              pass mark above the maximum or an inverted time span. Both
//              comparisons are therefore repeated here against the row as it will
//              be after the write.
//
//              No status transition is performed and none is possible: status is
//              neither read as a guard nor written. ExamStatus remains whatever
//              the database holds.
// RESPONSE   : { success: true, data: <Examination>,
//                message: "Examination updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable: Examination
//              has no unique constraint on any column or combination, so Prisma
//              cannot raise P2002 here. It is handled rather than omitted so a
//              genuine constraint violation would surface as a conflict rather
//              than a 500 if the schema ever gains one, and it is mapped only
//              from a real Prisma conflict, never from an application rule.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = examinationIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = updateExaminationSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const examinationId = parsedParams.data.id;
    const input = parsedBody.data;

    const existing = await prisma.examination.findFirst({
      where: { id: examinationId, tenantId: tenant.id },
      select: { maxMarks: true, passMark: true, startTime: true, endTime: true },
    });

    if (!existing) {
      return examinationNotFound();
    }

    // Both lookups are skipped when neither reference is being changed, so a
    // title-only edit costs no extra reads. When either is supplied it is
    // re-proven against this tenant, exactly as on create.
    const [semester, course] = await Promise.all([
      input.semesterId === undefined
        ? Promise.resolve(null)
        : prisma.semester.findFirst({
            where: { id: input.semesterId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.courseId === undefined
        ? Promise.resolve(null)
        : prisma.course.findFirst({
            where: { id: input.courseId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: semester before course, following the schema's column
    // order.
    if (input.semesterId !== undefined && !semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.courseId !== undefined && !course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    // The row as it will be after the write: the supplied value where given, the
    // stored column otherwise. updateExaminationSchema can only compare keys
    // present in the same body, so these two rules are re-evaluated here to close
    // the single-key cases it cannot see.
    const mergedMaxMarks = input.maxMarks ?? existing.maxMarks;
    const mergedPassMark = input.passMark ?? existing.passMark;

    if (mergedPassMark !== null && mergedPassMark > mergedMaxMarks) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const mergedStartTime = input.startTime ?? existing.startTime;
    const mergedEndTime = input.endTime ?? existing.endTime;

    if (
      mergedStartTime !== null &&
      mergedEndTime !== null &&
      mergedEndTime <= mergedStartTime
    ) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own. status, tenantId and the timestamps are absent from
    // the data, so the stored values are left exactly as they were.
    const examination = await prisma.examination.update({
      where: { id: examinationId, tenantId: tenant.id },
      data: input,
      select: EXAMINATION_SELECT,
    });

    return NextResponse.json(ok(examination, "Examination updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — Examination declares no unique constraint — but
      // mapped so a real constraint violation would never surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Examination already exists", "CONFLICT"), { status: 409 });
      }

      // The referenced semester or course was deleted between its check and the
      // update, so the foreign key rejected the reference. Which of the two it
      // was is not recoverable from the error, so they are reported together.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced semester or course not found", "NOT_FOUND"),
          { status: 404 }
        );
      }

      // The examination was deleted between the lookup and the update.
      if (isRecordNotFound(err)) {
        return examinationNotFound();
      }
    }

    console.error("[PATCH /api/examinations/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

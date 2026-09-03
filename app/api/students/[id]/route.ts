// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Detail
// FLOW   : Guard → tenant → params → load student → body → parallel checks on
//          changed references → duplicate check → update → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View and update a single student within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import { studentIdParamSchema, updateStudentSchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a student.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded: the linked User is not joined, so the response
 * carries userId rather than the student's name or email.
 */
const STUDENT_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  enrollmentNo: true,
  programmeId: true,
  batchId: true,
  sectionId: true,
  specialisationId: true,
  currentSemester: true,
  status: true,
  admissionDate: true,
  graduationDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Student holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the student filtered by BOTH
//              id and tenantId, so a student owned by another tenant is simply
//              not found rather than being disclosed.
// RESPONSE   : { success: true, data: <Student> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
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

    // Route params resolve asynchronously in this Next.js version.
    const parsed = studentIdParamSchema.safeParse(await params);
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
    const student = await prisma.student.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: STUDENT_SELECT,
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(student));
  } catch (err) {
    console.error("[GET /api/students/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment, updateStudentSchema
//              for the body. Every field optional but at least one required.
//              tenantId and userId are both absent from the schema, so a body
//              supplying either has it stripped: a student can be moved neither
//              between tenants nor onto a different user account.
// FLOW       : Authorise → resolve tenant → validate → load the student scoped
//              by tenant (404 otherwise) → issue only the checks a genuinely
//              changing field requires, in parallel → apply them in a fixed
//              precedence → one atomic update scoped by id and tenantId.
//
//              Every reference is re-verified against this tenant on change,
//              exactly as on create. programmeId matters most: Student.programmeId
//              carries no relation and no foreign key in the schema, so the
//              database will accept any value written to it. On update, as on
//              create, this lookup is the only thing preventing a caller from
//              pointing their student at another university's programme — there
//              is no constraint behind it to catch a mistake.
//
//              A field resubmitted with its current value is not a change and
//              costs no query, so a no-op PATCH performs the load and the write
//              and nothing else.
// RESPONSE   : { success: true, data: <Student>, message: "Student updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
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

    const parsedParams = studentIdParamSchema.safeParse(await params);
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

    const parsedBody = updateStudentSchema.safeParse(body);
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

    const studentId = parsedParams.data.id;

    // One load serves several purposes: existence with tenant ownership, and
    // the current reference ids and enrolment number used to decide which
    // further checks are needed at all.
    const existing = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: {
        id: true,
        enrollmentNo: true,
        programmeId: true,
        batchId: true,
        sectionId: true,
        specialisationId: true,
      },
    });

    if (!existing) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // `typeof === "string"`, not `!== undefined` — tester issue #25.
    //   undefined  the key was absent: leave the column alone.
    //   null       the caller sent "" to CLEAR the column. There is no row to
    //              look up, and asking for one by a null id would find nothing
    //              and answer "Programme not found" for a request that named no
    //              programme. Clearing is always allowed: the column is
    //              nullable, so emptying it cannot dangle a reference.
    //   a string   a real id, which must be proven to exist in this tenant
    //              before it is written.
    //
    // These flags gate the EXISTENCE CHECKS only. The write below still passes
    // the parsed input straight through, so a null reaches Prisma and clears
    // the column.
    const programmeChanging =
      typeof input.programmeId === "string" && input.programmeId !== existing.programmeId;
    const batchChanging =
      typeof input.batchId === "string" && input.batchId !== existing.batchId;
    const sectionChanging =
      typeof input.sectionId === "string" && input.sectionId !== existing.sectionId;
    const specialisationChanging =
      typeof input.specialisationId === "string" &&
      input.specialisationId !== existing.specialisationId;
    const enrollmentChanging =
      input.enrollmentNo !== undefined && input.enrollmentNo !== existing.enrollmentNo;

    // Independent, so they are issued together rather than in sequence. An
    // unchanged field contributes no query at all.
    //
    // The `as string` casts are what the *Changing flags above already prove:
    // each is only true when the value is a string. TypeScript cannot carry a
    // boolean's narrowing into this block, and the enrolment lookup below has
    // always been written the same way for the same reason.
    const [programme, batch, section, specialisation, duplicateEnrollment] = await Promise.all([
      programmeChanging
        ? prisma.programme.findFirst({
            where: { id: input.programmeId as string, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      batchChanging
        ? prisma.batch.findFirst({
            where: { id: input.batchId as string, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      sectionChanging
        ? prisma.section.findFirst({
            where: { id: input.sectionId as string, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      specialisationChanging
        ? prisma.specialisation.findFirst({
            where: { id: input.specialisationId as string, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      enrollmentChanging
        ? prisma.student.findUnique({
            where: {
              tenantId_enrollmentNo: {
                tenantId: tenant.id,
                enrollmentNo: input.enrollmentNo as string,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before the constraint clash.
    if (programmeChanging && !programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (batchChanging && !batch) {
      return NextResponse.json(fail("Batch not found", "NOT_FOUND"), { status: 404 });
    }

    if (sectionChanging && !section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    if (specialisationChanging && !specialisation) {
      return NextResponse.json(fail("Specialisation not found", "NOT_FOUND"), { status: 404 });
    }

    // The lookup ran only for a changing number, so any row it found belongs to
    // a different student by construction.
    if (enrollmentChanging && duplicateEnrollment) {
      return NextResponse.json(
        fail("Enrollment number already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    const student = await prisma.student.update({
      where: { id: studentId, tenantId: tenant.id },
      data: input,
      select: STUDENT_SELECT,
    });

    return NextResponse.json(ok(student, "Student updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the enrolment number between the check and
      // the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Enrollment number already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // A referenced batch, section or specialisation was deleted between its
      // check and the update. programmeId cannot appear here: it has no foreign
      // key, so a programme deleted in that window leaves a dangling id rather
      // than raising anything.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced batch, section or specialisation not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
      // The student was deleted between the load and the update.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/students/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

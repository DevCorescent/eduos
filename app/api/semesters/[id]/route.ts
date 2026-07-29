// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Semester Detail
// FLOW   : View, update and delete a tenant-owned semester.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Semester model.
// PURPOSE: Manage a single semester within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { semesterIdParamSchema, updateSemesterSchema } from "@/lib/validations/semester";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// Semester holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : semesterIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the semester filtered by BOTH
//              id and tenantId, so one owned by another tenant is simply not
//              found rather than being disclosed. No relation is expanded.
// RESPONSE   : { success: true, data: <Semester> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = semesterIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const semester = await prisma.semester.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
    });

    if (!semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(semester));
  } catch (err) {
    console.error("[GET /api/semesters/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : semesterIdParamSchema for the [id] segment, updateSemesterSchema
//              for the body. Every field optional but at least one required.
//              Neither tenantId nor academicYearId can appear in the body.
// FLOW       : Authorise → resolve tenant → validate → confirm the semester
//              belongs to this tenant (404 otherwise) → re-check semesterNumber
//              uniqueness ONLY when it is both supplied and changing, scoped to
//              the owning academic year → apply one update scoped by id and
//              tenantId.
//              At most one semester per academic year may be current; claiming
//              it clears the previous holder in the same transaction.
// RESPONSE   : { success: true, data: <Semester>,
//                message: "Semester updated" }
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

    const { tenant } = tenantGuard;

    const parsedParams = semesterIdParamSchema.safeParse(await params);
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

    const parsedBody = updateSemesterSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const semesterId = parsedParams.data.id;

    // One lookup serves three purposes: existence, tenant ownership, and the
    // current semesterNumber and owning academicYearId, which scope the
    // uniqueness re-check and the current-flag clear.
    const existing = await prisma.semester.findFirst({
      where: { id: semesterId, tenantId: tenant.id },
      select: { id: true, semesterNumber: true, academicYearId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // Only when the number is actually changing — resubmitting the semester's
    // own current number is not a conflict with itself.
    if (
      input.semesterNumber !== undefined &&
      input.semesterNumber !== existing.semesterNumber
    ) {
      const clash = await prisma.semester.findUnique({
        where: {
          academicYearId_semesterNumber: {
            academicYearId: existing.academicYearId,
            semesterNumber: input.semesterNumber,
          },
        },
        select: { id: true },
      });

      if (clash) {
        return NextResponse.json(
          fail("Semester number already in use", "CONFLICT"),
          { status: 409 }
        );
      }
    }

    // At most one semester per academic year may be current. The NOT clause
    // leaves this row untouched by the clear, and only an explicit
    // isCurrent: true triggers it.
    const semester =
      input.isCurrent === true
        ? (
            await prisma.$transaction([
              prisma.semester.updateMany({
                where: {
                  academicYearId: existing.academicYearId,
                  isCurrent: true,
                  NOT: { id: semesterId },
                },
                data: { isCurrent: false },
              }),
              prisma.semester.update({
                where: { id: semesterId, tenantId: tenant.id },
                data: input,
              }),
            ])
          )[1]
        : await prisma.semester.update({
            where: { id: semesterId, tenantId: tenant.id },
            data: input,
          });

    return NextResponse.json(ok(semester, "Semester updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Semester number already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/semesters/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : semesterIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → confirm the semester belongs to
//              this tenant (404 otherwise) → issue a single delete scoped by id
//              and tenantId.
//              No cascade is performed in application code; the database owns
//              that. Section.semesterId, Timetable.semesterId and
//              Examination.semesterId are ON DELETE RESTRICT, so any of the
//              three blocks the delete and surfaces as CONFLICT.
//              FeeDemand.semesterId is ON DELETE SET NULL, so fee demands are
//              NOT a barrier — they survive with semesterId cleared.
// RESPONSE   : { success: true, data: null, message: "Semester deleted" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = semesterIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const semesterId = parsed.data.id;

    const existing = await prisma.semester.findFirst({
      where: { id: semesterId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.semester.delete({
      where: { id: semesterId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Semester deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Semester has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/semesters/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

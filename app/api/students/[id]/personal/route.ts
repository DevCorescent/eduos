// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Personal Detail
// FLOW   : Guard → tenant → validate student id → load student (tenant-scoped)
//          → validate body → upsert StudentPersonal → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Read and maintain the one-to-one personal detail record belonging to
//          a student within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import {
  studentIdParamSchema,
  upsertStudentPersonalSchema,
} from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a personal detail record. Declared once so both handlers
 * answer with the same shape.
 *
 * Note that StudentPersonal has updatedAt but no createdAt, so no creation
 * timestamp is available to return.
 */
const PERSONAL_SELECT = {
  id: true,
  studentId: true,
  dateOfBirth: true,
  gender: true,
  bloodGroup: true,
  nationality: true,
  religion: true,
  category: true,
  motherTongue: true,
  permanentAddr: true,
  localAddr: true,
  emergencyContact: true,
  disability: true,
  disabilityDesc: true,
  updatedAt: true,
} as const;

// StudentPersonal holds no BigInt or Decimal column, so the shared serialize()
// helper is not applied. Its three address-shaped columns are Json and are cast
// at the Prisma boundary below.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the student filtered by BOTH
//              id and tenantId, pulling its personal record through a nested
//              select in the same query.
//              StudentPersonal carries no tenantId of its own; it is reachable
//              only through its student, so resolving the student is what
//              establishes tenant ownership. Fetching both together keeps this
//              to a single round trip rather than a lookup followed by a second
//              read.
//              A student owned by another tenant is reported as missing, exactly
//              like a nonexistent one. A student that exists but has no personal
//              record yet is reported separately: the caller is already
//              authorised for that student, so distinguishing the two discloses
//              nothing while telling them the record has simply not been written.
// RESPONSE   : { success: true, data: <StudentPersonal> }
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

    // One query establishes tenant ownership and returns the personal record.
    const student = await prisma.student.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: {
        id: true,
        personal: { select: PERSONAL_SELECT },
      },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    if (!student.personal) {
      return NextResponse.json(
        fail("Personal details not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(ok(student.personal));
  } catch (err) {
    console.error("[GET /api/students/[id]/personal]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PUT
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment,
//              upsertStudentPersonalSchema for the body. Every field is optional
//              but at least one must be present.
//              studentId is absent from the body schema, along with id,
//              tenantId and updatedAt, so a request supplying any of them has it
//              stripped: the route parameter alone decides which record is
//              written.
// FLOW       : Authorise → resolve tenant → validate → confirm the student
//              belongs to this tenant (404 otherwise) → upsert the personal
//              record keyed on studentId.
//              StudentPersonal.studentId is @unique, making the relation
//              one-to-one, so the upsert creates on the first write and updates
//              on every subsequent one. No separate existence check is performed
//              because the upsert already distinguishes the two cases; adding
//              one would cost a round trip and still leave the same race.
//              Omitted keys leave their columns unchanged rather than nulling
//              them, matching the update semantics used throughout the project.
// RESPONSE   : { success: true, data: <StudentPersonal>,
//                message: "Personal details saved" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function PUT(
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

    const parsedBody = upsertStudentPersonalSchema.safeParse(body);
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

    // Tenant ownership lives on Student, not on StudentPersonal, so the student
    // must be resolved before the child record is touched. Only the primary key
    // is selected — the personal record itself is not read, because the upsert
    // below does not need to know whether it exists.
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    const { permanentAddr, localAddr, emergencyContact, ...scalars } = parsedBody.data;

    // The Json columns are cast at this boundary because Zod infers
    // unknown-valued records, which Prisma's InputJsonValue does not accept
    // directly. An omitted column stays undefined so the upsert leaves it alone.
    const data = {
      ...scalars,
      permanentAddr: permanentAddr as Prisma.InputJsonValue | undefined,
      localAddr: localAddr as Prisma.InputJsonValue | undefined,
      emergencyContact: emergencyContact as Prisma.InputJsonValue | undefined,
    };

    const personal = await prisma.studentPersonal.upsert({
      where: { studentId },
      create: { studentId, ...data },
      update: data,
      select: PERSONAL_SELECT,
    });

    return NextResponse.json(ok(personal, "Personal details saved"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Two first-writes raced and both attempted the insert; studentId is
      // @unique so the database refused the second, which keeps the one-to-one
      // relation intact rather than producing a duplicate record.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Personal details are being modified concurrently", "CONFLICT"),
          { status: 409 }
        );
      }
      // The student was deleted between the ownership check and the write, so
      // the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
      }
      // The record targeted by the update half of the upsert disappeared.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PUT /api/students/[id]/personal]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

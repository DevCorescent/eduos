// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Programme Detail
// FLOW   : View, update and delete a tenant-owned programme.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Programme model.
// PURPOSE: Manage a single programme within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  programmeIdParamSchema,
  updateProgrammeSchema,
} from "@/lib/validations/programme";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// Programme holds no BigInt, Decimal or Json column — only strings, integers, a
// boolean, enums and timestamps — so neither the shared serialize() helper nor
// an InputJsonValue cast applies here. The schema is immutable, so that cannot
// change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : programmeIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the programme filtered by BOTH
//              id and tenantId, so a programme owned by another tenant is
//              simply not found rather than being disclosed. No relation is
//              expanded.
// RESPONSE   : { success: true, data: <Programme> }
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

    // Route params resolve asynchronously in this Next.js version.
    const parsed = programmeIdParamSchema.safeParse(await params);
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
    const programme = await prisma.programme.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
    });

    if (!programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(programme));
  } catch (err) {
    console.error("[GET /api/programmes/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : programmeIdParamSchema for the [id] segment,
//              updateProgrammeSchema for the body. Every field optional but at
//              least one required. tenantId cannot appear in the body, so a
//              programme cannot be moved between tenants.
// FLOW       : Authorise → resolve tenant → validate → confirm the programme
//              belongs to this tenant (404 otherwise) → issue only the checks a
//              changing field actually requires, in parallel → apply them in a
//              fixed precedence → one atomic update scoped by id and tenantId.
//              The department check is scoped by tenantId, so a department
//              owned by another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one. The database's foreign key cannot achieve this
//              alone — it verifies only that the referenced row exists.
// RESPONSE   : { success: true, data: <Programme>,
//                message: "Programme updated" }
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

    const parsedParams = programmeIdParamSchema.safeParse(await params);
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

    const parsedBody = updateProgrammeSchema.safeParse(body);
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

    const programmeId = parsedParams.data.id;

    // One lookup serves three purposes: existence, tenant ownership, and the
    // current code and departmentId used to decide which further checks are
    // needed at all.
    const existing = await prisma.programme.findFirst({
      where: { id: programmeId, tenantId: tenant.id },
      select: { id: true, code: true, departmentId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // A field resubmitted with its current value is not a change, so it costs
    // no query — re-pointing at the programme's own department or code is never
    // a conflict with itself.
    const departmentChanging =
      input.departmentId !== undefined && input.departmentId !== existing.departmentId;
    const codeChanging = input.code !== undefined && input.code !== existing.code;

    // Independent, so they are issued together rather than in sequence.
    const [department, duplicate] = await Promise.all([
      departmentChanging
        ? prisma.department.findFirst({
            where: { id: input.departmentId, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      codeChanging
        ? prisma.programme.findUnique({
            where: { tenantId_code: { tenantId: tenant.id, code: input.code as string } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // happened to resolve first: invalid references before constraint clashes.
    if (departmentChanging && !department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    if (codeChanging && duplicate) {
      return NextResponse.json(
        fail("Programme code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    const programme = await prisma.programme.update({
      where: { id: programmeId, tenantId: tenant.id },
      data: input,
    });

    return NextResponse.json(ok(programme, "Programme updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Programme code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The department was deleted between the ownership check and the update,
      // so the foreign key rejected the new reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
      }
      // The programme was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/programmes/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : programmeIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → confirm the programme belongs to
//              this tenant (404 otherwise) → issue a single delete scoped by id
//              and tenantId.
//              No cascade is performed in application code; the database owns
//              that. Every reference to Programme is ON DELETE RESTRICT —
//              Specialisation, Batch and Curriculum all block deletion — so a
//              programme carrying any of them cannot be removed and surfaces as
//              a foreign-key violation → CONFLICT. Nothing referencing a
//              programme cascades or nulls out.
// RESPONSE   : { success: true, data: null, message: "Programme deleted" }
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

    const parsed = programmeIdParamSchema.safeParse(await params);
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

    const programmeId = parsed.data.id;

    const existing = await prisma.programme.findFirst({
      where: { id: programmeId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.programme.delete({
      where: { id: programmeId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Programme deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A specialisation, batch or curriculum still references this programme;
      // the database refuses the delete rather than orphaning them. Reported,
      // not worked around.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Programme has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The programme was deleted between the lookup and the delete.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/programmes/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

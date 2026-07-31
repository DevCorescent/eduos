// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Parent Collection
// FLOW   : Guard → tenant → body validation → create Parent → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Create a parent record within the authenticated tenant, to be linked
//          to students through /api/students/[id]/parents.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { createParentSchema } from "@/lib/validations/parent";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a parent.
 *
 * annualIncome is a Decimal(12, 2). Prisma's Decimal defines its own toJSON, so
 * it serialises to a string such as "950000.50" with its scale preserved and
 * needs no help from the shared serialize() helper — that helper exists for
 * BigInt, which throws on JSON.stringify, and Parent has no BigInt column.
 * Returning the value as a string rather than a JS number is what keeps the two
 * decimal places from being rounded away in transit.
 */
const PARENT_SELECT = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  occupation: true,
  annualIncome: true,
  relation: true,
  createdAt: true,
} as const;

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createParentSchema — firstName, lastName, phone and relation
//              required; email, occupation and annualIncome optional.
//              tenantId, id and createdAt are absent from the schema and so are
//              stripped from any body that supplies them.
//              annualIncome is bounded to the column's own precision — at most
//              ten integer digits and two decimal places — because an oversized
//              value would otherwise reach Postgres and surface as a
//              numeric-overflow 500 instead of a clean 400. Only precision is
//              bounded: the column carries no sign constraint, so a negative
//              figure is accepted.
// FLOW       : Authorise → resolve tenant → parse body → create the parent under
//              the resolved tenant.
//              No lookup precedes the write. Parent has no foreign key of any
//              kind in the schema — not even on tenantId — so there is no
//              reference to verify, and it carries no unique constraint beyond
//              its primary key, so there is no duplicate to reject: two parents
//              with identical details are a legitimate outcome. Because
//              tenantId is an unconstrained column, writing the resolved tenant
//              here is the only thing that scopes the row, which is precisely
//              why the client's value is discarded rather than trusted.
// RESPONSE   : { success: true, data: <Parent>, message: "Parent created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409 is documented or handled: with no unique constraint on the
//              model, P2002 cannot be raised by this insert. A branch for it
//              would be unreachable code implying a protection that does not
//              exist.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createParentSchema.safeParse(body);
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

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context and is placed after the spread so
    // it cannot be overridden by the validated body.
    const parent = await prisma.parent.create({
      data: {
        ...parsed.data,
        tenantId: tenant.id,
      },
      select: PARENT_SELECT,
    });

    return NextResponse.json(ok(parent, "Parent created"), { status: 201 });
  } catch (err) {
    console.error("[POST /api/parents]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Parent Portal — create a parent's sign-in account (W2, PRD §32)
// FLOW   : requireRole("UNIVERSITY_ADMIN") → requireTenant() → one transaction
//          creating User + PARENT role grant + Parent.userId link.
// ACCESS : UNIVERSITY_ADMIN. A parent cannot create their own account, and the
//          platform operator does not reach into a tenant's people.
// PURPOSE: Turn an existing Parent CONTACT record into an account that can sign
//          in, which is what §32's portal requires and what Parent.userId adds.
//
// THE CREDENTIAL POLICY IS W1.6'S, REUSED UNCHANGED
//   A generated 16-character password, only its bcrypt hash stored,
//   mustChangePassword = true, and the plaintext returned ONCE in this
//   response. No mail delivery and no admin reset endpoint — neither exists,
//   and W2 does not add one.
//
// WHAT THE CLIENT MAY NOT SUPPLY
//   tenantId, userId, passwordHash and role are all absent from the schema and
//   the body is strict. The tenant comes from the resolved context, the user is
//   created here, the hash is generated here, and the role is a constant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { hashPassword } from "@/lib/auth/password";
import { generateTemporaryPassword } from "@/lib/services/platformUser.service";
import { createParentAccountSchema, parentIdParamSchema } from "@/lib/validations/parent";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** The role a parent account holds. A constant — never a value from the body. */
const PARENT_ROLE = "PARENT";

// POST
// ACCESS     : UNIVERSITY_ADMIN (+ tenant)
// VALIDATION : parentIdParamSchema for [id]; createParentAccountSchema for the
//              body — an email, and nothing else.
// FLOW       : Authorise → resolve tenant → load the Parent WITHIN this tenant
//              (404 otherwise) → refuse if it already has an account → refuse a
//              duplicate address → in ONE transaction: upsert the tenant's
//              PARENT role, create the User, grant the role, link Parent.userId.
// RESPONSE   : { success: true, data: { parent, temporaryPassword }, message }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
//
// THE ROLE IS UPSERTED, FOLLOWING THE ESTABLISHED TENANT-ROLE PATTERN
//   Role is @@unique([tenantId, name]) and a tenant provisioned by W1.4 holds
//   only UNIVERSITY_ADMIN, so PARENT may not exist yet. This mirrors exactly
//   what universityProvisioning.service does for UNIVERSITY_ADMIN — the same
//   upsert, the same isSystem flag — rather than inventing a second role
//   mechanism. PARENT is an existing name in the vocabulary; nothing new is
//   defined.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleGuard = await requireRole("UNIVERSITY_ADMIN");
    if (!roleGuard.authorized) return roleGuard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = parentIdParamSchema.safeParse(await params);
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = createParentAccountSchema.safeParse(body);
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

    const parentId = parsedParams.data.id;
    const { email } = parsedBody.data;

    // Scoped by tenant, so another university's parent is reported as absent
    // rather than confirmed to exist.
    const parent = await prisma.parent.findFirst({
      where: { id: parentId, tenantId: tenant.id },
      select: { id: true, firstName: true, lastName: true, userId: true },
    });

    if (!parent) {
      return NextResponse.json(fail("Parent not found", "NOT_FOUND"), { status: 404 });
    }

    // One account per parent. Parent.userId is @unique, so this is the readable
    // version of a constraint the database enforces anyway.
    if (parent.userId) {
      return NextResponse.json(
        fail("This parent already has an account", "CONFLICT"),
        { status: 409 }
      );
    }

    const clash = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    // One transaction. A User created without its role grant would authenticate
    // and then be refused by every guard; a role granted without the
    // Parent.userId link would authenticate into a portal with no children.
    const created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: PARENT_ROLE } },
        update: {},
        create: { tenantId: tenant.id, name: PARENT_ROLE, isSystem: true },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          firstName: parent.firstName,
          lastName: parent.lastName,
          passwordHash,
          // An administrator has seen this password, so it is a shared secret
          // until its owner replaces it. requireAuth refuses every tenant API
          // until they do (W1.4).
          mustChangePassword: true,
          isActive: true,
        },
        select: { id: true },
      });

      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });

      return tx.parent.update({
        where: { id: parent.id },
        data: { userId: user.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          relation: true,
          userId: true,
        },
      });
    });

    // PRD §47 "Data change logs". The address and the linked user, never the
    // password — see the audit service header.
    await recordAudit({
      tenantId: tenant.id,
      actor: { userId: roleGuard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.USER_CREATED,
      resource: AUDIT_RESOURCES.USER,
      resourceId: created.userId ?? undefined,
      after: { email, parentId: created.id, role: PARENT_ROLE },
    });

    return NextResponse.json(
      ok({ parent: created, temporaryPassword }, "Parent account created"),
      { status: 201 }
    );
  } catch (err) {
    // A concurrent request took the address or linked the parent between the
    // checks above and the write. Nothing was written — the transaction rolled
    // back as a whole.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        fail("This parent or email already has an account", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[POST /api/parents/[id]/account]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

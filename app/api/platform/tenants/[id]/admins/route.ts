// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — University Administrators (W1.4)
// FLOW   : requirePlatformAdmin() authorises → Zod validates the [id] segment
//          and the body → the provisioning service creates Role, User and
//          UserRole in one transaction.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Composes the EXISTING Role, User and UserRole models through
//          lib/services/universityProvisioning.service. No new model, and no
//          second user system — these are ordinary tenant users that the tenant
//          login route authenticates exactly as it does every other.
// PURPOSE: Give a university its first administrator, and let the platform see
//          which universities have one.
//
// WHY THIS EXISTS ALONGSIDE THE `admin` BLOCK ON POST /api/platform/tenants
//   That block is for onboarding, where the tenant does not exist yet and the
//   administrator must be created in the same transaction. This route is for a
//   tenant that already exists: the five that predate W1.4, and any university
//   that has lost its only administrator. Both call the same service function,
//   so the role grant, the generated password and the forced-change flag cannot
//   drift apart between the two paths.
//
// THE ROLE IS NOT A PARAMETER
//   Nothing in the request influences which role is granted — the service uses
//   a module constant. A platform operator therefore cannot provision a tenant
//   SUPER_ADMIN through this route, and that is a property of the code rather
//   than a validation rule a later caller could route around.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { provisionAdminSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import {
  listTenantAdmins,
  logProvisioningEvent,
  provisionTenantAdmin,
} from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : tenantIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No cuid shape is asserted: the id is an opaque key.
// FLOW       : Authorise → validate the param → read the tenant's users holding
//              UNIVERSITY_ADMIN → return them.
//              requireTenant is deliberately NOT used: platform routes are
//              served from the root domain, which resolves to no tenant.
// RESPONSE   : { success: true, data: { admins } } — passwordHash is absent by
//              construction; the service selects an explicit column list.
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 500 SERVER_ERROR
//
// AN UNKNOWN TENANT RETURNS AN EMPTY LIST, NOT 404. The query is scoped by
// tenantId, so a nonexistent tenant and one with no administrators are the same
// answer — and the caller already holds the tenant id from the detail page.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = tenantIdParamSchema.safeParse(await params);
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

    const admins = await listTenantAdmins(parsed.data.id);

    return NextResponse.json(ok({ admins }));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/admins]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : tenantIdParamSchema for the [id] segment, provisionAdminSchema
//              for the body — firstName, lastName and email, strict. No
//              password, no role and no tenantId: the first is generated, the
//              second is a constant, and the third comes from the route.
// FLOW       : Authorise → validate → service checks the tenant exists and the
//              address is free within it → upsert the tenant's UNIVERSITY_ADMIN
//              role, create the user with a generated password and
//              mustChangePassword, grant the role — all in one transaction.
// RESPONSE   : { success: true, data: { admin, temporaryPassword }, message }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
// The address is unique per tenant, not globally: User is @@unique([tenantId,
// email]), so the same person may legitimately hold an account at two
// universities. A 409 here means the address is taken WITHIN this university.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = tenantIdParamSchema.safeParse(await params);
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

    const parsedBody = provisionAdminSchema.safeParse(body);
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

    const result = await provisionTenantAdmin(parsedParams.data.id, parsedBody.data);

    if (!result.ok) {
      if (result.error === "TENANT_NOT_FOUND") {
        return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
      }
      return NextResponse.json(
        fail("A user with that email already exists in this university", "CONFLICT"),
        { status: 409 }
      );
    }

    logProvisioningEvent(
      "admin-provisioned",
      guard.platformUserId,
      parsedParams.data.id,
      result.value.admin.id
    );

    return NextResponse.json(
      ok(
        { admin: result.value.admin, temporaryPassword: result.value.temporaryPassword },
        "University administrator provisioned"
      ),
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/platform/tenants/[id]/admins]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

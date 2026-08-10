// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Platform User Listing / Create Platform User (W1.3)
// FLOW   : requirePlatformAdmin() authorises the caller → Zod validates the
//          request → lib/services/platformUser.service does the database work
//          → both reply in the existing ok() / fail() envelope.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Reads and writes PlatformUser, PlatformRole and PlatformUserRole
//          through the service ONLY. No tenant User, Role or Tenant row is
//          touched, and no route in this file constructs a Prisma query.
// PURPOSE: Back the platform operator directory and operator onboarding.
//
// WHY PLATFORM AUDIT EVENTS ARE console.warn AND NOT AuditLog
//   AuditLog.tenantId is required and foreign-keyed to Tenant, so a platform
//   event has nowhere of its own to live; writing it against an arbitrary
//   tenant would put platform activity inside a university's readable audit
//   trail. The platform login route made the same call for the same reason, and
//   the gap is recorded in TECHNICAL_DEBT.md rather than papered over — closing
//   it needs AuditLog.tenantId to become nullable, a change to a table eleven
//   modules already write to.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import {
  createPlatformUserSchema,
  listPlatformUsersQuerySchema,
} from "@/lib/validations/platform";
import {
  createPlatformUser,
  listPlatformUsers,
  logPlatformUserEvent,
} from "@/lib/services/platformUser.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : listPlatformUsersQuerySchema — ?page (default 1), ?limit
//              (default 20, max 100) and ?q, all coerced from search params.
// FLOW       : Authorise → validate query → one transactional page + count from
//              the service → return both.
//              requireTenant is deliberately NOT used: platform routes are
//              served from the root domain, where tenant resolution yields no
//              tenant by design.
// RESPONSE   : { success: true, data: { users, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = listPlatformUsersQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
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

    const { page, limit } = parsed.data;
    const { users, total } = await listPlatformUsers(parsed.data);

    return NextResponse.json(
      ok({
        users,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    );
  } catch (err) {
    console.error("[GET /api/platform/users]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : createPlatformUserSchema — firstName, lastName, email and role,
//              strict. `role` accepts PLATFORM_ADMIN and nothing else, so
//              SUPER_ADMIN and every tenant role name fail to parse. No
//              password is accepted: one is generated below.
// FLOW       : Authorise → parse body → validate → service resolves the role,
//              rejects a duplicate address, generates a temporary password,
//              stores only its bcrypt hash and grants the role in one
//              transaction → return the created operator AND the plaintext.
// RESPONSE   : { success: true, data: { user, temporaryPassword }, message }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 409 CONFLICT · 500 SERVER_ERROR
//
// THE PLAINTEXT IS IN THIS RESPONSE ONCE, AND NOWHERE ELSE
//   There is no mail transport in this codebase, so the alternative to handing
//   the password to the operator who created the account is an account nobody
//   can ever sign into. It is returned to an already-authenticated
//   PLATFORM_ADMIN over the same TLS connection as the rest of the console, is
//   never stored, never logged, and is useful for exactly one sign-in: the
//   account is created with mustChangePassword, so the guard permits nothing
//   until the owner replaces it.
export async function POST(request: NextRequest) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createPlatformUserSchema.safeParse(body);
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

    const result = await createPlatformUser(parsed.data);

    if (!result.ok) {
      if (result.error === "EMAIL_TAKEN") {
        return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
      }
      // The PLATFORM_ADMIN role row is missing. That is a deployment that was
      // never seeded, not anything the caller did wrong, so it is a 500.
      console.error("[POST /api/platform/users] PLATFORM_ADMIN role row is missing");
      return NextResponse.json(
        fail("Platform roles are not configured", "SERVER_ERROR"),
        { status: 500 }
      );
    }

    logPlatformUserEvent("created", guard.platformUserId, result.value.user.id);

    return NextResponse.json(
      ok(
        { user: result.value.user, temporaryPassword: result.value.temporaryPassword },
        "Platform user created"
      ),
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/platform/users]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Authentication (W1.2)
// FLOW   : Validate → PlatformUser lookup → password → role → platform session.
// ACCESS : Public. This is the platform sign-in.
// PURPOSE: Authenticate an EduOS platform operator.
//
// NO TENANT RESOLUTION ANYWHERE IN THIS FILE
//   The university login takes a tenantSlug and resolves an institution. A
//   platform operator belongs to no institution, so requiring one would mean an
//   operator must know some university's slug to administer the platform — and
//   would lock them out entirely if that university were suspended. Neither
//   requireTenant nor getTenantFromRequest is imported here.
//
// THE ONE MECHANISM THAT MAKES THE W1.1 ESCALATION IMPOSSIBLE
//   This route is the ONLY place a PLATFORM session is signed, and it signs one
//   only after a row in PlatformUser authenticates. PlatformUser has no
//   tenantId and no column any tenant API writes, so no sequence of tenant
//   operations can produce a platform session. The old attack — grant yourself
//   a tenant Role named SUPER_ADMIN — now produces a tenant token that no
//   platform guard reads.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  PLATFORM_COOKIE,
  PLATFORM_COOKIE_MAX_AGE,
  platformCookieOptions,
  signPlatformToken,
} from "@/lib/auth/platformSession";
import { PLATFORM_ADMIN_ROLE } from "@/lib/middleware/requirePlatformAdmin";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { ok, fail } from "@/types";

const platformLoginSchema = z
  .object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(8),
  })
  .strict();

/**
 * One message for every failure.
 *
 * Unknown address, wrong password, deactivated identity and "authenticates but
 * holds no platform role" all answer identically. Distinguishing them would
 * confirm which addresses are platform operators — the smallest and most
 * valuable list an attacker could build against this system.
 */
function invalid(): NextResponse {
  return NextResponse.json(fail("Invalid credentials", "AUTH_ERROR"), { status: 401 });
}

/**
 * Audit entries for platform authentication.
 *
 * WHICH TENANT DOES A PLATFORM EVENT BELONG TO?
 *   AuditLog.tenantId is required and foreign-keyed to Tenant, so a platform
 *   event has nowhere of its own to live. Writing it against an arbitrary
 *   tenant would put platform activity inside a university's audit trail, where
 *   that university could read it — so platform authentication events are NOT
 *   written to AuditLog. They are logged server-side instead.
 *
 *   This is a real gap, recorded in TECHNICAL_DEBT.md rather than papered over:
 *   closing it needs AuditLog.tenantId to become nullable, which is a change to
 *   a table eleven modules already write to and belongs in its own reviewed
 *   work package.
 */
function logPlatformAuth(outcome: string, email: string, ip: string | null): void {
  // Address and outcome only. Never the password, and never the token.
  console.warn(`[platform-auth] ${outcome} email=${email} ip=${ip ?? "unknown"}`);
}

// POST
// VALIDATION : email + password, strict. A malformed body answers the same 401
//              as a wrong password, so probing the shape reveals nothing.
// RESPONSE   : { success: true, data: { user } } and an httpOnly platform cookie.
// STATUS     : 200 · 401 · 500
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalid();
    }

    const parsed = platformLoginSchema.safeParse(body);
    if (!parsed.success) return invalid();

    const { email, password } = parsed.data;
    const { ipAddress } = readRequestOrigin(request.headers);

    const platformUser = await prisma.platformUser.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        passwordHash: true,
        platformUserRoles: { select: { platformRole: { select: { name: true } } } },
      },
    });

    if (!platformUser) {
      logPlatformAuth("unknown-account", email, ipAddress);
      return invalid();
    }

    // Verified BEFORE the isActive check, so a deactivated account and an
    // active one cost the same time — a timing difference here would confirm
    // that an address is a platform operator.
    const valid = await verifyPassword(password, platformUser.passwordHash);
    if (!valid) {
      logPlatformAuth("bad-password", email, ipAddress);
      return invalid();
    }

    if (!platformUser.isActive) {
      logPlatformAuth("inactive", email, ipAddress);
      return invalid();
    }

    const holdsAdmin = platformUser.platformUserRoles.some(
      (assignment) => assignment.platformRole.name === PLATFORM_ADMIN_ROLE
    );
    if (!holdsAdmin) {
      logPlatformAuth("no-platform-role", email, ipAddress);
      return invalid();
    }

    const token = signPlatformToken({
      sub: platformUser.id,
      email: platformUser.email,
      role: PLATFORM_ADMIN_ROLE,
    });

    await prisma.platformUser.update({
      where: { id: platformUser.id },
      data: { lastLoginAt: new Date() },
    });

    logPlatformAuth("success", email, ipAddress);

    const response = NextResponse.json(
      ok({
        user: {
          id: platformUser.id,
          email: platformUser.email,
          firstName: platformUser.firstName,
          lastName: platformUser.lastName,
          role: PLATFORM_ADMIN_ROLE,
        },
      })
    );

    response.cookies.set(
      PLATFORM_COOKIE,
      token,
      platformCookieOptions(PLATFORM_COOKIE_MAX_AGE)
    );

    return response;
  } catch (err) {
    console.error("[POST /api/super-admin/auth/login]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

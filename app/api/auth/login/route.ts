import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { loginSchema } from "@/lib/validations/auth";
import { isServableStatus } from "@/lib/domain/tenant/servable";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from "@/lib/auth/session";
import { recordAudit, recordAuditFailure } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

export async function POST(request: NextRequest) {
  try {
    // A malformed body is a client error. Previously this call sat unguarded, so
    // `{bad` threw a SyntaxError, fell through to the catch below and returned
    // 500 SERVER_ERROR — telling the caller the server had failed when in fact
    // their JSON was invalid.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        fail("Request body must be valid JSON", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      // The message used to be a bare "Invalid input" with no detail, which is
      // exactly why a request missing `tenantSlug` looked like a broken login
      // rather than an incomplete body. The response now names the offending
      // fields so the caller can fix the request without reading the source.
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

    const { email, password, tenantSlug } = parsed.data;

    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    // Allow-list, not deny-list — the same rule tenant resolution applies, from
    // one shared definition. The old inline check omitted ARCHIVED, so an
    // archived university's users could still obtain a session.
    if (!tenant || !isServableStatus(tenant.status)) {
      return NextResponse.json(fail("Tenant not found or inactive", "TENANT_ERROR"), { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive) {
      // PRD §47 "Login logs" + "Failed action logs". Written OUTSIDE any
      // transaction and awaited, so a burst of attempts against one account is
      // visible in order. `userId` is the resolved user when the account exists
      // but is deactivated, and null when the address is unknown — which is the
      // distinction an investigator needs and the response deliberately hides.
      await recordAuditFailure({
        tenantId: tenant.id,
        actor: { userId: user?.id ?? null, ...readRequestOrigin(request.headers) },
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        resource: AUDIT_RESOURCES.SESSION,
        // The address is recorded because it is what was attempted. The
        // password never is, at any point, on any path.
        after: { email, reason: user ? "account inactive" : "unknown account" },
      });

      return NextResponse.json(fail("Invalid credentials", "AUTH_ERROR"), { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await recordAuditFailure({
        tenantId: tenant.id,
        actor: { userId: user.id, ...readRequestOrigin(request.headers) },
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        resource: AUDIT_RESOURCES.SESSION,
        after: { email, reason: "incorrect password" },
      });

      return NextResponse.json(fail("Invalid credentials", "AUTH_ERROR"), { status: 401 });
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const payload = { sub: user.id, tenantId: tenant.id, email: user.email, roles };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ sub: user.id });

    await prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });

    // PRD §47 "Login logs" — the success counterpart of the two failure paths
    // above. Not inside a transaction: the session row is already committed,
    // and a login that succeeded must be recorded even if the log write is the
    // thing that fails.
    await recordAudit({
      tenantId: tenant.id,
      actor: { userId: user.id, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      resource: AUDIT_RESOURCES.SESSION,
      resourceId: user.id,
      // Roles are recorded because a login's meaning depends on what it granted.
      // No token, no hash, no cookie — see the audit service header.
      after: { email: user.email, roles },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // The tokens are returned in the body as well as set as httpOnly cookies.
    // The cookies keep the browser app working exactly as before; the body is
    // what lets an API client (Postman, mobile, CI) capture the credential at
    // all. Without it the only way to authenticate was a cookie jar, which is
    // why a Bearer-based collection could never work against this backend.
    const response = NextResponse.json(
      ok({
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        expiresIn: 7 * 24 * 60 * 60,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          roles,
          // W1.4 — reported so the client can navigate straight to the change
          // form instead of landing on a dashboard where every request answers
          // 403. This is a HINT, not the control: requireAuth re-reads the
          // column on every request, so a client that ignores this field gets
          // nowhere.
          mustChangePassword: user.mustChangePassword,
        },
      })
    );

    response.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(7 * 24 * 60 * 60));
    response.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(30 * 24 * 60 * 60));

    return response;
  } catch (error) {
  console.error("LOGIN ERROR");
  console.error(error);
  console.error(JSON.stringify(error, null, 2));

  return NextResponse.json(
    {
      success: false,
      error: "Internal Server Error",
    },
    { status: 500 }
  );
}
}

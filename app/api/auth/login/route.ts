import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { loginSchema } from "@/lib/validations/auth";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from "@/lib/auth/session";
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
    if (!tenant || tenant.status === "CANCELLED" || tenant.status === "SUSPENDED") {
      return NextResponse.json(fail("Tenant not found or inactive", "TENANT_ERROR"), { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(fail("Invalid credentials", "AUTH_ERROR"), { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
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
        },
      })
    );

    response.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(7 * 24 * 60 * 60));
    response.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(30 * 24 * 60 * 60));

    return response;
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

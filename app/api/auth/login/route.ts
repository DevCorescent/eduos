import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { loginSchema } from "@/lib/validations/auth";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from "@/lib/auth/session";
import { ok, fail } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
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

    const response = NextResponse.json(
      ok({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, roles } })
    );

    response.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(7 * 24 * 60 * 60));
    response.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(30 * 24 * 60 * 60));

    return response;
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

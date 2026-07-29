import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyToken, signAccessToken } from "@/lib/auth/jwt";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from "@/lib/auth/session";
import { ok, fail } from "@/types";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(fail("No refresh token", "UNAUTHORIZED"), { status: 401 });
  }

  try {
    // Throws on an invalid/expired refresh token — caught below and mapped to 401.
    verifyToken(refreshToken);
    const session = await prisma.session.findUnique({
      where: { refreshToken },
      include: {
        user: {
          include: { userRoles: { include: { role: true } } },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json(fail("Session expired", "UNAUTHORIZED"), { status: 401 });
    }

    const { user } = session;
    const roles = user.userRoles.map((ur) => ur.role.name);
    const newAccessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
    });

    await prisma.session.update({
      where: { id: session.id },
      data: {
        token: newAccessToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const response = NextResponse.json(ok({ accessToken: newAccessToken }));
    response.cookies.set(ACCESS_COOKIE, newAccessToken, cookieOptions(7 * 24 * 60 * 60));
    return response;
  } catch {
    return NextResponse.json(fail("Invalid refresh token", "UNAUTHORIZED"), { status: 401 });
  }
}

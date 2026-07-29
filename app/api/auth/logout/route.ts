import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/session";
import { verifyToken } from "@/lib/auth/jwt";
import { ok } from "@/types";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(ACCESS_COOKIE)?.value;

  if (token) {
    try {
      verifyToken(token);
      await prisma.session.deleteMany({ where: { token } });
    } catch {
      // token already invalid — still clear cookies
    }
  }

  const response = NextResponse.json(ok(null, "Logged out"));
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

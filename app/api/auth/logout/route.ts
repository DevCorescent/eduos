import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ACCESS_COOKIE, REFRESH_COOKIE, getAccessToken } from "@/lib/auth/session";
import { verifyToken } from "@/lib/auth/jwt";
import { ok } from "@/types";

export async function POST() {
  // Resolved through the shared transport helper, so a Bearer-authenticated
  // caller can actually end their session. Reading only the cookie (as this did
  // before) meant an API client's logout returned 200 while its Session row
  // stayed live — the token kept working until it expired.
  const token = await getAccessToken();

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

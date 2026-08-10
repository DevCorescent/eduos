// ============================================================================
// MODULE : Platform Authentication — sign out (W1.2)
// PURPOSE: Clear the platform cookie. Deliberately does not touch the tenant
//          cookies: an operator who also holds a university account should not
//          be signed out of it by leaving the platform console.
// ============================================================================

import { NextResponse } from "next/server";
import { PLATFORM_COOKIE, platformCookieOptions } from "@/lib/auth/platformSession";
import { ok } from "@/types";

// POST
// ACCESS : anyone. Signing out is never refused — a caller with no session is
//          already in the state this produces.
export async function POST() {
  const response = NextResponse.json(ok({ signedOut: true }));
  response.cookies.set(PLATFORM_COOKIE, "", platformCookieOptions(0));
  return response;
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/middleware/requireAuth";
import { ok, fail } from "@/types";
import { handleRouteError } from "@/lib/utils/api-response";

const SCOPE = "GET /api/auth/me";

export async function GET() {
  // Wrapped, like every other route in the project. Without it a database
  // error escaped the handler and Next.js answered with an HTML error page —
  // to a JSON API, from the one endpoint every client calls to establish who
  // it is. A caller parsing that response saw a syntax error rather than the
  // { success: false } envelope it handles, so a transient outage here looked
  // like a client bug. handleRouteError logs the cause and returns the
  // standard envelope; the success shape is untouched.
  try {
    // requireAuth rather than a bare getSession(). getSession() only verifies the
    // JWT signature and expiry, so this route kept answering 200 for a token that
    // /api/auth/logout had already deleted — logout did not revoke, and a leaked
    // token stayed usable here for its full 7-day lifetime. requireAuth also
    // matches the live Session row and re-checks User.isActive, which is what
    // every other protected route in the project already does via requireRole and
    // requireTenant.
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    const { session } = auth;

    const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatarUrl: true,
      tenantId: true,
      userRoles: { include: { role: true } },
    },
    });

    if (!user) {
    return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(
      ok({
        ...user,
        roles: user.userRoles.map((ur) => ur.role.name),
        userRoles: undefined,
      })
    );
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

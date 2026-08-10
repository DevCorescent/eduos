import "server-only";

import { prisma } from "@/lib/db/prisma";
import { requestScoped } from "@/lib/middleware/requestCache";

/**
 * Whether a tenant user still holds a password somebody else generated (W1.4).
 *
 * For SERVER COMPONENTS — portal layouts that need to redirect rather than
 * return an HTTP status. The API-side enforcement is requireAuth, which refuses
 * every tenant route while this is true; this function exists so a layout can
 * send the user to the form instead of rendering a console in which every panel
 * errors.
 *
 * Read from the database, not from the JWT. The flag is cleared after the token
 * was minted, so a claim in the token would stay stale for its whole lifetime —
 * which for a seven-day tenant session means the redirect would keep firing
 * after the password had already been changed.
 *
 * Memoised per request, so a layout and any nested layout that both ask cost
 * one query rather than two against a database with ~250ms round trips.
 *
 * A missing user answers false: the caller's own session guard owns "does this
 * account exist", and answering true here would redirect them to a password
 * form for an account that is gone.
 */
export async function mustChangePassword(userId: string): Promise<boolean> {
  return requestScoped(`auth:must-change-password:${userId}`, async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mustChangePassword: true },
    });

    return user?.mustChangePassword ?? false;
  });
}

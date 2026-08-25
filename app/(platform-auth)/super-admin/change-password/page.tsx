import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { getPlatformSession } from "@/lib/auth/platformSession";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata: Metadata = {
  title: "Change Password",
  robots: { index: false, follow: false },
};

/**
 * Replace a generated password (W1.3).
 *
 * WHY THIS LIVES IN (platform-auth) AND NOT IN (platform)
 *   The (platform) layout runs requirePlatformAdmin, which refuses exactly the
 *   accounts this page serves — an operator holding a password somebody else
 *   generated. Putting the page inside that group would make it unreachable by
 *   the only people who need it, and putting it behind a weakened guard would
 *   weaken the guard for every other screen in the group.
 *
 *   It is not unguarded: the check below requires a platform session, and the
 *   route it posts to requires the CURRENT password on top of that.
 *
 * REACHED TWO WAYS
 *   FORCED    — the platform layout redirects here while mustChangePassword is
 *               set, because requirePlatformAdmin refuses the console until the
 *               generated password is replaced.
 *   VOLUNTARY — the console's top-bar "Settings" item points here. It is the
 *               only page in the project that manages a platform operator's own
 *               account, and /settings cannot serve them: that screen resolves
 *               its subject with getPortalSession() and reads a User row and
 *               notification preferences, none of which a PlatformUser has.
 *               Pointing the console at it redirected operators to the tenant
 *               login form while their platform session was still valid.
 *
 *   The two arrivals mean different things, so the copy below is chosen from
 *   the flag rather than assuming the forced case. Telling an operator who came
 *   here deliberately that somebody else has seen their password is false, and
 *   stranding them with no way back is what a bare page with no console chrome
 *   would otherwise do.
 */
export default async function PlatformChangePasswordPage() {
  const session = await getPlatformSession();

  // No session at all: this page can do nothing for an anonymous visitor, and
  // sign-in is the step that precedes it.
  if (!session) redirect("/super-admin/login");

  // Which of the two arrivals this is. Read live rather than taken from the
  // token, because the flag is cleared by the change this page performs and a
  // token minted before that still claims it is set. The session is proven
  // above, so this cannot widen access; it only decides what to say.
  const operator = await prisma.platformUser.findUnique({
    where: { id: session.sub },
    select: { mustChangePassword: true },
  });

  const forced = operator?.mustChangePassword ?? false;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-50">
            <KeyRound className="size-6" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold text-heading">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {forced
              ? "Your current password was issued by another operator, who has seen it. Replace it to reach the platform console."
              : "Your password is the only account setting a platform operator holds. Changing it signs no one out, including you."}
          </p>
        </div>

        <div className="glass rounded-xl p-6">
          <ChangePasswordForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signed in as {session.email}.
        </p>

        {/* Only when the console is actually reachable. While the flag is set
            requirePlatformAdmin refuses every platform screen, so offering the
            way back would be offering a door that answers with this page. */}
        {!forced && (
          <p className="mt-2 text-center text-xs">
            <Link
              href="/platform/dashboard"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Back to the console
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

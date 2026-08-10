import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
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
 * REACHED BY REDIRECT, NOT BY A LINK
 *   Nothing in the sidebar points here, because the console is unreachable
 *   while the flag is set — the platform layout sends the operator here on
 *   their first request after signing in.
 */
export default async function PlatformChangePasswordPage() {
  const session = await getPlatformSession();

  // No session at all: this page can do nothing for an anonymous visitor, and
  // sign-in is the step that precedes it.
  if (!session) redirect("/super-admin/login");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-50">
            <KeyRound className="size-6" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold text-heading">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your current password was issued by another operator, who has seen it. Replace it to
            reach the platform console.
          </p>
        </div>

        <div className="glass rounded-xl p-6">
          <ChangePasswordForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Signed in as {session.email}.
        </p>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { getPortalSession } from "@/services/session";
import { roleLabel } from "@/constants/roles";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "No portal available" };

/**
 * Where a signed-in user lands when no portal accepts their roles.
 *
 * THIS ROUTE MUST NEVER REDIRECT A SIGNED-IN USER.
 *   It exists to terminate a redirect exchange, and it sits outside every
 *   portal route group precisely so that no layout guard runs above it. A
 *   signed-in caller always gets this page rendered. Only a caller with no
 *   session at all is sent away, to /login, which cannot bounce them back here.
 *
 * WHY THIS IS A PAGE AND NOT A SILENT REDIRECT
 *   The condition it reports is a real administrative state — an account exists
 *   and is active, but holds no role that maps to a portal. Bouncing such a
 *   user between two guards told them nothing and looked like a hung page. The
 *   roles they actually hold are printed, because that is the single fact an
 *   administrator needs in order to fix it.
 */
export default async function NoAccessPage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
            <ShieldAlert className="size-6" aria-hidden="true" />
          </span>

          <div>
            <h1 className="text-lg font-semibold text-heading">No portal available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You are signed in as{" "}
              <span className="text-foreground">{session.email}</span>, but your account
              holds no role that opens a portal.
            </p>
          </div>

          <div className="w-full rounded-md border border-border bg-muted/40 px-4 py-3 text-left">
            <p className="text-xs text-muted-foreground">Roles on your account</p>
            <p className="mt-1 text-sm text-foreground">
              {session.roles.length > 0
                ? session.roles.map(roleLabel).join(", ")
                : "None assigned"}
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            Ask an administrator to assign you a role, then sign in again.
          </p>

          <SignOutButton />
        </div>
      </Card>
    </main>
  );
}

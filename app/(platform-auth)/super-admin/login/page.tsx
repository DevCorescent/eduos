import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPlatformSession } from "@/lib/auth/platformSession";
import { PlatformLoginForm } from "./PlatformLoginForm";

export const metadata: Metadata = {
  title: "Platform Administration",
  // Kept out of search results: this page's existence is not a secret, but
  // there is no reason to advertise it.
  robots: { index: false, follow: false },
};

/**
 * EduOS platform sign-in (W1.2).
 *
 * VISUALLY DISTINCT FROM /login, DELIBERATELY
 *   The university sign-in renders a tenant's logo and colours. This one is
 *   the platform's own, in the neutral ramp with no tenant branding at all —
 *   an operator must be able to tell at a glance which system they are signing
 *   into, and there is no institution to brand it with.
 *
 * NO TENANT FIELD
 *   The university form asks for a tenant. A platform operator belongs to no
 *   university; requiring one would mean knowing some institution's slug to
 *   administer the platform, and being locked out if that institution were
 *   suspended.
 */
export default async function SuperAdminLoginPage() {
  // Already signed in — skip the form rather than showing a login screen to
  // somebody who has a valid session.
  const session = await getPlatformSession();
  if (session) redirect("/platform/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-50">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold text-heading">EduOS Platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">Platform Administration</p>
        </div>

        <div className="glass rounded-xl p-6">
          <PlatformLoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          University staff and students sign in at their own institution&rsquo;s address.
        </p>
      </div>
    </main>
  );
}

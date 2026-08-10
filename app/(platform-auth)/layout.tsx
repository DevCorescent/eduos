import type { ReactNode } from "react";

/**
 * The platform sign-in shell.
 *
 * Its own route group with NO guard, because a guard here would be circular:
 * this is where an operator goes to obtain the session every other platform
 * screen requires. It is deliberately separate from (auth), which renders the
 * university sign-in against a tenant's own branding — a platform operator
 * belongs to no tenant, so there is no branding to apply.
 */
export default function PlatformAuthLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}

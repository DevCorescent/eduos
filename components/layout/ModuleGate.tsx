import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { Card } from "@/components/ui/Card";
import { getPortalSession } from "@/services/session";
import { enabledModulesForTenant } from "@/lib/services/tenantModules";
import { MODULE_PAGE_RULES, pathAllowed } from "@/lib/constants/moduleRoutes";

/**
 * Refuse a page whose module this university has not enabled.
 *
 * WHY A COMPONENT AND NOT A CHECK INSIDE EACH PAGE
 *   Rendered from a segment `layout.tsx`, it covers that segment AND everything
 *   nested beneath it — /students also gates /students/[id], and /evaluation
 *   gates all six of its children — without a line in any page. Nine small
 *   layouts replace what would otherwise be a check in every current and every
 *   future page under them, which is the version that eventually gets forgotten
 *   on the tenth page.
 *
 * WHY IT RENDERS RATHER THAN REDIRECTS
 *   A redirect to the dashboard would answer "you typed a URL and something
 *   happened" — the reader cannot tell whether the page moved, whether they
 *   lack the role, or whether their university does not license it. This states
 *   the actual reason, which is the one their administrator can act on. It is
 *   an UnavailableState rather than an error because nothing has failed: the
 *   capability genuinely is not part of this university, and retrying will
 *   never change that.
 *
 * THIS IS NOT THE ENFORCEMENT THAT MATTERS
 *   A page is markup. The guarantee lives in requireModule on the API routes,
 *   which refuses the DATA whether or not this screen ever rendered — so a
 *   caller who skips the UI entirely gains nothing. This exists so that a
 *   person who types the URL is told something true.
 */
export async function ModuleGate({
  path,
  children,
}: {
  /** The segment being guarded, e.g. "/students". Matched against MODULE_PAGE_RULES. */
  path: string;
  children: ReactNode;
}) {
  const session = await getPortalSession();

  // The portal layout above has already redirected an anonymous visitor; this
  // is the narrow case of the session disappearing between the two reads.
  if (!session) redirect("/login");

  // Ungoverned paths cost no query — checked before the read, as in requireModule.
  if (pathAllowed(path, new Set(), MODULE_PAGE_RULES)) return <>{children}</>;

  const modules = await enabledModulesForTenant(session.tenantId);

  if (pathAllowed(path, modules, MODULE_PAGE_RULES)) return <>{children}</>;

  return (
    <>
      <PageHeader title="Not available" subtitle="This module is not enabled for your university." />
      <Card noPadding>
        <UnavailableState
          title="This module is not enabled"
          // Names the caller's OWN configuration and who can change it. It does
          // not name a plan, a price, or whether any other university has it.
          description="Your university does not currently have this module enabled. A platform administrator can enable it from the university's module settings."
        />
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonStyles } from "@/components/ui/Button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  getOnboardingProgress,
  getTenant,
  getTenantBrandingConfig,
  getTenantModules,
  getTenantStats,
  listTenantAcademicYears,
  listTenantAdmins,
  listTenantCampuses,
} from "@/services/tenants";
import { unwrapResource } from "@/lib/require-resource";
import { getSubscriptionForTenant } from "@/services/subscriptions";
import { TENANT_STATUS_LABELS, TENANT_STATUS_VARIANTS } from "@/constants/labels";
import { TenantDetailTabs } from "./TenantDetailTabs";
import { TenantAdminsPanel } from "./TenantAdminsPanel";
import { TenantStatusControl } from "./TenantStatusControl";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { TenantConfigPanels } from "./TenantConfigPanels";
import { TenantModulesPanel } from "./TenantModulesPanel";
import { TenantArchivePanel } from "./TenantArchivePanel";

/** params is a Promise in Next.js 16 — it must be awaited before destructuring. */
type Params = Promise<{ id: string }>;

/**
 * Sets the browser tab title to the institution's name.
 *
 * The fetch here is not a second round trip in practice: Next.js dedupes
 * identical fetches within one render pass, so this and the page below share
 * a single request.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getTenant(id);

  return { title: result.success ? result.data.name : "Institution" };
}

export default async function TenantDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  // Issued together rather than in sequence. None of these depends on another,
  // so awaiting them one after another would add seven round trips to first
  // paint against a database with ~250ms latency.
  const [
    tenantResult,
    statsResult,
    subscriptionResult,
    adminsResult,
    onboardingResult,
    campusesResult,
    academicYearsResult,
    brandingResult,
    modulesResult,
  ] = await Promise.all([
    getTenant(id),
    getTenantStats(id),
    getSubscriptionForTenant(id),
    listTenantAdmins(id),
    getOnboardingProgress(id),
    listTenantCampuses(id),
    listTenantAcademicYears(id),
    getTenantBrandingConfig(id),
    getTenantModules(id),
  ]);

  // notFound() renders the 404 page. Any other failure is a real error and is
  // surfaced by the route's error boundary instead — the two must not be
  // conflated, or a transient outage would tell the user the tenant was deleted.
  const tenant = unwrapResource(tenantResult, "tenant");

  return (
    <>
      <Link
        href="/platform/tenants"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to tenants
      </Link>

      <PageHeader
        title={tenant.name}
        subtitle={tenant.slug}
        action={
          <div className="flex items-center gap-3">
            {/* W1.6 · PRD §5.1 #14. Reached from the university it imports into,
                so the target tenant is the URL rather than a form field. */}
            <Link
              href={`/platform/tenants/${tenant.id}/import`}
              className={buttonStyles({ variant: "secondary", size: "sm" })}
            >
              Import data
            </Link>
            <StatusBadge
              label={TENANT_STATUS_LABELS[tenant.status]}
              variant={TENANT_STATUS_VARIANTS[tenant.status]}
              size="md"
            />
          </div>
        }
      />

      {/* Stats and subscription are passed as nullable rather than as failures
          to throw on: neither is essential to reading the tenant, so a failure
          in either degrades that one panel instead of blanking the page. */}
      <TenantDetailTabs
        tenant={tenant}
        stats={statsResult.success ? statsResult.data : null}
        statsError={statsResult.success ? null : statsResult.error}
        subscription={subscriptionResult.success ? subscriptionResult.data : null}
        subscriptionError={subscriptionResult.success ? null : subscriptionResult.error}
      />

      {/* W1.4. Both sit below the tabs rather than inside them: they are
          ACTIONS on the institution, and burying a control that removes an
          entire university's access behind a tab makes it easy to miss when
          auditing what was done to a tenant. Administrators are passed as
          nullable rather than as a failure to throw on — a failure there
          degrades this panel instead of blanking the page. */}
      <div className="mt-6 flex flex-col gap-6">
        {/* W1.5 · PRD §5.1 "Track onboarding progress" + "University readiness
            checklist". First, because it is the screen's answer to "what still
            has to happen before this university can be used" — the question a
            platform operator opens this page to ask. */}
        <OnboardingChecklist
          tenantId={tenant.id}
          progress={onboardingResult.success ? onboardingResult.data : null}
          error={onboardingResult.success ? null : onboardingResult.error}
        />

        {/* W1.5 · §5.1 campuses/affiliated colleges, academic year, branding. */}
        <TenantConfigPanels
          tenantId={tenant.id}
          campuses={campusesResult.success ? campusesResult.data.campuses : null}
          campusesError={campusesResult.success ? null : campusesResult.error}
          academicYears={
            academicYearsResult.success ? academicYearsResult.data.academicYears : null
          }
          academicYearsError={
            academicYearsResult.success ? null : academicYearsResult.error
          }
          branding={brandingResult.success ? brandingResult.data : null}
          brandingError={brandingResult.success ? null : brandingResult.error}
        />

        {/* W1.5 · PRD §2.1 "Module allocation", §5.1 "Assign enabled modules",
            over the §57 catalogue. */}
        <TenantModulesPanel
          tenantId={tenant.id}
          data={modulesResult.success ? modulesResult.data : null}
          error={modulesResult.success ? null : modulesResult.error}
        />

        <TenantAdminsPanel
          tenantId={tenant.id}
          tenantName={tenant.name}
          admins={adminsResult.success ? adminsResult.data.admins : null}
          error={adminsResult.success ? null : adminsResult.error}
        />

        <TenantStatusControl tenant={tenant} />

        {/* W1.5 · PRD §5.1 "Tenant deletion and data archival" — the archival
            half. Last on the page: it is the most consequential control here. */}
        <TenantArchivePanel tenant={tenant} />
      </div>
    </>
  );
}

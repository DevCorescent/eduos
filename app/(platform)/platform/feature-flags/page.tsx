import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Flag } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { unwrapResource } from "@/lib/require-resource";
import { getSubscriptionForTenant, listSubscriptions } from "@/services/subscriptions";
import { getTenant, listTenants } from "@/services/tenants";
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_PLAN_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_VARIANTS,
  TENANT_STATUS_LABELS,
  TENANT_STATUS_VARIANTS,
} from "@/constants/labels";
import type { Tenant } from "@/types";
import { FeatureFlagRow } from "./FeatureFlagRow";

export const metadata: Metadata = { title: "Feature Flags" };

const PAGE_SIZE = 20;

/**
 * Read wide enough to collect the flag vocabulary in use across the platform.
 * The same shape getSubscriptionForTenant already scans with.
 */
const FLAG_SCAN_LIMIT = 100;

/**
 * `tenantId` names the selected university, in the query string.
 *
 * The convention this page follows rather than inventing: /evaluation/transcript
 * uses ?studentId, /evaluation/results/semester uses ?semesterId, and
 * /attendance/report uses ?sectionId — a selected entity lives in the URL and is
 * read server-side from searchParams. That is what makes a selection linkable,
 * bookmarkable and reloadable, and it keeps the page a Server Component.
 */
type SearchParams = Promise<{ tenantId?: string; q?: string; page?: string }>;

/**
 * Per-tenant feature flags.
 *
 * WHERE THE FLAGS ACTUALLY LIVE
 *   There is no FeatureFlag model and no flag endpoint. The only per-tenant
 *   capability switch in the schema is `Subscription.features`, an untyped JSON
 *   column that PATCH /api/platform/subscriptions/[id] accepts as
 *   `Record<string, unknown>`. This screen edits exactly that, which is why the
 *   editor below is keyed by subscription even though the page is navigated by
 *   tenant.
 *
 * WHY THE FLAG NAMES ARE DISCOVERED, NOT DECLARED
 *   Nothing in the backend enumerates the valid flags — the column takes any
 *   key. A hard-coded catalogue here would show switches the product may not
 *   read and hide ones it does. So the union of keys already in use across
 *   tenants is offered, and a new key can be typed in. What the platform
 *   actually honours is a question only the code consuming these flags can
 *   answer, and it is not this one.
 *
 * WHY THE PAGE SELECTS ONE TENANT FIRST
 *   It used to render every subscription on the page at once, each with the
 *   full union of flag names beneath it. With two universities that is already
 *   hard to read, and it grows with the platform — the reviewer could not tell
 *   which switches belonged to which institution. Capabilities are reviewed and
 *   changed for ONE university at a time, so the page now opens on a searchable
 *   tenant directory and shows a single institution once one is chosen.
 *
 *   Nothing about the flag model changed. The same column, the same editor and
 *   the same replace-the-whole-map save contract are used; only how many of
 *   them are on screen at once is different.
 */
export default async function FeatureFlagsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { tenantId, q, page } = await searchParams;

  return tenantId ? (
    <SelectedTenant tenantId={tenantId} />
  ) : (
    <TenantDirectory q={q} page={page} />
  );
}

// --- Default state: choose a university -------------------------------------

/**
 * The searchable tenant directory.
 *
 * Search is served by GET /api/platform/tenants, which matches name and slug
 * case-insensitively. Nothing here reads a subscription: the plan and the flags
 * belong to the selected institution's own screen, and fetching a subscription
 * per row would put one request per tenant on a page that exists to let the
 * operator pick one.
 */
async function TenantDirectory({ q, page }: { q?: string; page?: string }) {
  // Clamped rather than trusted: ?page=0 or ?page=abc arrives from hand-edited
  // URLs and stale links.
  const currentPage = Math.max(1, Number(page) || 1);

  const result = await listTenants({ page: currentPage, limit: PAGE_SIZE, q });

  const header = (
    <PageHeader
      title="Feature Flags"
      subtitle="Choose a university to review and manage the capabilities enabled for it."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="tenants"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  return (
    <>
      {header}

      <ListToolbar search={<ListSearch placeholder="Search by name or code…" />} />

      <Card noPadding>
        <Table
          columns={directoryColumns}
          data={items}
          rowKey={(tenant) => tenant.id}
          emptyState={
            // The two empty cases need different copy. "No universities yet"
            // under an active search is simply false, and it hides the fix.
            q ? (
              <EmptyState
                icon={<Building2 />}
                title="No matching universities"
                description="No institution matches that search. Try a different term or clear it."
              />
            ) : (
              <EmptyState
                icon={<Building2 />}
                title="No universities yet"
                description="Onboard a university before configuring its capabilities."
              />
            )
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/platform/feature-flags"
            // The search travels with the page links, so paging never silently
            // drops the term the operator is looking through.
            searchParams={q ? { q } : {}}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} institutions
          </p>
        </div>
      )}
    </>
  );
}

const directoryColumns: TableColumn<Tenant>[] = [
  {
    key: "name",
    header: "Institution",
    render: (tenant) => (
      <div className="min-w-0">
        {/* Selecting a tenant is a NAVIGATION, so it is a real anchor: it
            supports middle-click and "open in new tab", and the resulting URL
            is the shareable address of that tenant's capabilities. */}
        <Link
          href={`/platform/feature-flags?tenantId=${tenant.id}`}
          className="font-medium text-foreground hover:underline"
        >
          {tenant.name}
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">{tenant.slug}</p>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (tenant) => (
      <StatusBadge
        label={TENANT_STATUS_LABELS[tenant.status]}
        variant={TENANT_STATUS_VARIANTS[tenant.status]}
      />
    ),
  },
  {
    key: "actions",
    header: <span className="sr-only">Actions</span>,
    align: "right",
    render: (tenant) => (
      <Link
        href={`/platform/feature-flags?tenantId=${tenant.id}`}
        className="text-sm font-medium text-primary hover:underline"
      >
        Manage flags
      </Link>
    ),
  },
];

// --- Selected state: one university -----------------------------------------

/**
 * One university's subscription and capabilities.
 *
 * SCOPED BY CONSTRUCTION
 *   Both reads take the tenant id from the URL, and the editor is handed the id
 *   of THAT tenant's subscription and nothing else. There is no path by which a
 *   save here reaches another institution's column.
 */
async function SelectedTenant({ tenantId }: { tenantId: string }) {
  // Issued together — neither depends on the other, and awaiting them in
  // sequence would add a round trip to first paint.
  const [tenantResult, subscriptionResult, flagScan] = await Promise.all([
    getTenant(tenantId),
    getSubscriptionForTenant(tenantId),
    // Only for the flag VOCABULARY — see knownFlags below. Its rows are never
    // rendered and no other tenant's values are shown.
    listSubscriptions({ page: 1, limit: FLAG_SCAN_LIMIT }),
  ]);

  // notFound() renders the 404 page. Any other failure is a real error and is
  // surfaced by the route's error boundary instead — conflating the two would
  // tell the operator a university was deleted during a transient outage.
  const tenant = unwrapResource(tenantResult, "tenant");

  const backLink = (
    <Link
      href="/platform/feature-flags"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      All universities
    </Link>
  );

  const header = (
    <PageHeader
      title={tenant.name}
      subtitle={`Capabilities enabled for ${tenant.slug}, stored on its subscription.`}
      action={
        <StatusBadge
          label={TENANT_STATUS_LABELS[tenant.status]}
          variant={TENANT_STATUS_VARIANTS[tenant.status]}
          size="md"
        />
      }
    />
  );

  if (!subscriptionResult.success) {
    return (
      <>
        {backLink}
        {header}
        <StateView
          state={resolveFailureState(subscriptionResult)}
          subject="the subscription"
          message={subscriptionResult.error}
        />
      </>
    );
  }

  const subscription = subscriptionResult.data;

  if (!subscription) {
    return (
      <>
        {backLink}
        {header}
        <Card noPadding>
          <div className="px-5 py-8">
            <EmptyState
              icon={<Flag />}
              title="No subscription"
              description="Flags are held on a subscription, so this university needs one before it can be given capabilities."
            />
          </div>
        </Card>
      </>
    );
  }

  // The union of every key in use across the platform, so a flag set on one
  // university can be switched on here without being retyped from memory. Only
  // the NAMES are shared; every value rendered below is this tenant's own.
  const knownFlags = Array.from(
    new Set(
      (flagScan.success ? flagScan.data.items : []).flatMap((row) =>
        Object.keys(row.features ?? {})
      )
    )
  ).sort();

  return (
    <>
      {backLink}
      {header}

      <div className="flex flex-col gap-6">
        <Card header={<h2 className="text-sm font-semibold text-heading">Subscription</h2>}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Plan" value={SUBSCRIPTION_PLAN_LABELS[subscription.plan]} />
            <Field
              label="Status"
              value={
                <StatusBadge
                  label={SUBSCRIPTION_STATUS_LABELS[subscription.status]}
                  variant={SUBSCRIPTION_STATUS_VARIANTS[subscription.status]}
                />
              }
            />
            <Field
              label="Billing cycle"
              value={BILLING_CYCLE_LABELS[subscription.billingCycle]}
            />
            <Field
              label="Student limit"
              value={subscription.maxStudents ?? "No limit"}
            />
          </dl>
        </Card>

        <Alert variant="info">
          Flags are stored on this university&apos;s subscription. Saving replaces its whole
          flag set — the switches below are read from what is currently stored and written
          back together. Names already in use elsewhere on the platform are offered so a
          capability can be enabled here without retyping it.
        </Alert>

        <Card noPadding>
          <FeatureFlagRow
            subscriptionId={subscription.id}
            tenantName={tenant.name}
            plan={subscription.plan}
            features={subscription.features ?? {}}
            knownFlags={knownFlags}
          />
        </Card>
      </div>
    </>
  );
}

/** One label/value pair in the subscription summary. */
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

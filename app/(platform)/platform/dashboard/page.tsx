import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Gauge,
  IndianRupee,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listTenants } from "@/services/tenants";
import { listSubscriptions } from "@/services/subscriptions";
import { getPortalSession } from "@/services/session";
import { buttonStyles } from "@/components/ui/Button";
import { displayNameFromEmail } from "@/utils/user";
import { formatCurrency } from "@/utils/format";
import { HeroBanner } from "./HeroBanner";
import { UnavailablePanel } from "./UnavailablePanel";
import { TENANT_STATUS_LABELS, TENANT_STATUS_VARIANTS, INSTITUTION_TYPE_LABELS } from "@/constants/labels";
import { formatDate, formatNumber } from "@/utils/format";
import type { Tenant } from "@/types";

export const metadata: Metadata = {
  title: "Platform Dashboard",
};

/** Rows shown in the "recently onboarded" panel. */
const RECENT_LIMIT = 8;

/**
 * Platform overview.
 *
 * The four totals are counted here rather than read from a stats endpoint,
 * because none exists — there is no GET /api/platform/stats, and
 * /api/platform/tenants/[id]/stats is per-tenant and returns only student and
 * faculty counts. Counting client-side over a fetched page would be wrong at
 * any real scale; this asks for one large page and counts it, which is honest
 * about being a stand-in and is the single call the mock can satisfy today.
 *
 * A dedicated aggregate endpoint is the right fix, and it would change only
 * this file.
 */
export default async function PlatformDashboardPage() {
  // limit is capped at 100 by the backend's own validation, so this is the
  // widest single page the contract permits.
  // Issued together — neither depends on the other, and awaiting them in
  // sequence would put a second round trip on first paint.
  const [session, result, subscriptionsResult] = await Promise.all([
    getPortalSession(),
    listTenants({ page: 1, limit: 100 }),
    listSubscriptions({ page: 1, limit: 100 }),
  ]);

  if (!result.success) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Platform-wide overview across all tenants." />
        <StateView
          state={resolveFailureState(result)}
          subject="the dashboard"
          message={result.error}
        />
      </>
    );
  }

  const tenants = result.data.items;
  const totalCount = result.data.pagination.total;

  const activeCount = tenants.filter((t) => t.status === "ACTIVE").length;
  const trialCount = tenants.filter((t) => t.status === "TRIAL").length;

  // Revenue is not derivable from the tenant list. Rather than invent a figure,
  // the card reports what is actually known — how many institutions are on a
  // paid footing — and the subscriptions screen owns the money.
  const recent = tenants.slice(0, RECENT_LIMIT);

  const subscriptions = subscriptionsResult.success ? subscriptionsResult.data.items : [];

  // Monthly recurring revenue, normalised to a month so annual and monthly
  // plans are comparable. Only subscriptions that are actually billing count —
  // a TRIAL is not revenue, and counting it would overstate the figure the
  // platform is judged on. Null when nothing could be read, never zero.
  const mrr = subscriptionsResult.success
    ? subscriptions
        .filter((s) => s.status === "ACTIVE")
        .reduce((total, s) => {
          const price = Number(s.pricePerMonth ?? 0);
          if (!Number.isFinite(price)) return total;
          return total + (s.billingCycle === "ANNUAL" ? price / 12 : price);
        }, 0)
    : null;

  const planCounts = subscriptions.reduce<Record<string, number>>((acc, s) => {
    acc[s.plan] = (acc[s.plan] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Platform Overview"
        subtitle="Every institution on the platform, at a glance."
      />

      <HeroBanner
        title={`Welcome back, ${session ? displayNameFromEmail(session.email) : "Admin"}`}
        description={
          <>
            {formatNumber(totalCount)} institution{totalCount === 1 ? "" : "s"} onboarded,
            {" "}
            {formatNumber(activeCount)} active and {formatNumber(trialCount)} on trial.
          </>
        }
        action={
          <Link href="/platform/tenants" className={buttonStyles({ variant: "primary" })}>
            <ArrowRight className="size-4" aria-hidden="true" />
            Manage institutions
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Institutions"
          value={formatNumber(totalCount)}
          icon={<Building2 className="size-5" />}
        />
        <StatCard
          label="Active"
          value={formatNumber(activeCount)}
          icon={<CheckCircle2 className="size-5" />}
        />
        <StatCard
          label="On Trial"
          value={formatNumber(trialCount)}
          icon={<Clock className="size-5" />}
        />
        <StatCard
          label="Monthly Revenue"
          // Null renders as an em dash. Zero would assert that the platform
          // earns nothing, which is a different and much stronger claim than
          // "the subscription list could not be read".
          value={mrr === null ? "—" : formatCurrency(mrr)}
          icon={<IndianRupee className="size-5" />}
          caption={mrr === null ? undefined : "Normalised to a month"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card
        className="lg:col-span-2"
        noPadding
        header={
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-heading">Recently onboarded</h2>
            <Link
              href="/platform/tenants"
              className="text-sm font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
        }
      >
        <Table
          columns={recentColumns}
          data={recent}
          rowKey={(tenant) => tenant.id}
          emptyState={
            <EmptyState
              icon={<Building2 />}
              title="No institutions yet"
              description="Onboard the first university to get started."
            />
          }
        />
      </Card>

      <div className="flex flex-col gap-6">
        <Card
          header={
            <div className="flex items-center gap-2">
              <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-heading">Subscriptions</h2>
            </div>
          }
        >
          {!subscriptionsResult.success ? (
            <p className="py-4 text-sm text-muted-foreground">
              Could not be read: {subscriptionsResult.error}
            </p>
          ) : subscriptions.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No subscription has been created yet.
            </p>
          ) : (
            <dl className="space-y-3">
              {Object.entries(planCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([plan, count]) => (
                  <div key={plan} className="flex items-center justify-between gap-3">
                    <dt className="truncate text-sm text-foreground">{plan}</dt>
                    <dd className="shrink-0 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-800">
                      {formatNumber(count)}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
        </Card>

        <UnavailablePanel
          title="Resource Usage"
          subtitle="Current platform load"
          icon={<Gauge className="size-5" />}
          reason="No metrics endpoint exists yet. CPU, memory and storage figures need a platform telemetry source before they can be shown."
        />
      </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <UnavailablePanel
          title="System Health"
          subtitle="Uptime and incidents"
          icon={<Activity className="size-5" />}
          reason="No health or status endpoint is implemented. Uptime cannot be reported without one, and an assumed figure on this page would be worse than none."
        />
        <UnavailablePanel
          title="AI Insights"
          subtitle="Predictive analytics"
          icon={<Sparkles className="size-5" />}
          reason="The AI routes answer questions within a single tenant. Platform-wide insight needs a cross-tenant analytics endpoint, which does not exist yet."
        />
      </div>
    </>
  );
}

/**
 * Declared at module scope, not inside the component.
 *
 * The array is constant, so rebuilding it on every render would allocate a new
 * one — and a new `render` closure per column — for no benefit.
 */
const recentColumns: TableColumn<Tenant>[] = [
  {
    key: "name",
    header: "Institution",
    render: (tenant) => (
      <Link
        href={`/platform/tenants/${tenant.id}`}
        className="font-medium text-foreground hover:underline"
      >
        {tenant.name}
      </Link>
    ),
  },
  {
    key: "slug",
    header: "Code",
    render: (tenant) => <span className="font-mono text-xs text-muted-foreground">{tenant.slug}</span>,
  },
  {
    key: "type",
    header: "Type",
    render: (tenant) => INSTITUTION_TYPE_LABELS[tenant.type],
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
    key: "createdAt",
    header: "Onboarded",
    render: (tenant) => (
      <span className="text-muted-foreground">{formatDate(tenant.createdAt)}</span>
    ),
  },
];

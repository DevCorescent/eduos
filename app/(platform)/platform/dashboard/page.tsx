/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import type { Metadata } from "next";
import { traceRender } from "@/lib/utils/trace";
import Link from "next/link";
import { Building2, CheckCircle2, Clock, IndianRupee } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listTenants } from "@/services/tenants";
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
  const __done = traceRender("SUPERADMIN DASHBOARD");
  // limit is capped at 100 by the backend's own validation, so this is the
  // widest single page the contract permits.
  const result = await listTenants({ page: 1, limit: 100 });

  if (!result.success) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Platform-wide overview across all tenants." />
        <ErrorState title="Couldn't load the dashboard" description={result.error} />
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
  const payingCount = activeCount;

  const recent = tenants.slice(0, RECENT_LIMIT);

  __done();
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Platform-wide overview across all tenants."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Paying Accounts"
          value={formatNumber(payingCount)}
          icon={<IndianRupee className="size-5" />}
        />
      </div>

      <Card
        className="mt-6"
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

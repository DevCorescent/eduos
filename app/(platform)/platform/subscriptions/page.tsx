import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listSubscriptions } from "@/services/subscriptions";
import { listTenants } from "@/services/tenants";
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_PLAN_LABELS,
  SUBSCRIPTION_PLAN_VARIANTS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_VARIANTS,
} from "@/constants/labels";
import {
  SUBSCRIPTION_PLAN_VALUES,
  SUBSCRIPTION_STATUS_VALUES,
  type Subscription,
} from "@/types";
import { formatCurrency, formatDate, formatNumber } from "@/utils/format";

export const metadata: Metadata = {
  title: "Subscriptions",
};

const PAGE_SIZE = 20;

type SearchParams = Promise<{ status?: string; plan?: string; page?: string }>;

/** A subscription row joined to the institution it belongs to, for display. */
interface SubscriptionRow extends Subscription {
  tenantName: string;
  tenantSlug: string;
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, plan, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  // A subscription row carries only tenantId — the route includes no relation —
  // so the institution's name has to come from a second call. Both are issued
  // together rather than in sequence: neither depends on the other.
  //
  // Fetching the tenant page at the API's maximum limit is a stand-in. It is
  // correct while the platform holds tens of institutions and wrong at
  // thousands; the real fix is `include: { tenant: ... }` on the subscriptions
  // route, which would delete this second call entirely.
  const [subscriptionsResult, tenantsResult] = await Promise.all([
    listSubscriptions({ page: currentPage, limit: PAGE_SIZE, status, plan }),
    listTenants({ page: 1, limit: 100 }),
  ]);

  const header = (
    <PageHeader
      title="Subscriptions"
      subtitle="Billing plan and status across every institution."
    />
  );

  if (!subscriptionsResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(subscriptionsResult)}
          subject="subscriptions"
          message={subscriptionsResult.error}
        />
      </>
    );
  }

  const { items, pagination } = subscriptionsResult.data;

  // A Map, not repeated .find() inside the render: linear lookup per row turns
  // this into O(rows × tenants) for no reason.
  const tenantsById = new Map(
    (tenantsResult.success ? tenantsResult.data.items : []).map((t) => [t.id, t])
  );

  const rows: SubscriptionRow[] = items.map((subscription) => {
    const tenant = tenantsById.get(subscription.tenantId);
    return {
      ...subscription,
      // Falls back to the id rather than blank, so an unresolved row is still
      // traceable instead of looking like missing data.
      tenantName: tenant?.name ?? subscription.tenantId,
      tenantSlug: tenant?.slug ?? "—",
    };
  });

  // Computed over the current page only, and labelled as such below. The
  // platform-wide figure needs an aggregate endpoint that does not exist yet;
  // presenting a page total as the whole would be a plain misstatement.
  const pageRevenue = rows
    .filter((row) => row.status === "ACTIVE")
    .reduce((total, row) => total + Number(row.pricePerMonth ?? 0), 0);

  const activeOnPage = rows.filter((row) => row.status === "ACTIVE").length;
  const pastDueOnPage = rows.filter((row) => row.status === "PAST_DUE").length;

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active (this page)" value={formatNumber(activeOnPage)} />
        <StatCard label="Past due (this page)" value={formatNumber(pastDueOnPage)} />
        <StatCard
          label="MRR (this page)"
          value={formatCurrency(pageRevenue)}
          icon={<CreditCard className="size-5" />}
        />
      </div>

      <ListToolbar
        className="mt-6"
        filters={
          <>
            <ListFilter
              paramKey="status"
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={SUBSCRIPTION_STATUS_VALUES.map((value) => ({
                value,
                label: SUBSCRIPTION_STATUS_LABELS[value],
              }))}
            />
            <ListFilter
              paramKey="plan"
              label="Plan"
              hideLabel
              allLabel="All plans"
              options={SUBSCRIPTION_PLAN_VALUES.map((value) => ({
                value,
                label: SUBSCRIPTION_PLAN_LABELS[value],
              }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[48rem]"
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<CreditCard />}
              title="No subscriptions"
              description="No subscription matches these filters."
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/platform/subscriptions"
            searchParams={{
              ...(status ? { status } : {}),
              ...(plan ? { plan } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

const columns: TableColumn<SubscriptionRow>[] = [
  {
    key: "tenantName",
    header: "Institution",
    render: (row) => (
      <div className="min-w-0">
        <Link
          href={`/platform/tenants/${row.tenantId}`}
          className="font-medium text-foreground hover:underline"
        >
          {row.tenantName}
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">{row.tenantSlug}</p>
      </div>
    ),
  },
  {
    key: "plan",
    header: "Plan",
    render: (row) => (
      <StatusBadge
        label={SUBSCRIPTION_PLAN_LABELS[row.plan]}
        variant={SUBSCRIPTION_PLAN_VARIANTS[row.plan]}
        withDot={false}
      />
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <StatusBadge
        label={SUBSCRIPTION_STATUS_LABELS[row.status]}
        variant={SUBSCRIPTION_STATUS_VARIANTS[row.status]}
      />
    ),
  },
  {
    key: "billingCycle",
    header: "Cycle",
    render: (row) => BILLING_CYCLE_LABELS[row.billingCycle],
  },
  {
    key: "pricePerMonth",
    header: "Price / month",
    align: "right",
    render: (row) =>
      row.pricePerMonth ? (
        formatCurrency(row.pricePerMonth, row.currency)
      ) : (
        <span className="text-muted-foreground">Trial</span>
      ),
  },
  {
    key: "endDate",
    header: "Renews / ends",
    render: (row) => (
      <span className="text-muted-foreground">{formatDate(row.endDate)}</span>
    ),
  },
];

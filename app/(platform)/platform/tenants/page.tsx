import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listTenants } from "@/services/tenants";
import {
  INSTITUTION_TYPE_LABELS,
  TENANT_STATUS_LABELS,
  TENANT_STATUS_VARIANTS,
} from "@/constants/labels";
import { INSTITUTION_TYPE_VALUES, TENANT_STATUS_VALUES, type Tenant } from "@/types";
import { formatDate } from "@/utils/format";
/**
 * The onboarding control, as a link rather than a modal trigger (W1.4).
 *
 * Provisioning now creates a university, its subscription and its first
 * administrator together, and can end by disclosing a one-time password — more
 * than a dialog above a list should carry, so it has its own page.
 */
function ProvisionLink() {
  return (
    <Link href="/platform/tenants/new" className={buttonStyles({})}>
      Provision university
    </Link>
  );
}

export const metadata: Metadata = {
  title: "Tenants",
};

const PAGE_SIZE = 20;

/**
 * searchParams is a Promise in Next.js 16, exactly like params.
 *
 * Every value is `string | undefined`: a query param is always text, and a
 * repeated key would arrive as an array, which none of these are.
 */
type SearchParams = Promise<{
  q?: string;
  status?: string;
  type?: string;
  page?: string;
}>;

/**
 * The tenant directory.
 *
 * A Server Component that reads its filters straight from the URL and fetches
 * on the server, so the first paint already has rows — no spinner, no client
 * effect. The interactive controls are the only client boundaries, and each is
 * small: they write to the URL and this page re-renders with new data.
 */
export default async function TenantsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, type, page } = await searchParams;

  // Clamped rather than trusted: ?page=0 or ?page=abc arrives from hand-edited
  // URLs and stale links, and a non-positive skip is a database error, not a
  // user-visible empty page.
  const currentPage = Math.max(1, Number(page) || 1);

  const result = await listTenants({ page: currentPage, limit: PAGE_SIZE, q, status, type });

  const header = (
    <PageHeader
      title="Tenants"
      subtitle="Every institution onboarded to the platform."
      action={<ProvisionLink />}
    />
  );

  /**
   * The same header with its create/manage controls withheld.
   *
   * Rendered when the list request itself failed. A 403 there means this role
   * has no access to the collection at all, so an "Invite user" button beside
   * the refusal would offer an action the backend will reject — the control
   * would be a claim the API does not honour.
   */
  const failureHeader = (
    <PageHeader title="Tenants" subtitle="Every institution onboarded to the platform." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="tenants"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(q || status || type);

  return (
    <>
      {header}

      {/* Live controls. They were rendered disabled while the endpoint accepted
          page and limit only; GET /api/platform/tenants now takes ?q, ?status
          and ?type, so the `unsupported` prop is gone and each control writes
          its key to the URL. "All statuses" and "All types" write an empty
          value, which useListParams removes from the URL entirely — that is how
          they mean "no restriction", and the schema treats an empty key the
          same way for a hand-edited URL. */}
      <ListToolbar
        search={<ListSearch placeholder="Search by name or code…" />}
        filters={
          <>
            <ListFilter
              paramKey="status"
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={TENANT_STATUS_VALUES.map((value) => ({
                value,
                label: TENANT_STATUS_LABELS[value],
              }))}
            />
            <ListFilter
              paramKey="type"
              label="Type"
              hideLabel
              allLabel="All types"
              options={INSTITUTION_TYPE_VALUES.map((value) => ({
                value,
                label: INSTITUTION_TYPE_LABELS[value],
              }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(tenant) => tenant.id}
          emptyState={
            // The two empty cases need different copy. "No tenants yet" under
            // an active filter is simply false, and it hides the fix — which is
            // to clear the filter, not to onboard anything.
            hasFilters ? (
              <EmptyState
                icon={<Building2 />}
                title="No matching institutions"
                description="No institution matches these filters. Try a different search or clear the filters."
              />
            ) : (
              <EmptyState
                icon={<Building2 />}
                title="No institutions yet"
                description="Onboard the first university to get started."
                action={<ProvisionLink />}
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
            basePath="/platform/tenants"
            // Filters travel with the page links, so paging never silently
            // drops the filter the user is looking through.
            searchParams={{
              ...(q ? { q } : {}),
              ...(status ? { status } : {}),
              ...(type ? { type } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} institutions
          </p>
        </div>
      )}
    </>
  );
}

const columns: TableColumn<Tenant>[] = [
  {
    key: "name",
    header: "Institution",
    render: (tenant) => (
      <div className="min-w-0">
        <Link
          href={`/platform/tenants/${tenant.id}`}
          className="font-medium text-foreground hover:underline"
        >
          {tenant.name}
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">{tenant.slug}</p>
      </div>
    ),
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
    key: "contactEmail",
    header: "Contact",
    render: (tenant) => (
      <span className="text-muted-foreground">{tenant.contactEmail ?? "—"}</span>
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

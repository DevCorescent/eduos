import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listAuditLogs, type AuditEntryRow } from "@/services/audit";
import { AUDIT_ACTIONS, AUDIT_PAGE_SIZE, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { AuditStatus } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatDateTime } from "@/utils/format";

export const metadata: Metadata = { title: "Audit Trail" };

type SearchParams = Promise<{
  action?: string;
  resource?: string;
  status?: string;
  page?: string;
}>;

/**
 * PRD §47 — the institution's audit trail.
 *
 * EVERY CONTROL ON THIS PAGE IS REAL
 *   Action, resource and status each map to a WHERE clause in the route. There
 *   is deliberately NO search box: `before` and `after` are Json columns that
 *   Postgres cannot index for substring search at this scale, and a search
 *   field that quietly filtered nothing would be worse than none — a reader
 *   would conclude the trail contains nothing rather than that the control does
 *   nothing. Date-range and actor filters exist in the API and are not surfaced
 *   yet; they are recorded as remaining work rather than faked here.
 *
 * SNAPSHOTS ARE NOT ON THIS SCREEN
 *   `before` and `after` may carry a student's identifier, a fee amount, an
 *   email. The list endpoint does not return them, so browsing the trail moves
 *   none of it over the wire. Opening one entry is a separate, authorised,
 *   single-row read.
 *
 * NOTHING HERE MUTATES
 *   There is no edit control and no delete control, because there is no
 *   endpoint behind either. An audit record its subject can alter is not
 *   evidence of anything.
 */
export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);

  const result = await listAuditLogs({
    page: currentPage,
    limit: AUDIT_PAGE_SIZE,
    action: params.action,
    resource: params.resource,
    status: params.status as AuditStatus | undefined,
  });

  const header = (
    <PageHeader
      title="Audit Trail"
      subtitle="Who changed what, and when. Records here cannot be edited or removed."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="audit records"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(params.action || params.resource || params.status);

  const columns: TableColumn<AuditEntryRow>[] = [
    {
      key: "createdAt",
      header: "When",
      render: (row) => (
        <time dateTime={row.createdAt} className="text-sm text-muted-foreground">
          {formatDateTime(row.createdAt)}
        </time>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.action}</p>
          <p className="truncate text-xs text-muted-foreground">{row.resource}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Result",
      render: (row) => (
        <Badge variant={row.status === "SUCCESS" ? "success" : "danger"} size="sm">
          {row.status === "SUCCESS" ? "Succeeded" : "Refused"}
        </Badge>
      ),
    },
    {
      key: "userId",
      header: "Actor",
      render: (row) =>
        // A failed login has no user yet. "System" would be a lie — nobody
        // performed it on the institution's behalf.
        row.userId ? (
          <span className="font-mono text-xs text-foreground">{row.userId}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Unauthenticated</span>
        ),
    },
    {
      key: "resourceId",
      header: "Subject",
      render: (row) =>
        row.resourceId ? (
          <span className="font-mono text-xs text-muted-foreground">{row.resourceId}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "detail",
      header: "",
      render: (row) => (
        <Link
          href={`/governance/audit/${row.id}`}
          className="text-sm font-medium text-foreground hover:underline"
        >
          Open
        </Link>
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        filters={
          <>
            <ListFilter
              paramKey="action"
              label="Action"
              hideLabel
              allLabel="All actions"
              options={Object.values(AUDIT_ACTIONS).map((value) => ({
                value,
                label: value.replace(/_/g, " ").toLowerCase(),
              }))}
            />
            <ListFilter
              paramKey="resource"
              label="Resource"
              hideLabel
              allLabel="All resources"
              options={Object.values(AUDIT_RESOURCES).map((value) => ({
                value,
                label: value.replace(/_/g, " ").toLowerCase(),
              }))}
            />
            <ListFilter
              paramKey="status"
              label="Result"
              hideLabel
              allLabel="Succeeded and refused"
              options={enumOptions(AuditStatus)}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={items}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<ScrollText />}
              title={hasFilters ? "Nothing matches these filters" : "No audit records"}
              description={
                hasFilters
                  ? "The action filter offers the events this build records. Older entries written by earlier phases use their own action names and may not appear under these options."
                  : "Sign-ins, role changes, identifier issues and certificate issues will appear here as they happen."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/governance/audit"
            searchParams={{
              ...(params.action ? { action: params.action } : {}),
              ...(params.resource ? { resource: params.resource } : {}),
              ...(params.status ? { status: params.status } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

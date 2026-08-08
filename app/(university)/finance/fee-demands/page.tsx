import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveUiState, type UiState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getFinanceSummary, listFeeDemands } from "@/services/finance";
import { FEE_STATUS_LABELS, FEE_STATUS_VARIANTS } from "@/constants/labels";
import { FEE_STATUS_VALUES, type FeeDemandRow } from "@/types";
import { formatCurrency, formatDate, formatNumber } from "@/utils/format";
import { WaiveDemandButton } from "./WaiveDemandButton";

export const metadata: Metadata = { title: "Fee Demands" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ q?: string; status?: string; page?: string }>;

export default async function FeeDemandsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, summaryResult] = await Promise.all([
    listFeeDemands({ page: currentPage, limit: PAGE_SIZE, q, status }),
    getFinanceSummary(),
  ]);

  const header = (
    <PageHeader
      title="Fee Demands"
      subtitle="The fee ledger — what has been billed, collected and waived."
      action={
        <Link
          href="/finance/fee-demands/generate"
          className={buttonStyles({ variant: "secondary" })}
        >
          Generate demands
        </Link>
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveUiState(result) as Exclude<UiState, "success" | "loading">}
          subject="fee demands"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;
  const summary = summaryResult.success ? summaryResult.data : null;

  const columns: TableColumn<FeeDemandRow>[] = [
    {
      key: "studentName",
      header: "Student",
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/students/${row.studentId}`}
            className="font-medium text-foreground hover:underline"
          >
            {row.studentName}
          </Link>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.enrollmentNo}
          </p>
        </div>
      ),
    },
    {
      key: "programmeCode",
      header: "Programme",
      render: (row) => <span className="text-muted-foreground">{row.programmeCode ?? "—"}</span>,
    },
    {
      key: "totalAmount",
      header: "Billed",
      align: "right",
      render: (row) => formatCurrency(row.totalAmount),
    },
    {
      key: "paidAmount",
      header: "Paid",
      align: "right",
      render: (row) => (
        <span className="text-success">{formatCurrency(row.paidAmount)}</span>
      ),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) =>
        row.outstanding > 0 ? (
          <span className="font-semibold text-danger">{formatCurrency(row.outstanding)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={FEE_STATUS_LABELS[row.status]}
          variant={FEE_STATUS_VARIANTS[row.status]}
        />
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => (
        <span className="text-muted-foreground">{formatDate(row.dueDate)}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      // Only an unsettled demand can be waived — offering it on a paid one
      // would be a control that can only fail.
      render: (row) =>
        row.status === "PAID" || row.status === "WAIVED" ? null : (
          <WaiveDemandButton
            id={row.id}
            studentName={row.studentName}
            outstanding={row.outstanding}
          />
        ),
    },
  ];

  return (
    <>
      {header}

      {summary && (
        // Only what GET /api/finance/report actually returns. Collected,
        // outstanding and an overdue count were read here too and were all
        // undefined — the endpoint sends three totals and never sent those.
        // Showing them as zero would state that nothing has been collected,
        // which is a claim about the institution's finances rather than a
        // gap in an API.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Demands Raised"
            value={formatNumber(summary.totalDemands)}
          />
          <StatCard
            label="Total Billed"
            value={formatCurrency(Number(summary.totalDemandAmount))}
          />
          <StatCard
            label="Waived"
            value={formatCurrency(Number(summary.totalWaivedAmount))}
          />
        </div>
      )}

      <ListToolbar
        className="mt-6"
        search={<ListSearch placeholder="Search by student or enrolment number…" />}
        filters={
          <ListFilter
            paramKey="status"
            label="Status"
            hideLabel
            allLabel="All statuses"
            options={FEE_STATUS_VALUES.map((value) => ({
              value,
              label: FEE_STATUS_LABELS[value],
            }))}
          />
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
              icon={<Receipt />}
              title={q || status ? "No matching demands" : "No fee demands yet"}
              description={
                q || status
                  ? "No demand matches these filters."
                  : "Generate demands for a batch to start the ledger."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/finance/fee-demands"
            searchParams={{ ...(q ? { q } : {}), ...(status ? { status } : {}) }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} demands
          </p>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Waiving records a concession against the demand — the original charge is kept, so the
        waiver stays visible to an audit.
      </p>
    </>
  );
}

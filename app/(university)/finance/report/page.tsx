import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getFinanceSummary } from "@/services/finance";
import { FEE_STATUS_LABELS, FEE_STATUS_VARIANTS } from "@/constants/labels";
import { formatCurrency, formatNumber, formatPercent } from "@/utils/format";
import type { FeeStatus } from "@/types";

export const metadata: Metadata = { title: "Finance Report" };

interface StatusRow {
  status: FeeStatus;
  count: number;
  amount: number;
  share: number;
}

export default async function FinanceReportPage() {
  const result = await getFinanceSummary();

  const header = (
    <PageHeader
      title="Finance Report"
      subtitle="Collection performance across the fee ledger."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load the report" description={result.error} />
      </>
    );
  }

  const summary = result.data;

  // Collection efficiency is measured against what is actually collectable —
  // billed minus waived. Measuring against the gross billed figure would
  // penalise the institution for concessions it chose to grant.
  const collectable = summary.demanded - summary.waived;
  const efficiency = collectable === 0 ? 0 : (summary.collected / collectable) * 100;

  const rows: StatusRow[] = summary.byStatus.map((entry) => ({
    ...entry,
    share: summary.demanded === 0 ? 0 : (entry.amount / summary.demanded) * 100,
  }));

  const columns: TableColumn<StatusRow>[] = [
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
      key: "count",
      header: "Demands",
      align: "right",
      render: (row) => formatNumber(row.count),
    },
    {
      key: "amount",
      header: "Value",
      align: "right",
      render: (row) => formatCurrency(row.amount),
    },
    {
      key: "share",
      header: "Share of billed",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          {/* A bar alongside the number: proportions are what this table is
              read for, and comparing seven percentages by eye is slower than
              comparing seven lengths. */}
          <span
            aria-hidden="true"
            className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.min(row.share, 100)}%` }}
            />
          </span>
          <span className="w-12 text-right tabular-nums">
            {formatPercent(row.share, 1)}
          </span>
        </div>
      ),
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Billed"
          value={formatCurrency(summary.demanded)}
          caption="Gross demand raised"
        />
        <StatCard
          label="Collected"
          value={formatCurrency(summary.collected)}
          caption={`${formatPercent(efficiency, 1)} of collectable`}
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(summary.outstanding)}
          caption="Billed − collected − waived"
        />
        <StatCard
          label="Waived"
          value={formatCurrency(summary.waived)}
          caption="Concessions granted"
        />
      </div>

      <Card
        className="mt-6"
        noPadding
        header={<h2 className="text-sm font-semibold text-heading">Ledger by status</h2>}
      >
        <Table columns={columns} data={rows} rowKey={(row) => row.status} />
      </Card>

      <div className="mt-4 space-y-1 text-xs text-muted-foreground">
        <p>
          Collection efficiency is measured against billed minus waived, not gross billed —
          a waived amount is never going to be collected, and counting it would understate
          performance.
        </p>
        <p>
          Figures cover the whole ledger. Per-programme and per-semester breakdowns need an
          aggregate endpoint that does not exist yet.
        </p>
      </div>
    </>
  );
}

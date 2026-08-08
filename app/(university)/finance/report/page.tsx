import type { Metadata } from "next";
import { PieChart, ReceiptText, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { resolveUiState, type UiState } from "@/lib/ui-state";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getFinanceSummary } from "@/services/finance";
import { formatCurrency, formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Finance Report" };

/**
 * Collection summary for the tenant.
 *
 * REBUILT AGAINST THE ENDPOINT'S REAL RESPONSE.
 *   This page previously read six figures — collected, outstanding, an overdue
 *   count and a per-status breakdown — that GET /api/finance/report has never
 *   returned. It sends three totals. Every one of those reads was therefore
 *   undefined, and `summary.byStatus.map(...)` threw, so the page rendered its
 *   error boundary while the request itself succeeded with a 200. Verified
 *   against the running endpoint, which answers:
 *
 *     { totalDemands, totalDemandAmount, totalWaivedAmount }
 *
 *   The figures it does not produce are not shown at all, rather than shown as
 *   zero. "₹0 collected" is a statement about the institution's finances and a
 *   false one; absence of a number is not.
 */
export default async function FinanceReportPage() {
  const result = await getFinanceSummary();

  const header = (
    <PageHeader
      title="Finance Report"
      subtitle="Billing across the tenant's fee ledger."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveUiState(result) as Exclude<UiState, "success" | "loading">}
          subject="the finance report"
          message={result.error}
        />
      </>
    );
  }

  const summary = result.data;

  // Money crosses the wire as a decimal string to survive the Decimal columns
  // intact; it is parsed here, at the point of display, and nowhere else.
  const demanded = Number(summary.totalDemandAmount);
  const waived = Number(summary.totalWaivedAmount);

  // Net billed is the only derived figure the response supports. Collection
  // rate is deliberately absent: it needs a collected total, and inferring one
  // would be inventing the number this page exists to report.
  const netBilled = demanded - waived;

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Demands Raised"
          value={formatNumber(summary.totalDemands)}
          icon={<ReceiptText className="size-5" />}
        />
        <StatCard
          label="Total Billed"
          value={formatCurrency(demanded)}
          icon={<Wallet className="size-5" />}
        />
        <StatCard
          label="Waived"
          value={formatCurrency(waived)}
          icon={<PieChart className="size-5" />}
          caption={
            demanded === 0
              ? undefined
              : `${((waived / demanded) * 100).toFixed(1)}% of billed`
          }
        />
        <StatCard label="Net Billed" value={formatCurrency(netBilled)} />
      </div>

      <Card
        className="mt-6"
        noPadding
        header={
          <div>
            <h2 className="text-sm font-semibold text-heading">Collection breakdown</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              By demand status
            </p>
          </div>
        }
      >
        <UnavailableState
          title="Collection figures are not available yet"
          description="GET /api/finance/report returns the number of demands raised, the total billed and the total waived. Collected, outstanding and the per-status breakdown need those aggregates added to the endpoint — they cannot be derived from what it sends today."
        />
      </Card>
    </>
  );
}

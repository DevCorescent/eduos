// ============================================================================
// MODULE : Components — Feedback Summary
// PURPOSE: Render one lecturer's feedback summary, including the case where the
//          scores are deliberately withheld.
//
// WHY `analytics: null` IS NOT AN EMPTY STATE
//   The API returns null analytics in two quite different situations, and the
//   `disclosure` verdict is what tells them apart:
//
//     BELOW_THRESHOLD — students DID answer, but too few to aggregate without
//                       identifying them. Rendering "no feedback yet" here is
//                       false, and it is unfair to the students who responded.
//     NOT_OWN_RECORD  — this viewer may not see these scores at all.
//
//   Only a genuine zero submission count is "nothing yet". This component keeps
//   the three apart so no page has to remember the distinction.
// ============================================================================

import { Lock, MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import type { FacultySummary } from "@/lib/domain/feedback/report";
import type { CategoryScore } from "@/lib/domain/feedback/analytics";
import { formatNumber } from "@/utils/format";

/** A rating out of five, or an em dash when there is none. */
function rating(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} / 5`;
}

/** Turn a category enum into something readable without a lookup table. */
function categoryLabel(category: string): string {
  return category
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function FeedbackSummary({ summary }: { summary: FacultySummary }) {
  const { analytics, disclosure, submissionCount } = summary;

  if (analytics === null) {
    return (
      <Card>
        {submissionCount === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No feedback yet"
            description="No student has submitted feedback for this teaching."
          />
        ) : (
          <EmptyState
            icon={<Lock />}
            title={
              disclosure.reason === "NOT_OWN_RECORD"
                ? "Not available to you"
                : "Withheld to protect anonymity"
            }
            description={
              disclosure.reason === "NOT_OWN_RECORD"
                ? "You may only see the summary for your own teaching."
                : // The shortfall is stated so the reader knows this is a
                  // threshold, not an absence — and roughly when it will lift.
                  `${formatNumber(submissionCount)} response${
                    submissionCount === 1 ? "" : "s"
                  } received. At least ${formatNumber(
                    disclosure.threshold
                  )} are needed before scores can be shown${
                    disclosure.shortfall !== null
                      ? ` — ${formatNumber(disclosure.shortfall)} more to go`
                      : ""
                  }.`
            }
          />
        )}
      </Card>
    );
  }

  const columns: TableColumn<CategoryScore>[] = [
    {
      key: "category",
      header: "Category",
      render: (score) => (
        <span className="text-sm text-foreground">{categoryLabel(score.category)}</span>
      ),
    },
    {
      key: "average",
      header: "Average",
      align: "right",
      render: (score) => (
        <span className="font-medium text-foreground">{rating(score.average)}</span>
      ),
    },
    {
      key: "questionCount",
      header: "Questions",
      align: "right",
      render: (score) => formatNumber(score.questionCount),
    },
    {
      key: "responses",
      header: "Responses",
      align: "right",
      render: (score) => formatNumber(score.responses),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Overall" value={rating(analytics.overallAverage)} />
        <StatCard label="Median" value={rating(analytics.median)} />
        <StatCard
          label="Responses"
          value={formatNumber(submissionCount)}
          caption={
            summary.responseRate !== null
              ? `${summary.responseRate.toFixed(1)}% of the cohort`
              : undefined
          }
        />
        <StatCard
          label="Range"
          value={
            analytics.lowest === null || analytics.highest === null
              ? "—"
              : `${analytics.lowest}–${analytics.highest}`
          }
          caption="Lowest to highest rating given"
        />
      </div>

      <Card
        header={<h2 className="text-sm font-semibold text-heading">By category</h2>}
        noPadding
        className="mt-6"
      >
        <Table
          columns={columns}
          data={[...analytics.categories]}
          rowKey={(score) => score.category}
          emptyState={
            <EmptyState
              icon={<MessageSquare />}
              title="No category scores"
              description="Responses were received but none could be scored by category."
            />
          }
        />
      </Card>
    </>
  );
}

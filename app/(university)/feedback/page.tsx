import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveUiState, type UiState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getFeedbackReport } from "@/services/feedback";
import { listDepartments } from "@/services/setup";
import type { FacultyLine } from "@/lib/domain/feedback/report";
import { formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Faculty Feedback" };

type SearchParams = Promise<{ departmentId?: string; category?: string }>;

/** A rating out of five, or an em dash when there is none. */
function rating(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} / 5`;
}

function categoryLabel(category: string): string {
  return category
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The institution-wide teaching feedback report.
 *
 * `overallAverage` is the mean of the FACULTY averages, each lecturer counting
 * once — not the mean of all submissions. That is the backend's definition and
 * this page does not recompute it: a lecturer with two hundred responses must
 * not outweigh one with twenty in a figure that describes a department.
 *
 * Faculty are identified by id alone. GET /api/feedback/report returns no name,
 * and the only route that maps a facultyId to a person is requireRole
 * ("UNIVERSITY_ADMIN") — which the head of department reading this report may
 * not hold. Rather than fail the whole page for them, each row links to the
 * per-lecturer summary where the name is not needed to read the scores.
 */
export default async function FeedbackReportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { departmentId, category } = await searchParams;

  const [reportResult, departmentsResult] = await Promise.all([
    getFeedbackReport({
      departmentId,
      category: category as never,
    }),
    listDepartments({ page: 1, limit: 100 }),
  ]);

  const header = (
    <PageHeader
      title="Faculty Feedback"
      subtitle="Aggregated teaching feedback across the institution."
    />
  );

  if (!reportResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveUiState(reportResult) as Exclude<UiState, "success" | "loading">}
          subject="feedback"
          message={reportResult.error}
        />
      </>
    );
  }

  const report = reportResult.data;

  const columns: TableColumn<FacultyLine>[] = [
    {
      key: "facultyId",
      header: "Faculty",
      render: (line) => (
        <a
          href={`/feedback/${line.facultyId}`}
          className="font-mono text-xs text-foreground hover:underline"
        >
          {line.facultyId}
        </a>
      ),
    },
    {
      key: "submissionCount",
      header: "Responses",
      align: "right",
      render: (line) => formatNumber(line.submissionCount),
    },
    {
      key: "overallAverage",
      header: "Overall",
      align: "right",
      render: (line) => (
        <span className="font-medium text-foreground">{rating(line.overallAverage)}</span>
      ),
    },
    {
      key: "categories",
      header: "Strongest category",
      render: (line) => {
        // Nulls are excluded before comparing: an unscored category is not a
        // low score, and letting it sort would name it as the best or worst.
        const scored = line.categories.filter(
          (score): score is typeof score & { average: number } => score.average !== null
        );
        if (scored.length === 0) return <span className="text-muted-foreground">—</span>;

        const best = scored.reduce((top, score) =>
          score.average > top.average ? score : top
        );

        return (
          <span className="text-sm text-muted-foreground">
            {categoryLabel(best.category)} · {best.average.toFixed(2)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Overall average" value={rating(report.overallAverage)} />
        <StatCard label="Faculty covered" value={formatNumber(report.facultyCount)} />
        <StatCard label="Responses" value={formatNumber(report.submissionCount)} />
      </div>

      <div className="mt-6">
        <ListToolbar
          filters={
            <>
              <ListFilter
                paramKey="departmentId"
                label="Department"
                hideLabel
                allLabel="All departments"
                options={
                  departmentsResult.success
                    ? departmentsResult.data.items.map((department) => ({
                        value: department.id,
                        label: department.name,
                      }))
                    : []
                }
              />
              <ListFilter
                paramKey="category"
                label="Category"
                hideLabel
                allLabel="All categories"
                options={report.categories.map((score) => ({
                  value: score.category,
                  label: categoryLabel(score.category),
                }))}
              />
            </>
          }
        />
      </div>

      {report.categories.length > 0 && (
        <Card
          header={<h2 className="text-sm font-semibold text-heading">By category</h2>}
          className="mb-6"
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            {report.categories.map((score) => (
              <div key={score.category}>
                <dt className="truncate text-xs text-muted-foreground">
                  {categoryLabel(score.category)}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">
                  {rating(score.average)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <Card
        header={<h2 className="text-sm font-semibold text-heading">By faculty member</h2>}
        noPadding
      >
        <Table
          columns={columns}
          data={[...report.faculty]}
          rowKey={(line) => line.facultyId}
          emptyState={
            <EmptyState
              icon={<MessageSquare />}
              title="No feedback in scope"
              description={
                departmentId || category
                  ? "No feedback matches these filters."
                  : "No teaching feedback has been submitted yet."
              }
            />
          }
        />
      </Card>
    </>
  );
}

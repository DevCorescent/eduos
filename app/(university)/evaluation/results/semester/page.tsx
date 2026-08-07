import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getSemesterResult } from "@/services/evaluation";
import { currentSemester, semesterIndex } from "@/services/reference";
import type { CohortStudentDTO } from "@/lib/dto/result.dto";
import { formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Semester Results" };

type SearchParams = Promise<{ semesterId?: string }>;

/**
 * A whole cohort's result for one semester.
 *
 * Averages divide by `evaluated`, not by `total` — a student whose result is
 * withheld has no SGPA to average, and counting them would drag every figure
 * down by an amount that means nothing. The backend already makes that
 * distinction; this page shows both numbers so the difference is visible.
 *
 * `failures` are rendered rather than dropped. A student the engine could not
 * compute is the single most important thing on a results screen, and a cohort
 * report that quietly omits them looks complete when it is not.
 */
export default async function SemesterResultsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { semesterId } = await searchParams;

  const [semesters, current] = await Promise.all([semesterIndex(), currentSemester()]);
  const activeSemesterId = semesterId ?? current?.id;

  const header = (
    <PageHeader
      title="Semester Results"
      subtitle="Cohort performance, statistics and the merit list for one semester."
    />
  );

  const toolbar = (
    <ListToolbar
      filters={
        <ListFilter
          paramKey="semesterId"
          label="Semester"
          hideLabel
          allLabel="Select a semester"
          options={Array.from(semesters.values()).map((semester) => ({
            value: semester.id,
            label: semester.name,
          }))}
        />
      }
    />
  );

  if (!activeSemesterId) {
    return (
      <>
        {header}
        {toolbar}
        <Card>
          <EmptyState
            icon={<FileSpreadsheet />}
            title="Choose a semester"
            description="No semester is flagged current, so pick one above to see its results."
          />
        </Card>
      </>
    );
  }

  const result = await getSemesterResult(activeSemesterId);

  if (!result.success) {
    return (
      <>
        {header}
        {toolbar}
        <ErrorState title="Couldn't load the results" description={result.error} />
      </>
    );
  }

  const cohort = result.data;
  const { statistics } = cohort;

  const columns: TableColumn<CohortStudentDTO>[] = [
    {
      key: "rank",
      header: "Rank",
      align: "right",
      render: (student) =>
        // Null means excluded from ranking, not last. Showing a number here
        // would place a sealed result among the graded ones.
        student.rank ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "enrollmentNo",
      header: "Student",
      render: (student) => (
        <a
          href={`/evaluation/results/student?studentId=${student.studentId}`}
          className="font-medium text-foreground hover:underline"
        >
          {student.enrollmentNo}
        </a>
      ),
    },
    {
      key: "sgpa",
      header: "SGPA",
      align: "right",
      render: (student) => (
        <span className="font-medium text-foreground">{student.sgpa ?? "—"}</span>
      ),
    },
    {
      key: "percentage",
      header: "Percentage",
      align: "right",
      render: (student) => student.percentage ?? "—",
    },
    {
      key: "creditsEarned",
      header: "Credits",
      align: "right",
      render: (student) => student.creditsEarned,
    },
    {
      key: "backlogCount",
      header: "Backlogs",
      align: "right",
      render: (student) =>
        student.backlogCount > 0 ? (
          <span className="font-medium text-danger">{student.backlogCount}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: "isPromoted",
      header: "Promoted",
      render: (student) => (
        <Badge variant={student.isPromoted ? "success" : "warning"} size="sm">
          {student.isPromoted ? "Yes" : "No"}
        </Badge>
      ),
    },
  ];

  return (
    <>
      {header}
      {toolbar}

      {cohort.failures.length > 0 && (
        <Alert variant="warning" className="mb-6">
          <p className="font-medium">
            {formatNumber(cohort.failures.length)} student
            {cohort.failures.length === 1 ? "" : "s"} could not be computed.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {cohort.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Pass rate"
          value={statistics.passPercent === null ? "—" : `${statistics.passPercent}%`}
          caption={`${formatNumber(statistics.passed)} of ${formatNumber(statistics.evaluated)} evaluated`}
        />
        <StatCard
          label="Average SGPA"
          value={statistics.average ?? "—"}
          caption={statistics.median !== null ? `median ${statistics.median}` : undefined}
        />
        <StatCard
          label="Range"
          value={
            statistics.lowest === null || statistics.highest === null
              ? "—"
              : `${statistics.lowest}–${statistics.highest}`
          }
        />
        <StatCard
          label="Pending"
          value={formatNumber(statistics.pending)}
          caption="Withheld or unfinished"
        />
      </div>

      {cohort.gradeDistribution.length > 0 && (
        <Card
          header={<h2 className="text-sm font-semibold text-heading">Grade distribution</h2>}
          className="mt-6"
        >
          <dl className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-8">
            {cohort.gradeDistribution.map((band) => (
              <div key={band.grade}>
                <dt className="text-xs text-muted-foreground">{band.grade}</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">
                  {formatNumber(band.count)}
                  <span className="ml-1 text-xs text-muted-foreground">({band.percent}%)</span>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <Card
        header={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-heading">{cohort.semesterName}</h2>
            <span className="text-xs text-muted-foreground">
              {formatNumber(statistics.total)} students
            </span>
          </div>
        }
        noPadding
        className="mt-6"
      >
        <Table
          columns={columns}
          data={cohort.students}
          rowKey={(student) => student.studentId}
          emptyState={
            <EmptyState
              icon={<FileSpreadsheet />}
              title="No results"
              description="No result has been computed for this semester yet."
            />
          }
        />
      </Card>
    </>
  );
}

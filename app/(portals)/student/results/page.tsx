import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentStudent } from "@/services/portal";
import { getStudentTranscript } from "@/services/students";
import { EXAMINATION_TYPE_LABELS } from "@/constants/labels";
import { formatNumber, formatPercent } from "@/utils/format";
import type { TranscriptRow } from "@/types";

export const metadata: Metadata = { title: "My Results" };

export default async function StudentResultsPage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const result = await getStudentTranscript(student.id);

  const header = (
    <PageHeader
      title="My Results"
      subtitle="Published examination results, by semester."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Results service is currently unavailable" description={result.error} />
      </>
    );
  }

  const rows = result.data;

  // Grouped by semester — a transcript is read term by term, not as one long
  // chronological list.
  const bySemester = new Map<string, TranscriptRow[]>();
  for (const row of rows) {
    const existing = bySemester.get(row.semesterName);
    if (existing) existing.push(row);
    else bySemester.set(row.semesterName, [row]);
  }

  const sat = rows.filter((r) => !r.isAbsent);
  const passed = rows.filter((r) => r.isPassed === true).length;
  const failed = rows.filter((r) => r.isPassed === false && !r.isAbsent).length;

  // Averaged over papers actually sat. Including absences would report a mark
  // for a paper the student never took.
  const averagePercent =
    sat.length === 0
      ? 0
      : (sat.reduce((sum, r) => sum + Number(r.marksObtained) / r.maxMarks, 0) /
          sat.length) *
        100;

  const columns: TableColumn<TranscriptRow>[] = [
    {
      key: "courseCode",
      header: "Course",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.courseName}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.courseCode}
          </p>
        </div>
      ),
    },
    {
      key: "examinationType",
      header: "Examination",
      render: (row) => (
        <span className="text-muted-foreground">
          {EXAMINATION_TYPE_LABELS[row.examinationType]}
        </span>
      ),
    },
    {
      key: "marksObtained",
      header: "Marks",
      align: "right",
      render: (row) =>
        row.isAbsent ? (
          <span className="text-muted-foreground">Absent</span>
        ) : (
          <span>
            {formatNumber(Number(row.marksObtained))}
            <span className="text-muted-foreground"> / {row.maxMarks}</span>
          </span>
        ),
    },
    {
      key: "grade",
      header: "Grade",
      align: "right",
      render: (row) =>
        row.grade ? (
          <Badge variant="neutral" size="sm">
            {row.grade}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "isPassed",
      header: "Result",
      render: (row) =>
        // null is "not yet evaluated", distinct from false meaning failed.
        row.isPassed === null ? (
          <span className="text-muted-foreground">Pending</span>
        ) : (
          <StatusBadge
            label={row.isPassed ? "Pass" : "Fail"}
            variant={row.isPassed ? "success" : "danger"}
          />
        ),
    },
  ];

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<GraduationCap />}
            title="No results published"
            description="Results appear here once your examinations are marked and released. Marks are not visible before the official release date."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Papers" value={formatNumber(rows.length)} />
        <StatCard label="Passed" value={formatNumber(passed)} />
        <StatCard
          label="Failed"
          value={formatNumber(failed)}
          caption={failed > 0 ? "Reappear required" : undefined}
        />
        <StatCard
          label="Average"
          value={formatPercent(averagePercent, 1)}
          caption="Papers sat"
        />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {Array.from(bySemester.entries()).map(([semesterName, semesterRows]) => (
          <Card
            key={semesterName}
            noPadding
            header={
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-heading">{semesterName}</h2>
                <span className="text-xs text-muted-foreground">
                  {semesterRows.length} result{semesterRows.length === 1 ? "" : "s"}
                </span>
              </div>
            }
          >
            <Table columns={columns} data={semesterRows} rowKey={(row) => row.id} />
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Only released results are shown. Contact the examination office about a result you
        believe is missing.
      </p>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentStudent } from "@/services/portal";
import { getStudentExamResults } from "@/services/students";
import { formatDate, formatNumber } from "@/utils/format";
import type { ExamResult } from "@/types";

export const metadata: Metadata = { title: "My Results" };

/**
 * A student's own published examination results.
 *
 * WHAT THIS SCREEN CAN AND CANNOT SHOW, AND WHY
 *   It reads GET /api/students/[id]/results, the one results endpoint a
 *   STUDENT may call for themselves. That route expands no relation, so each
 *   row names its examination by id and carries no course, no semester and no
 *   maximum mark.
 *
 *   So those columns are not here. The previous version rendered them by
 *   calling the UNIVERSITY_ADMIN-only /transcript endpoint — which answered 403
 *   for every student, making the screen permanently unreachable — and filled
 *   the joins with a fixed maxMarks of 100 and a type of INTERNAL. Both were
 *   wrong rather than merely missing: one drove the percentage figure, the
 *   other mislabelled every external paper.
 *
 *   Grade, grade point, pass and absence are all genuinely in the payload, and
 *   they are what a student checks a results page for. Course-level detail is a
 *   link away, on the transcript, which a student may read in full.
 */
export default async function StudentResultsPage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const result = await getStudentExamResults(student.id);

  const header = (
    <PageHeader title="My Results" subtitle="Your published examination results." />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="results"
          message={result.error}
        />
      </>
    );
  }

  const rows = result.data;

  const sat = rows.filter((row) => !row.isAbsent);
  const passed = rows.filter((row) => row.isPassed === true).length;
  const failed = rows.filter((row) => row.isPassed === false && !row.isAbsent).length;
  const pending = rows.filter((row) => row.isPassed === null).length;

  const columns: TableColumn<ExamResult>[] = [
    {
      key: "publishedAt",
      header: "Released",
      render: (row) =>
        // The route returns published results only, so this is never null in
        // practice — but the column reads the field rather than assuming it.
        row.publishedAt ? (
          formatDate(row.publishedAt)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "marksObtained",
      header: "Marks",
      align: "right",
      render: (row) =>
        row.isAbsent ? (
          <span className="text-muted-foreground">Absent</span>
        ) : row.marksObtained === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          // No denominator: this payload does not carry the paper's maximum,
          // and a made-up "/ 100" would misstate every result out of 50 or 75.
          <span className="font-medium text-foreground">
            {formatNumber(Number(row.marksObtained))}
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
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "gradePoint",
      header: "Grade point",
      align: "right",
      render: (row) => row.gradePoint ?? <span className="text-muted-foreground">—</span>,
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
    {
      key: "remarks",
      header: "Remarks",
      render: (row) =>
        row.remarks ? (
          <span className="text-sm text-muted-foreground">{row.remarks}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
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
            action={
              <Link
                href="/student/transcript"
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                View transcript
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Papers"
          value={formatNumber(rows.length)}
          caption={`${formatNumber(sat.length)} sat`}
        />
        <StatCard label="Passed" value={formatNumber(passed)} />
        <StatCard
          label="Failed"
          value={formatNumber(failed)}
          caption={failed > 0 ? "Reappear required" : undefined}
        />
        <StatCard
          label="Pending"
          value={formatNumber(pending)}
          caption="Not yet evaluated"
        />
      </div>

      <Card noPadding className="mt-6">
        <Table columns={columns} data={rows} rowKey={(row) => row.id} />
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Only released results are shown. Course and semester detail is on your{" "}
        <Link href="/student/transcript" className="underline">
          transcript
        </Link>
        . Contact the examination office about a result you believe is missing.
      </p>
    </>
  );
}

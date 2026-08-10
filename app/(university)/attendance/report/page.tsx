import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getAttendanceReport } from "@/services/academics";
import { allSections } from "@/services/reference";
import { listStudents } from "@/services/students";
import { formatNumber, formatPercent } from "@/utils/format";
import { cn } from "@/lib/utils";
import type { AttendanceSummary } from "@/types";

export const metadata: Metadata = { title: "Attendance Report" };

type SearchParams = Promise<{ sectionId?: string; studentId?: string }>;

/**
 * The eligibility threshold.
 *
 * 75% is the near-universal Indian university minimum for sitting an
 * examination, which is why the report colours against it rather than against
 * an arbitrary scale.
 */
const REQUIRED_PERCENT = 75;
const WARNING_PERCENT = 85;

function toneFor(percentage: number): string {
  if (percentage < REQUIRED_PERCENT) return "text-danger";
  if (percentage < WARNING_PERCENT) return "text-warning";
  return "text-success";
}

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { sectionId: requestedSection, studentId } = await searchParams;

  // Scoped to one section rather than the whole register: a picker over every
  // student in the university is unusable, and the report is read section by
  // section in practice.
  const sections = await allSections();
  const sectionId = requestedSection ?? sections[0]?.id;
  const studentsResult = sectionId
    ? await listStudents({ page: 1, limit: 100, sectionId })
    : null;
  const students = studentsResult?.success ? studentsResult.data.items : [];

  const selectedId = studentId ?? students[0]?.id;
  const reportResult = selectedId ? await getAttendanceReport(selectedId) : null;
  const selectedStudent = students.find((s) => s.id === selectedId);

  const header = (
    <PageHeader
      title="Attendance Report"
      subtitle={`Per-course attendance against the ${REQUIRED_PERCENT}% examination threshold.`}
    />
  );

  const toolbar = (
    <ListToolbar
      filters={
        <>
        <ListFilter
          paramKey="sectionId"
          label="Section"
          hideLabel
          allLabel="Select a section"
          options={sections.map((section) => ({
            value: section.id,
            label: `${section.batchName} — ${section.name}`,
          }))}
        />
        <ListFilter
          paramKey="studentId"
          label="Student"
          hideLabel
          allLabel="Select a student"
          options={students.map((s) => ({
            value: s.id,
            label: `${s.fullName} — ${s.enrollmentNo}`,
          }))}
        />
        </>
      }
    />
  );

  if (reportResult && !reportResult.success) {
    return (
      <>
        {header}
        {toolbar}
        <StateView
          state={resolveFailureState(reportResult)}
          subject="the report"
          message={reportResult.error}
        />
      </>
    );
  }

  const summaries = reportResult?.success ? reportResult.data : [];

  // Overall is computed from raw class counts, not by averaging the per-course
  // percentages — a course with 30 sessions and one with 3 must not carry equal
  // weight in the aggregate.
  const totalClasses = summaries.reduce((sum, s) => sum + s.totalClasses, 0);
  const totalAttended = summaries.reduce(
    (sum, s) => sum + Math.round((s.percentage / 100) * s.totalClasses),
    0
  );
  const overall = totalClasses === 0 ? 0 : (totalAttended / totalClasses) * 100;
  const shortfall = summaries.filter((s) => s.percentage < REQUIRED_PERCENT);

  const columns: TableColumn<AttendanceSummary>[] = [
    {
      key: "courseCode",
      header: "Course",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.courseName}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.courseCode}</p>
        </div>
      ),
    },
    { key: "totalClasses", header: "Classes", align: "right", render: (r) => r.totalClasses },
    { key: "present", header: "Present", align: "right", render: (r) => r.present },
    { key: "late", header: "Late", align: "right", render: (r) => r.late },
    { key: "absent", header: "Absent", align: "right", render: (r) => r.absent },
    {
      key: "percentage",
      header: "Attendance",
      align: "right",
      render: (row) => (
        <span className={cn("font-semibold", toneFor(row.percentage))}>
          {formatPercent(row.percentage, 1)}
        </span>
      ),
    },
    {
      key: "eligible",
      header: "Eligibility",
      render: (row) =>
        row.percentage < REQUIRED_PERCENT ? (
          <span className="text-sm font-medium text-danger">Short</span>
        ) : (
          <span className="text-sm text-muted-foreground">Eligible</span>
        ),
    },
  ];

  return (
    <>
      {header}
      {toolbar}

      {selectedStudent && (
        <p className="mb-4 text-sm text-muted-foreground">
          Showing{" "}
          <Link
            href={`/students/${selectedStudent.id}`}
            className="font-medium text-primary hover:underline"
          >
            {selectedStudent.fullName}
          </Link>{" "}
          <span className="font-mono text-xs">({selectedStudent.enrollmentNo})</span>
        </p>
      )}

      {summaries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="No attendance recorded"
            description="No register has been marked for this student yet."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Overall Attendance"
              value={formatPercent(overall, 1)}
              caption={`${formatNumber(totalClasses)} classes recorded`}
            />
            <StatCard label="Courses" value={formatNumber(summaries.length)} />
            <StatCard
              label="Below Threshold"
              value={formatNumber(shortfall.length)}
              caption={`Under ${REQUIRED_PERCENT}%`}
            />
          </div>

          {shortfall.length > 0 && (
            <Alert
              variant="error"
              title={`Short of the ${REQUIRED_PERCENT}% requirement in ${shortfall.length} course${shortfall.length === 1 ? "" : "s"}`}
              className="mt-6"
            >
              {shortfall.map((s) => s.courseCode).join(", ")} — the student may be barred
              from sitting these examinations.
            </Alert>
          )}

          <Card noPadding className="mt-6">
            <Table columns={columns} data={summaries} rowKey={(row) => row.courseId} />
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Late and excused sessions count as attended. Only unexcused absences reduce the
            percentage.
          </p>
        </>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentStudent } from "@/services/portal";
import { getAttendanceReport } from "@/services/academics";
import { formatNumber, formatPercent } from "@/utils/format";
import { cn } from "@/lib/utils";
import type { AttendanceSummary } from "@/types";

export const metadata: Metadata = { title: "My Attendance" };

const REQUIRED_PERCENT = 75;
const WARNING_PERCENT = 85;

function toneFor(percentage: number): string {
  if (percentage < REQUIRED_PERCENT) return "text-danger";
  if (percentage < WARNING_PERCENT) return "text-warning";
  return "text-success";
}

export default async function StudentAttendancePage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const result = await getAttendanceReport(student.id);

  const header = (
    <PageHeader
      title="My Attendance"
      subtitle={`You must hold ${REQUIRED_PERCENT}% in a course to sit its examination.`}
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Attendance service is currently unavailable" description={result.error} />
      </>
    );
  }

  const summaries = result.data;

  const totalClasses = summaries.reduce((sum, s) => sum + s.totalClasses, 0);
  const attended = summaries.reduce(
    (sum, s) => sum + Math.round((s.percentage / 100) * s.totalClasses),
    0
  );
  const overall = totalClasses === 0 ? 0 : (attended / totalClasses) * 100;
  const short = summaries.filter((s) => s.percentage < REQUIRED_PERCENT);

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
    { key: "totalClasses", header: "Held", align: "right", render: (r) => r.totalClasses },
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
          <span className="text-sm font-medium text-danger">At risk</span>
        ) : (
          <span className="text-sm text-muted-foreground">Eligible</span>
        ),
    },
  ];

  return (
    <>
      {header}

      {summaries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="No attendance recorded"
            description="Attendance appears here once your lecturers begin taking the register."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Overall"
              value={formatPercent(overall, 1)}
              caption={`${formatNumber(totalClasses)} classes held`}
            />
            <StatCard label="Courses" value={formatNumber(summaries.length)} />
            <StatCard
              label="At Risk"
              value={formatNumber(short.length)}
              caption={`Below ${REQUIRED_PERCENT}%`}
            />
          </div>

          {short.length > 0 && (
            <Alert
              variant="error"
              title="You are below the requirement"
              className="mt-6"
            >
              {short.map((s) => `${s.courseCode} (${formatPercent(s.percentage, 1)})`).join(", ")}.
              Speak to your course coordinator — you may be barred from sitting these papers.
            </Alert>
          )}

          <Card noPadding className="mt-6">
            <Table columns={columns} data={summaries} rowKey={(row) => row.courseId} />
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Late arrivals and authorised absences count as attended. Only unexcused absences
            reduce your percentage.
          </p>
        </>
      )}
    </>
  );
}

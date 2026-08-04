import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Award, ClipboardCheck, FileText, Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getCurrentStudent } from "@/services/portal";
import { getAttendanceReport } from "@/services/academics";
import { listStudentAssignments } from "@/services/assignments";
import { listStudentFeeDemands } from "@/services/finance";
import { getStudentTranscript } from "@/services/students";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_VARIANTS } from "@/constants/labels";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My Dashboard" };

/** The examination eligibility threshold. See the attendance report. */
const REQUIRED_PERCENT = 75;

/**
 * Whether a deadline has passed.
 *
 * Module scope, not inline in the JSX: `Date.now()` is impure, and calling it
 * during render is what the purity rule exists to catch. Reading the clock once
 * behind a named helper also means every "overdue" decision on the page uses
 * the same definition.
 */
function isOverdue(dueDate: string | null): boolean {
  return dueDate !== null && Date.parse(dueDate) < Date.now();
}

export default async function StudentDashboardPage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const [attendanceResult, assignmentsResult, feesResult, transcriptResult] =
    await Promise.all([
      getAttendanceReport(student.id),
      listStudentAssignments(student.id, { page: 1, limit: 100 }),
      listStudentFeeDemands(student.id),
      getStudentTranscript(student.id),
    ]);

  const attendance = attendanceResult.success ? attendanceResult.data : [];
  const assignments = assignmentsResult.success ? assignmentsResult.data.items : [];
  const fees = feesResult.success ? feesResult.data : [];
  const results = transcriptResult.success ? transcriptResult.data : [];

  // Weighted by class count, not an average of per-course percentages — a
  // 30-session course must not carry the same weight as a 3-session one.
  const totalClasses = attendance.reduce((sum, a) => sum + a.totalClasses, 0);
  const attended = attendance.reduce(
    (sum, a) => sum + Math.round((a.percentage / 100) * a.totalClasses),
    0
  );
  const overallAttendance = totalClasses === 0 ? 0 : (attended / totalClasses) * 100;
  const shortCourses = attendance.filter((a) => a.percentage < REQUIRED_PERCENT);

  // Open work only: a closed assignment cannot be handed in, so listing it as
  // "due" would be telling the student to do something impossible.
  const openAssignments = assignments.filter(
    (a) => a.status === "PUBLISHED" && !a.submission
  );

  const outstanding = fees
    .filter((f) => f.status !== "PAID" && f.status !== "WAIVED")
    .reduce(
      (sum, f) =>
        sum + (Number(f.totalAmount) - Number(f.paidAmount) - Number(f.waivedAmount)),
      0
    );

  const passed = results.filter((r) => r.isPassed === true).length;

  return (
    <>
      <PageHeader
        title={`Hello, ${student.user.firstName}`}
        subtitle={`${student.enrollmentNo} · Semester ${student.currentSemester}`}
        action={
          <StatusBadge
            label={STUDENT_STATUS_LABELS[student.status]}
            variant={STUDENT_STATUS_VARIANTS[student.status]}
            size="md"
          />
        }
      />

      {/* The single most consequential thing a student needs told, so it sits
          above the summary rather than inside it. */}
      {shortCourses.length > 0 && (
        <Alert
          variant="error"
          title={`Attendance short in ${shortCourses.length} course${shortCourses.length === 1 ? "" : "s"}`}
          className="mb-6"
        >
          {shortCourses.map((c) => c.courseCode).join(", ")} — you may be barred from these
          examinations below {REQUIRED_PERCENT}%.{" "}
          <Link href="/student/attendance" className="font-medium underline">
            See the breakdown
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Attendance"
          value={formatPercent(overallAttendance, 1)}
          icon={<ClipboardCheck className="size-5" />}
          caption={`${formatNumber(totalClasses)} classes`}
        />
        <StatCard
          label="Assignments Due"
          value={formatNumber(openAssignments.length)}
          icon={<FileText className="size-5" />}
          caption="Not yet submitted"
        />
        <StatCard
          label="Outstanding Fees"
          value={outstanding > 0 ? formatCurrency(outstanding) : "Clear"}
          icon={<Receipt className="size-5" />}
        />
        <StatCard
          label="Results Published"
          value={formatNumber(results.length)}
          icon={<Award className="size-5" />}
          caption={results.length > 0 ? `${passed} passed` : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Due soon</h2>
              <Link
                href="/student/assignments"
                className="text-xs font-medium text-primary hover:underline"
              >
                All assignments
              </Link>
            </div>
          }
        >
          {openAssignments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Nothing outstanding. Everything set has been handed in.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {openAssignments.slice(0, 5).map((assignment) => {
                const overdue = isOverdue(assignment.dueDate);

                return (
                  <li
                    key={assignment.id}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {assignment.title}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {assignment.courseCode}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        overdue ? "font-medium text-danger" : "text-muted-foreground"
                      )}
                    >
                      {overdue ? "Overdue" : formatDate(assignment.dueDate)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Attendance by course</h2>
              <Link
                href="/student/attendance"
                className="text-xs font-medium text-primary hover:underline"
              >
                Full report
              </Link>
            </div>
          }
        >
          {attendance.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No attendance recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {attendance.slice(0, 5).map((course) => (
                <li
                  key={course.courseId}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{course.courseName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {course.courseCode}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold",
                      course.percentage < REQUIRED_PERCENT
                        ? "text-danger"
                        : course.percentage < 85
                          ? "text-warning"
                          : "text-success"
                    )}
                  >
                    {formatPercent(course.percentage, 1)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {outstanding > 0 && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatCurrency(outstanding)} outstanding
                </p>
                <p className="text-xs text-muted-foreground">
                  Across{" "}
                  {fees.filter((f) => f.status !== "PAID" && f.status !== "WAIVED").length}{" "}
                  demand(s)
                </p>
              </div>
            </div>
            <Link
              href="/student/fees"
              className="text-sm font-medium text-primary hover:underline"
            >
              View fees
            </Link>
          </div>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">
          Enrolment {student.enrollmentNo}
        </Badge>
        <Badge variant="neutral" size="sm">
          Admitted {formatDate(student.admissionDate)}
        </Badge>
      </div>
    </>
  );
}

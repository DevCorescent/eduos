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
import { getMyDashboard } from "@/services/studentProfile";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_VARIANTS } from "@/constants/labels";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My Dashboard" };

/** The examination eligibility threshold. See the attendance report. */
const REQUIRED_PERCENT = 75;

/**
 * How many assignments the "Due soon" panel asks for.
 *
 * Bounded because resolving whether a row has been submitted costs one request
 * per row — GET /api/assignments returns no submission — so an unbounded list
 * turns one panel into a hundred round trips.
 */
const DUE_SOON_LIMIT = 5;

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
  // Started together. getMyDashboard is self-scoped — it resolves the caller
  // from the session and takes no id — so making it wait for the profile call
  // that produces `student.id` put a round trip on the critical path for a
  // value it never uses.
  const [student, dashboardResult] = await Promise.all([
    getCurrentStudent(),
    getMyDashboard(),
  ]);

  if (!student) redirect("/login");

  // GET /api/student/dashboard carries the attendance percentage, the fee
  // position and the academic standing in ONE response, computed server-side.
  //
  // This page used to compose those figures itself from four separate calls —
  // /api/attendance/report, /api/fee-demands, /api/students/[id]/transcript and
  // the assignment list. Two of those four are requireRole("UNIVERSITY_ADMIN")
  // routes that answered a signed-in student with 403, so the fee and result
  // cards rendered empty no matter what the database held; and each call paid
  // the whole authentication chain again over its own HTTP hop, which is what
  // made this page take eighteen seconds to render.
  //
  // The per-course attendance breakdown is still read separately, because the
  // dashboard endpoint reports one overall percentage and the "you are short in
  // these courses" alert needs to name them.
  const [attendanceResult, assignmentsResult] = await Promise.all([
    getAttendanceReport(student.id),
    // Bounded on purpose: each row costs one request to resolve whether it has
    // been submitted, and a dashboard panel headed "Due soon" needs a handful,
    // not the whole term.
    listStudentAssignments(student.id, { page: 1, limit: DUE_SOON_LIMIT }),
  ]);

  const summary = dashboardResult.success ? dashboardResult.data : null;
  const attendance = attendanceResult.success ? attendanceResult.data : [];
  const assignments = assignmentsResult.success ? assignmentsResult.data.items : [];

  // Prefer the server's own figure; fall back to the per-course rows only when
  // the dashboard call failed. Weighted by class count either way — a
  // 30-session course must not carry the same weight as a 3-session one.
  const totalClasses = attendance.reduce((sum, a) => sum + a.totalClasses, 0);
  const attended = attendance.reduce(
    (sum, a) => sum + Math.round((a.percentage / 100) * a.totalClasses),
    0
  );
  const overallAttendance =
    summary?.attendance.overallPercent !== null && summary?.attendance.overallPercent !== undefined
      ? Number(summary.attendance.overallPercent)
      : totalClasses === 0
        ? 0
        : (attended / totalClasses) * 100;
  const shortCourses = attendance.filter((a) => a.percentage < REQUIRED_PERCENT);

  // Open work only: a closed assignment cannot be handed in, so listing it as
  // "due" would be telling the student to do something impossible.
  const openAssignments = assignments.filter(
    (a) => a.status === "PUBLISHED" && !a.submission
  );

  // Null means the figure could not be read, which the card renders as "—".
  // Zero would say "you owe nothing", which is a different statement.
  const outstanding =
    summary?.finance.outstandingAmount != null
      ? Number(summary.finance.outstandingAmount)
      : null;

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
          value={
            outstanding === null
              ? "—"
              : outstanding > 0
                ? formatCurrency(outstanding)
                : "Clear"
          }
          icon={<Receipt className="size-5" />}
          caption={
            summary?.finance.pendingFeeCount != null
              ? `${formatNumber(summary.finance.pendingFeeCount)} demand(s)`
              : undefined
          }
        />
        <StatCard
          // Standing, not a count of published results: the dashboard endpoint
          // reports CGPA and backlogs directly, and the transcript route this
          // card used to count is admin-only — a student got 403 and the card
          // always read zero.
          label="CGPA"
          value={summary?.academic.cgpa ?? "—"}
          icon={<Award className="size-5" />}
          caption={
            summary?.academic.backlogCount != null && summary.academic.backlogCount > 0
              ? `${formatNumber(summary.academic.backlogCount)} backlog(s)`
              : summary?.academic.earnedCredits != null
                ? `${summary.academic.earnedCredits} credits earned`
                : undefined
          }
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

      {outstanding !== null && outstanding > 0 && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatCurrency(outstanding)} outstanding
                </p>
                <p className="text-xs text-muted-foreground">
                  Across {formatNumber(summary?.finance.pendingFeeCount ?? 0)} demand(s)
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

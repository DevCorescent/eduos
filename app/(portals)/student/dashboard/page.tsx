import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Award,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Receipt,
  Trophy,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import {
  ActivityRow,
  DetailGrid,
  MeterRow,
  Panel,
  StatTile,
} from "../_components";
import { getCurrentStudent } from "@/services/portal";
import { getAttendanceReport } from "@/services/academics";
import { listStudentAssignments } from "@/services/assignments";
import { getMyDashboard } from "@/services/studentProfile";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_VARIANTS } from "@/constants/labels";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

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

/** How many course rows the attendance panel shows before deferring to the report. */
const ATTENDANCE_ROW_LIMIT = 5;

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
  // The per-course attendance breakdown is still read separately, because the
  // dashboard endpoint reports one overall percentage and the "you are short in
  // these courses" alert needs to name them.
  const [attendanceResult, assignmentsResult] = await Promise.all([
    getAttendanceReport(student.id),
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

  // Null means the figure could not be read, which the tile renders as "—".
  // Zero would say "you owe nothing", which is a different statement.
  const outstanding =
    summary?.finance.outstandingAmount != null
      ? Number(summary.finance.outstandingAmount)
      : null;

  // The ring on the CGPA tile. GPA is a 0–10 scale here, so it is scaled to a
  // percentage for the arc only — the figure printed on the tile stays the GPA.
  const cgpa = summary?.academic.cgpa != null ? Number(summary.academic.cgpa) : null;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${student.user.firstName}`}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Attendance"
          value={formatPercent(overallAttendance, 1)}
          icon={<ClipboardCheck className="size-5" />}
          tone={overallAttendance < REQUIRED_PERCENT ? "danger" : "success"}
          caption={`${formatNumber(totalClasses)} classes recorded`}
          ring={{
            percent: overallAttendance,
            srLabel: `Overall attendance ${formatPercent(overallAttendance, 1)}`,
          }}
        />

        <StatTile
          label="CGPA"
          value={summary?.academic.cgpa ?? "—"}
          icon={<Award className="size-5" />}
          tone="primary"
          caption={
            summary?.academic.backlogCount != null && summary.academic.backlogCount > 0
              ? `${formatNumber(summary.academic.backlogCount)} backlog(s)`
              : summary?.academic.earnedCredits != null
                ? `${summary.academic.earnedCredits} credits earned`
                : "No results published yet"
          }
          // Scaled from the 10-point scale the result engine reports. Omitted
          // entirely when no results exist — an empty ring would read as zero.
          ring={
            cgpa !== null
              ? { percent: (cgpa / 10) * 100, srLabel: `CGPA ${cgpa} out of 10` }
              : undefined
          }
        />

        <StatTile
          label="Assignments due"
          value={formatNumber(openAssignments.length)}
          icon={<FileText className="size-5" />}
          tone={openAssignments.length > 0 ? "warning" : "success"}
          caption={
            openAssignments.length === 0 ? "Everything handed in" : "Not yet submitted"
          }
        />

        <StatTile
          label="Outstanding fees"
          value={
            outstanding === null
              ? "—"
              : outstanding > 0
                ? formatCurrency(outstanding)
                : "Clear"
          }
          icon={<Receipt className="size-5" />}
          tone={outstanding !== null && outstanding > 0 ? "danger" : "success"}
          caption={
            summary?.finance.pendingFeeCount != null
              ? `${formatNumber(summary.finance.pendingFeeCount)} demand(s) pending`
              : undefined
          }
        />
      </div>

      {/* PRD §57 "My Programme" in summary form. The full page is a stub; what
          the dashboard endpoint already answers is shown here rather than
          withheld until that module exists. */}
      <Panel title="Enrolment details" className="mt-6">
        <DetailGrid
          columns={3}
          items={[
            { label: "Enrolment number", value: student.enrollmentNo },
            { label: "Current semester", value: `Semester ${student.currentSemester}` },
            { label: "Section", value: summary?.academic.sectionName },
            {
              label: "Status",
              value: STUDENT_STATUS_LABELS[student.status],
            },
            { label: "Admitted", value: formatDate(student.admissionDate) },
            {
              label: "Credits earned",
              value: summary?.academic.earnedCredits,
            },
          ]}
        />
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Due soon"
          action={{ label: "All assignments", href: "/student/assignments" }}
          noPadding
        >
          {openAssignments.length === 0 ? (
            <EmptyState
              title="Nothing outstanding"
              description="Everything set has been handed in."
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-border">
              {openAssignments.slice(0, DUE_SOON_LIMIT).map((assignment) => {
                const overdue = isOverdue(assignment.dueDate);

                return (
                  <ActivityRow
                    key={assignment.id}
                    icon={<FileText className="size-4" />}
                    title={assignment.title}
                    subtitle={<span className="font-mono">{assignment.courseCode}</span>}
                    meta={
                      <span
                        className={cn(
                          overdue ? "font-medium text-danger" : "text-muted-foreground"
                        )}
                      >
                        {overdue ? "Overdue" : formatDate(assignment.dueDate)}
                      </span>
                    }
                  />
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Attendance by course"
          action={{ label: "Full report", href: "/student/attendance" }}
          noPadding
        >
          {attendance.length === 0 ? (
            <EmptyState
              title="No attendance recorded"
              description="Sessions appear here once your faculty start marking them."
              className="py-8"
            />
          ) : (
            <div className="divide-y divide-border">
              {attendance.slice(0, ATTENDANCE_ROW_LIMIT).map((course) => (
                <MeterRow
                  key={course.courseId}
                  label={course.courseName}
                  sublabel={course.courseCode}
                  percent={course.percentage}
                  display={formatPercent(course.percentage, 1)}
                  dangerBelow={REQUIRED_PERCENT}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Only rendered when there is something to report. Three zeroes in a row
          is not a summary, it is noise on the screen of a first-week student. */}
      {summary && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Card>
            <ActivityRow
              className="px-0 py-0"
              icon={<BadgeCheck className="size-4" />}
              title={formatNumber(summary.summary.activeCertificates)}
              subtitle="Active certificates"
              meta={
                <Link
                  href="/student/certificates"
                  className="font-medium text-primary hover:underline"
                >
                  View
                </Link>
              }
            />
          </Card>

          <Card>
            <ActivityRow
              className="px-0 py-0"
              icon={<Trophy className="size-4" />}
              title={formatNumber(summary.summary.achievementCount)}
              subtitle="Achievements recorded"
              meta={
                <Link
                  href="/student/profile"
                  className="font-medium text-primary hover:underline"
                >
                  Profile
                </Link>
              }
            />
          </Card>

          <Card>
            <ActivityRow
              className="px-0 py-0"
              icon={<FileText className="size-4" />}
              title={formatNumber(summary.summary.pendingDocuments)}
              subtitle="Documents pending"
              meta={
                <Link
                  href="/student/profile"
                  className="font-medium text-primary hover:underline"
                >
                  Upload
                </Link>
              }
            />
          </Card>
        </div>
      )}
    </>
  );
}

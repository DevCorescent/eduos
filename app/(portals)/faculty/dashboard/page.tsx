import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, CalendarDays, ClipboardCheck, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable } from "@/services/academics";
import { listFacultyAssignments } from "@/services/assignments";
import { listFacultyExaminations } from "@/services/examinations";
import { DAY_OF_WEEK_LABELS, EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_VARIANTS, SESSION_TYPE_LABELS } from "@/constants/labels";
import { formatDate, formatNumber } from "@/utils/format";
import type { DayOfWeek } from "@/types";

export const metadata: Metadata = { title: "Faculty Dashboard" };

/**
 * The weekday the dashboard treats as "today".
 *
 * Fixed rather than read from the clock, for the same reason the fixtures are
 * seeded: a page whose content changes with the day of the week cannot be
 * reviewed or screenshotted reproducibly. Against real data this becomes the
 * actual weekday.
 */
const TODAY: DayOfWeek = "WEDNESDAY";

export default async function FacultyDashboardPage() {
  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const [timetableResult, assignmentsResult, examsResult] = await Promise.all([
    getFacultyTimetable(faculty.id),
    // Assignments are keyed by the author's *user* id — the column is
    // createdBy, not facultyId.
    listFacultyAssignments(faculty.userId, { page: 1, limit: 100 }),
    listFacultyExaminations(faculty.id, { page: 1, limit: 100 }),
  ]);

  const slots = timetableResult.success ? timetableResult.data : [];
  const assignments = assignmentsResult.success ? assignmentsResult.data.items : [];
  const exams = examsResult.success ? examsResult.data.items : [];

  const todaySlots = slots
    .filter((slot) => slot.day === TODAY)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Distinct courses, not slot count: teaching one course three times a week is
  // one course, and the stat is read as "how many do I run".
  const distinctCourses = new Set(slots.map((slot) => slot.courseId)).size;

  const toGrade = assignments.filter((a) => a.pendingCount > 0);
  const totalPending = toGrade.reduce((sum, a) => sum + a.pendingCount, 0);

  const upcomingExams = exams.filter((exam) => exam.status === "SCHEDULED");

  return (
    <>
      <PageHeader
        title={`Good day, ${faculty.user.firstName}`}
        subtitle={`${faculty.employeeId}${faculty.designation ? ` · ${faculty.designation}` : ""}`}
        action={
          <StatusBadge
            label={EMPLOYEE_STATUS_LABELS[faculty.status]}
            variant={EMPLOYEE_STATUS_VARIANTS[faculty.status]}
            size="md"
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Classes Today"
          value={formatNumber(todaySlots.length)}
          icon={<CalendarDays className="size-5" />}
          caption={DAY_OF_WEEK_LABELS[TODAY]}
        />
        <StatCard
          label="Courses"
          value={formatNumber(distinctCourses)}
          icon={<BookOpen className="size-5" />}
          caption="This semester"
        />
        <StatCard
          label="To Grade"
          value={formatNumber(totalPending)}
          icon={<FileText className="size-5" />}
          caption={toGrade.length > 0 ? `${toGrade.length} assignment(s)` : "Nothing waiting"}
        />
        <StatCard
          label="Upcoming Exams"
          value={formatNumber(upcomingExams.length)}
          icon={<ClipboardCheck className="size-5" />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">
                Today — {DAY_OF_WEEK_LABELS[TODAY]}
              </h2>
              <Link
                href="/faculty/schedule"
                className="text-xs font-medium text-primary hover:underline"
              >
                Full week
              </Link>
            </div>
          }
        >
          {todaySlots.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No classes scheduled today.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {todaySlots.map((slot) => (
                <li key={slot.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                    {slot.startTime}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {slot.courseName}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {slot.courseCode}
                      {slot.roomNo ? ` · ${slot.roomNo}` : ""}
                    </p>
                  </div>
                  {slot.sessionType !== "LECTURE" && (
                    <Badge variant="neutral" size="sm">
                      {SESSION_TYPE_LABELS[slot.sessionType]}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Waiting to be graded</h2>
              <Link
                href="/faculty/assignments"
                className="text-xs font-medium text-primary hover:underline"
              >
                All assignments
              </Link>
            </div>
          }
        >
          {toGrade.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Nothing waiting. Every submission has been marked.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {toGrade.slice(0, 5).map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    href={`/faculty/assignments/${assignment.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {assignment.title}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {assignment.courseCode}
                      </p>
                    </div>
                    <Badge variant="warning" size="sm">
                      {assignment.pendingCount}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {upcomingExams.length > 0 && (
        <Card
          className="mt-6"
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Upcoming examinations</h2>
              <Link
                href="/faculty/exams"
                className="text-xs font-medium text-primary hover:underline"
              >
                All exams
              </Link>
            </div>
          }
        >
          <ul className="divide-y divide-border">
            {upcomingExams.slice(0, 4).map((exam) => (
              <li key={exam.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{exam.title}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {exam.courseCode} · {exam.maxMarks} marks
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(exam.date)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

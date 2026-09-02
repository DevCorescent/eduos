import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ClipboardCheck, GraduationCap, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable } from "@/services/academics";
import { resolveFailureState } from "@/lib/ui-state";

export const metadata: Metadata = { title: "My Classes" };

const iconClass = "h-4 w-4";

/**
 * The lecturer's own classes.
 *
 * SOURCE OF TRUTH IS THE TEACHING RELATIONSHIP, NOT A COURSE LIST.
 *   The classes shown are derived from GET /api/timetables/faculty/[id], which
 *   requireFacultyTimetableAccess confines to the caller's own id. A lecturer
 *   therefore cannot list a colleague's classes here, and the page never asks
 *   for a facultyId — it resolves the caller from their session.
 *
 *   This deliberately reuses the same source the attendance screen already
 *   uses rather than introducing a second notion of "my classes". Two answers
 *   to that question would drift, and the one that drifted would be the one
 *   deciding what a lecturer may open.
 *
 * THE LINKS ARE A CONVENIENCE, NEVER THE GUARD.
 *   Every destination re-proves the relationship server-side:
 *   /api/sections/[id]/roster for the roster, POST /api/attendance for the
 *   register, POST /api/results/internal for marks.
 */
export default async function FacultyClassesPage() {
  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const timetableResult = await getFacultyTimetable(faculty.id);

  const header = (
    <PageHeader
      title="My Classes"
      subtitle="The courses and sections you teach this term."
    />
  );

  if (!timetableResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(timetableResult)}
          subject="your classes"
          message={timetableResult.error}
        />
      </>
    );
  }

  // Deduplicated by (section, course): a course taught to one section three
  // times a week is ONE class, not three. The same key the attendance picker
  // uses, for the same reason.
  const classes = Array.from(
    new Map(
      timetableResult.data.map((slot) => [
        `${slot.sectionId}|${slot.courseId}`,
        {
          key: `${slot.sectionId}|${slot.courseId}`,
          sectionId: slot.sectionId,
          courseId: slot.courseId,
          courseCode: slot.courseCode,
          courseName: slot.courseName,
          sessionType: slot.sessionType,
          slots: [] as { day: string; startTime: string; endTime: string; roomNo: string | null }[],
        },
      ])
    ).values()
  );

  // Attach every scheduled meeting to its class, so the card shows when it
  // actually meets rather than only that it exists.
  for (const slot of timetableResult.data) {
    const entry = classes.find(
      (item) => item.sectionId === slot.sectionId && item.courseId === slot.courseId
    );
    entry?.slots.push({
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      roomNo: slot.roomNo ?? null,
    });
  }

  if (classes.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="No classes assigned"
          description="Once courses are allocated to you and timetabled, they appear here."
        />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {classes.map((entry) => (
          <Card
            key={entry.key}
            header={
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-heading">
                    {entry.courseName}
                  </h2>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {entry.courseCode}
                  </p>
                </div>
                <Badge variant="neutral">
                  {entry.sessionType.charAt(0) + entry.sessionType.slice(1).toLowerCase()}
                </Badge>
              </div>
            }
          >
            <ul className="mb-4 space-y-1 text-xs text-muted-foreground">
              {entry.slots.map((slot, index) => (
                <li key={`${slot.day}-${slot.startTime}-${index}`}>
                  {slot.day.charAt(0) + slot.day.slice(1).toLowerCase()} ·{" "}
                  {slot.startTime}–{slot.endTime}
                  {slot.roomNo ? ` · ${slot.roomNo}` : ""}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/faculty/students?class=${encodeURIComponent(entry.key)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-heading transition-colors hover:bg-muted"
              >
                <Users className={iconClass} />
                Students
              </Link>
              <Link
                href={`/faculty/attendance/mark?slotId=${encodeURIComponent(entry.key)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-heading transition-colors hover:bg-muted"
              >
                <ClipboardCheck className={iconClass} />
                Attendance
              </Link>
              <Link
                href={`/faculty/evaluation?class=${encodeURIComponent(entry.key)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-heading transition-colors hover:bg-muted"
              >
                <GraduationCap className={iconClass} />
                Marks
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

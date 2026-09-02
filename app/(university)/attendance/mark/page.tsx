import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { getSectionTimetable, getSessionAttendance } from "@/services/academics";
import { MAX_LIST_LIMIT } from "@/types/api";
import { allSections } from "@/services/reference";
import { listStudents } from "@/services/students";
import { getPortalSession } from "@/services/session";
import { hasAnyRole } from "@/constants/roles";
import { ATTENDANCE_CORRECTION_REQUEST_ROLES } from "@/lib/constants/attendanceCorrection";
import { MarkAttendanceForm } from "./MarkAttendanceForm";

export const metadata: Metadata = { title: "Mark Attendance" };

type SearchParams = Promise<{ sectionId?: string; courseId?: string; date?: string }>;

/** Today, as the YYYY-MM-DD the attendance API expects. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function MarkAttendancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { sectionId: requestedSection, courseId, date } = await searchParams;

  // A register belongs to a section, so the section is the first thing chosen.
  // Defaulting to the first one keeps the screen useful on arrival; the picker
  // below is what makes every other section reachable.
  const sections = await allSections();
  const sectionId = requestedSection ?? sections[0]?.id;
  const selectedDate = date ?? today();

  if (!sectionId) {
    return (
      <>
        <PageHeader
          title="Mark Attendance"
          subtitle="Take the register for one class session."
        />
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="No sections yet"
            description="Create a batch and at least one section before taking a register."
          />
        </Card>
      </>
    );
  }

  // Courses come from the section's own timetable, not the whole catalogue: a
  // register can only be taken for a class that is actually scheduled for this
  // section.
  const [timetableResult, studentsResult] = await Promise.all([
    getSectionTimetable(sectionId),
    listStudents({ page: 1, limit: MAX_LIST_LIMIT, sectionId, status: "ACTIVE" }),
  ]);

  const header = (
    <PageHeader
      title="Mark Attendance"
      subtitle="Take the register for one class session."
    />
  );

  if (!timetableResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(timetableResult)}
          subject="the timetable"
          message={timetableResult.error}
        />
      </>
    );
  }

  // Deduplicated: a course taught three times a week appears three times on the
  // timetable but is one choice here.
  const courseOptions = Array.from(
    new Map(
      timetableResult.data.map((slot) => [
        slot.courseId,
        { value: slot.courseId, label: `${slot.courseCode} — ${slot.courseName}` },
      ])
    ).values()
  );

  const selectedCourseId = courseId ?? courseOptions[0]?.value;
  const students = studentsResult.success ? studentsResult.data.items : [];

  const existingResult = selectedCourseId
    ? await getSessionAttendance(sectionId, selectedCourseId, selectedDate)
    : null;

  // Pre-fills the form with whatever was already recorded, so re-opening a
  // marked session shows the register as it stands rather than blank.
  //
  // The row id is kept alongside the status because a correction request is
  // ABOUT that row: without it the requester would have to identify the record
  // by student, course, date and session type, which is four chances to name a
  // different register than the one they are disputing.
  const existingByStudent = new Map(
    (existingResult?.success ? existingResult.data : []).map((row) => [
      row.studentId,
      { id: row.id, status: row.status },
    ])
  );

  // ATTENDANCE_CORRECTION_REQUEST_ROLES. The POST route enforces the same set,
  // so this only decides whether the control is drawn.
  const session = await getPortalSession();
  const canRequestCorrection = hasAnyRole(
    session?.roles ?? [],
    ATTENDANCE_CORRECTION_REQUEST_ROLES
  );

  return (
    <>
      {header}

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
              paramKey="courseId"
              label="Course"
              hideLabel
              allLabel="Select a course"
              options={courseOptions}
            />
            <ListFilter
              paramKey="date"
              label="Date"
              hideLabel
              allLabel={selectedDate}
              // The last fortnight, newest first. A register is corrected within
              // days of the class, so a free date picker offers mostly dates
              // nobody will pick and hides the ones they will.
              options={recentDates()}
            />
          </>
        }
      />

      {students.length === 0 || !selectedCourseId ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="Nothing to mark"
            description={
              !selectedCourseId
                ? "This section has no timetabled courses."
                : "This section has no active students."
            }
          />
        </Card>
      ) : (
        <MarkAttendanceForm
          sectionId={sectionId}
          courseId={selectedCourseId}
          date={selectedDate}
          students={students.map((student) => ({
            id: student.id,
            name: student.fullName,
            enrollmentNo: student.enrollmentNo,
            status: existingByStudent.get(student.id)?.status ?? "PRESENT",
            attendanceId: existingByStudent.get(student.id)?.id,
          }))}
          alreadyMarked={existingByStudent.size > 0}
          canRequestCorrection={canRequestCorrection}
        />
      )}
    </>
  );
}

/**
 * The last fourteen days, newest first.
 *
 * Bounded rather than open-ended for the reason given at the call site: a
 * register is taken on the day or corrected shortly after.
 */
function recentDates(): Array<{ value: string; label: string }> {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return Array.from({ length: 14 }, (_, offset) => {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    return { value: day.toISOString().slice(0, 10), label: formatter.format(day) };
  });
}

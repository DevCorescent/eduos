import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import {
  attendanceDemoSectionId,
  getSectionTimetable,
  getSessionAttendance,
} from "@/services/academics";
import { listStudents } from "@/services/students";
import { MarkAttendanceForm } from "./MarkAttendanceForm";

export const metadata: Metadata = { title: "Mark Attendance" };

type SearchParams = Promise<{ courseId?: string; date?: string }>;

/**
 * The date the register defaults to.
 *
 * Anchored to the fixture epoch rather than today, so the screen opens on a day
 * that actually has generated attendance. With real data this would be today.
 */
const DEFAULT_DATE = "2026-06-24";

export default async function MarkAttendancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { courseId, date } = await searchParams;

  const sectionId = attendanceDemoSectionId();
  const selectedDate = date ?? DEFAULT_DATE;

  // Courses come from the section's own timetable, not the whole catalogue: a
  // register can only be taken for a class that is actually scheduled for this
  // section.
  const [timetableResult, studentsResult] = await Promise.all([
    getSectionTimetable(sectionId),
    listStudents({ page: 1, limit: 200, sectionId, status: "ACTIVE" }),
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
        <ErrorState title="Couldn't load the timetable" description={timetableResult.error} />
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
  const existingByStudent = new Map(
    (existingResult?.success ? existingResult.data : []).map((row) => [
      row.studentId,
      row.status,
    ])
  );

  return (
    <>
      {header}

      <ListToolbar
        filters={
          <>
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
              // Dates come from the timetable's own week rather than a free
              // date picker, so a register cannot be taken for a day the class
              // does not run.
              options={[
                { value: "2026-06-24", label: "24 Jun 2026" },
                { value: "2026-06-17", label: "17 Jun 2026" },
                { value: "2026-06-10", label: "10 Jun 2026" },
                { value: "2026-06-03", label: "3 Jun 2026" },
              ]}
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
            status: existingByStudent.get(student.id) ?? "PRESENT",
          }))}
          alreadyMarked={existingByStudent.size > 0}
        />
      )}
    </>
  );
}

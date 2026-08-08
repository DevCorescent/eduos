import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable, getSessionAttendance } from "@/services/academics";
import { listStudents } from "@/services/students";
import { MarkAttendanceForm } from "@/app/(university)/attendance/mark/MarkAttendanceForm";

export const metadata: Metadata = { title: "Mark Attendance" };

type SearchParams = Promise<{ slotId?: string; date?: string }>;

/** Anchored to the fixture epoch so the page opens on a day that has data. */
const DEFAULT_DATE = "2026-06-24";

export default async function FacultyMarkAttendancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { slotId, date } = await searchParams;

  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const selectedDate = date ?? DEFAULT_DATE;
  const timetableResult = await getFacultyTimetable(faculty.id);

  const header = (
    <PageHeader
      title="Mark Attendance"
      subtitle="Take the register for one of your scheduled classes."
    />
  );

  // Two admin-only routes stand between a lecturer and this screen, both
  // verified against the running server: the timetable that supplies the class
  // list (403) and GET /api/students that supplies the roster to mark (403).
  // Neither is a transient failure, so neither is an ErrorState.
  if (!timetableResult.success && timetableResult.code === "FORBIDDEN") {
    return (
      <>
        {header}
        <Card noPadding>
          <UnavailableState
            title="Marking attendance is not available yet"
            description="Taking a register needs two things a lecturer cannot currently read: the timetable that lists your classes, and the student roster for a section. Both APIs are restricted to administrators today. Attendance you have already marked is still visible in the analytics."
          />
        </Card>
      </>
    );
  }

  if (!timetableResult.success) {
    return (
      <>
        {header}
        <ErrorState title="Schedule service is currently unavailable" description={timetableResult.error} />
      </>
    );
  }

  // The class list comes from this lecturer's own timetable — a lecturer may
  // only take the register for a class they actually teach, so the picker is
  // the guard as well as the convenience.
  //
  // Deduplicated by (section, course): a course taught to one section three
  // times a week is one register to take, not three choices.
  const classes = Array.from(
    new Map(
      timetableResult.data.map((slot) => [
        `${slot.sectionId}|${slot.courseId}`,
        {
          value: `${slot.sectionId}|${slot.courseId}`,
          label: `${slot.courseCode} — ${slot.courseName}`,
          sectionId: slot.sectionId,
          courseId: slot.courseId,
        },
      ])
    ).values()
  );

  const selected = classes.find((entry) => entry.value === slotId) ?? classes[0];

  const [studentsResult, existingResult] = await Promise.all([
    selected
      ? listStudents({ page: 1, limit: 200, sectionId: selected.sectionId, status: "ACTIVE" })
      : Promise.resolve(null),
    selected
      ? getSessionAttendance(selected.sectionId, selected.courseId, selectedDate)
      : Promise.resolve(null),
  ]);

  const students = studentsResult?.success ? studentsResult.data.items : [];

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
              paramKey="slotId"
              label="Class"
              hideLabel
              allLabel="Select a class"
              options={classes.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
            <ListFilter
              paramKey="date"
              label="Date"
              hideLabel
              allLabel={selectedDate}
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

      {!selected || students.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="Nothing to mark"
            description={
              !selected
                ? "You have no timetabled classes yet."
                : "This section has no active students."
            }
          />
        </Card>
      ) : (
        // The same register component the admin screen uses — a register is a
        // register, and two copies would drift on the details that matter
        // (defaults, upsert behaviour, the all-present shortcut).
        <MarkAttendanceForm
          sectionId={selected.sectionId}
          courseId={selected.courseId}
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

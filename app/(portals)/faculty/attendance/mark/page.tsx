import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { getCurrentFaculty } from "@/services/portal";
import { resolveFailureState } from "@/lib/ui-state";
import {
  getFacultyTimetable,
  getSectionRoster,
  getSessionAttendance,
} from "@/services/academics";
import { getPortalSession } from "@/services/session";
import { hasAnyRole } from "@/constants/roles";
import { ATTENDANCE_CORRECTION_REQUEST_ROLES } from "@/lib/constants/attendanceCorrection";
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

  // The class list. Both routes this screen needs now admit a lecturer:
  // /api/timetables/faculty/[facultyId] for their own schedule, and
  // /api/sections/[id]/roster for the register of a class they teach. A
  // failure here is therefore a real failure rather than a missing capability,
  // and resolveFailureState maps it to the state that says so.
  if (!timetableResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(timetableResult)}
          subject="classes"
          message={timetableResult.error}
        />
      </>
    );
  }

  // The class list comes from this lecturer's own timetable, so the picker
  // offers only classes they actually teach.
  //
  // The picker is a CONVENIENCE, never the guard. Enforcement lives in
  // /api/sections/[id]/roster, which proves the caller teaches the exact
  // (section, course) pair against Timetable or FacultyCourseAssignment before
  // returning a single name. A hand-crafted request that names a colleague's
  // class is refused there, which is where it has to be refused — a client can
  // always choose not to run the picker.
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

  const [rosterResult, existingResult] = await Promise.all([
    // The class-scoped register, NOT the institution-wide student list. Both
    // ids travel because the second is what proves the caller may read the
    // first — see the guard on /api/sections/[id]/roster.
    selected
      ? getSectionRoster(selected.sectionId, selected.courseId)
      : Promise.resolve(null),
    selected
      ? getSessionAttendance(selected.sectionId, selected.courseId, selectedDate)
      : Promise.resolve(null),
  ]);

  // The roster's own failures get their own treatment rather than collapsing
  // into an empty register. Reading a 403 as "this section has no active
  // students" is the specific bug this replaces: it stated something false
  // about the class, and it was indistinguishable from a genuinely empty one.
  //
  // Only reached once a class is selected — with none, there is nothing to
  // have failed, and the empty state below says so instead.
  if (rosterResult && !rosterResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(rosterResult)}
          subject="students"
          message={rosterResult.error}
        />
      </>
    );
  }

  const students = rosterResult?.success ? rosterResult.data : [];

  // The row id travels with the status: a correction request names the record
  // it disputes, and the lecturer must never have to identify it by hand.
  const existingByStudent = new Map(
    (existingResult?.success ? existingResult.data : []).map((row) => [
      row.studentId,
      { id: row.id, status: row.status },
    ])
  );

  // Checked against the session rather than assumed from the portal: reaching
  // the faculty portal means holding a FacultyMember record, which is not the
  // same question as holding a role that may raise a correction.
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
            id: student.studentId,
            // A real name, which /api/students could not supply: it selects
            // Student columns only, and Student carries no name.
            name: `${student.firstName} ${student.lastName}`.trim(),
            enrollmentNo: student.enrollmentNo,
            status: existingByStudent.get(student.studentId)?.status ?? "PRESENT",
            attendanceId: existingByStudent.get(student.studentId)?.id,
          }))}
          alreadyMarked={existingByStudent.size > 0}
          canRequestCorrection={canRequestCorrection}
        />
      )}
    </>
  );
}

// ============================================================================
// MODULE : Mock Data — Curriculum, Timetable & Attendance
// PURPOSE: The three operational academic datasets: what each programme
//          teaches, when it is taught, and who turned up.
//
//          None has a backend route yet (backend Phases 8-9), so all three are
//          written against the contract in types/entities.ts.
//
//          Attendance is the one to be careful with: a register of 186 students
//          × 12 weeks × 6 courses is over a hundred thousand rows, which is not
//          a fixture, it is a memory leak. It is generated for one section's
//          worth of students across the current semester instead, which is what
//          any single screen ever reads.
// ============================================================================

import type {
  Attendance,
  Curriculum,
  CurriculumSubject,
  Timetable,
} from "@/types";
import { daysAgo, seededInt, seededPick } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import {
  CURRENT_ACADEMIC_YEAR,
  CURRENT_SEMESTER,
  MOCK_PROGRAMMES,
  MOCK_SECTIONS,
} from "./academics";
import { MOCK_COURSES, MOCK_FACULTY_ASSIGNMENTS } from "./courses";
import { MOCK_STUDENTS } from "./people";

const CREATED = daysAgo(600);

// --- Curricula --------------------------------------------------------------

/**
 * One active curriculum per active programme.
 *
 * Version is the year it took effect — the convention institutions actually
 * use, and what makes @@unique([programmeId, version]) meaningful.
 */
export const MOCK_CURRICULA: Curriculum[] = MOCK_PROGRAMMES.filter(
  (programme) => programme.isActive
).map((programme, i) => ({
  id: mockId("cur", i + 1),
  tenantId: MOCK_TENANT_ID,
  programmeId: programme.id,
  name: `${programme.code} Curriculum 2026`,
  version: "2026",
  effectiveFrom: CURRENT_ACADEMIC_YEAR.startDate,
  isActive: true,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

export const CURRICULUM_BY_PROGRAMME = new Map(
  MOCK_CURRICULA.map((curriculum) => [curriculum.programmeId, curriculum])
);

/**
 * The subjects each curriculum places in each semester.
 *
 * Courses are drawn from the programme's own department, so a B.Tech CSE
 * curriculum is made of CSE courses rather than an arbitrary scatter across the
 * catalogue. Five or six per semester is a normal load.
 */
export const MOCK_CURRICULUM_SUBJECTS: CurriculumSubject[] = MOCK_CURRICULA.flatMap(
  (curriculum, curriculumIndex) => {
    const programme = MOCK_PROGRAMMES.find((p) => p.id === curriculum.programmeId)!;
    const departmentCourses = MOCK_COURSES.filter(
      (course) => course.departmentId === programme.departmentId && course.isActive
    );

    if (departmentCourses.length === 0) return [];

    // Semesters in the programme, capped at 8 — a five-year PhD does not have a
    // taught curriculum for every term.
    const semesterCount = Math.min(programme.durationValue * 2, 8);

    return Array.from({ length: semesterCount }, (_, semesterIndex) => {
      const semesterNumber = semesterIndex + 1;
      const perSemester = Math.min(
        seededInt(4, 6, `${curriculum.id}-${semesterNumber}-count`),
        departmentCourses.length
      );

      return Array.from({ length: perSemester }, (_, slot): CurriculumSubject => {
        // Offset by the slot and semester so one semester does not draw the
        // same course repeatedly — seededPick is stable per seed, not per draw.
        const course =
          departmentCourses[(semesterIndex * 3 + slot) % departmentCourses.length];

        return {
          id: mockId("cus", curriculumIndex * 100 + semesterIndex * 10 + slot + 1, 5),
          curriculumId: curriculum.id,
          courseId: course.id,
          semesterNumber,
          // Electives appear from the fifth semester on, which is when a
          // programme actually opens up.
          isCompulsory: semesterNumber < 5 || course.type !== "ELECTIVE",
          credits: course.credits,
          internalMarks: 40,
          externalMarks: 60,
          createdAt: CREATED,
        };
      });
    }).flat();
  }
);

// --- Timetable --------------------------------------------------------------

/** Teaching slots. Six per day, with a break where lunch would be. */
export const TIME_SLOTS = [
  { start: "09:00", end: "10:00" },
  { start: "10:00", end: "11:00" },
  { start: "11:15", end: "12:15" },
  { start: "12:15", end: "13:15" },
  { start: "14:00", end: "15:00" },
  { start: "15:00", end: "16:00" },
] as const;

/** Saturday and Sunday are excluded — the fixture models a five-day week. */
export const TEACHING_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

/**
 * A weekly timetable for every section in the current semester.
 *
 * Built from the faculty assignments rather than independently, so the lecturer
 * on a slot is genuinely assigned to that course and section. Generating them
 * separately would produce a timetable that contradicts the workload screens.
 */
export const MOCK_TIMETABLE: Timetable[] = (() => {
  const slots: Timetable[] = [];

  // Who is already teaching at a given day and time, across every section.
  //
  // This is the whole reason the generator is a single pass rather than a
  // per-section flatMap: sections built independently have no view of each
  // other, and the same lecturer ends up scheduled in two rooms at once. A
  // timetable that double-books is not a timetable, and it made the faculty
  // schedule show two classes in one cell.
  const busy = new Set<string>();

  for (const [sectionIndex, section] of MOCK_SECTIONS.entries()) {
    const assignments = MOCK_FACULTY_ASSIGNMENTS.filter(
      (assignment) => assignment.sectionId === section.id && assignment.isActive
    );

    if (assignments.length === 0) continue;

    let slotCounter = 0;

    for (const [dayIndex, day] of TEACHING_DAYS.entries()) {
      // Four or five classes a day, not six — a full grid with no free period
      // is neither realistic nor a useful test of the empty-slot rendering.
      const classesToday = seededInt(4, 5, `${section.id}-${day}-count`);

      for (let period = 0; period < classesToday; period++) {
        const time = TIME_SLOTS[period];

        // Walk this section's assignments from a rotating start, and take the
        // first lecturer who is free at this day and time. Rotating means
        // sections do not all compete for the same lecturer in period 0.
        //
        // If every one of them is already teaching, the period is left free
        // rather than forced — a gap is a normal timetable, a double-booking is
        // not.
        const start = dayIndex * 2 + period;
        let assignment: (typeof assignments)[number] | undefined;

        for (let offset = 0; offset < assignments.length; offset++) {
          const candidate = assignments[(start + offset) % assignments.length];
          if (!busy.has(`${candidate.facultyId}|${day}|${time.start}`)) {
            assignment = candidate;
            break;
          }
        }

        if (!assignment) continue;

        busy.add(`${assignment.facultyId}|${day}|${time.start}`);

        const course = MOCK_COURSES.find((c) => c.id === assignment.courseId);

        slots.push({
          id: mockId("tt", sectionIndex * 100 + slotCounter++, 5),
          tenantId: MOCK_TENANT_ID,
          semesterId: CURRENT_SEMESTER.id,
          sectionId: section.id,
          courseId: assignment.courseId,
          facultyId: assignment.facultyId,
          day,
          startTime: time.start,
          endTime: time.end,
          roomNo: `${seededPick(["A", "B", "C"], `${section.id}-${day}-${period}-block`)}-${seededInt(101, 320, `${section.id}-${day}-${period}-room`)}`,
          // A lab course gets a LAB session; everything else is a lecture.
          sessionType: course?.type === "LAB" ? "LAB" : "LECTURE",
          isActive: true,
          createdAt: CREATED,
        });
      }
    }
  }

  return slots;
})();

// --- Attendance -------------------------------------------------------------

/**
 * The section attendance is generated for.
 *
 * One section, not the whole register: 186 students across a semester of
 * classes is six figures of rows. Every attendance screen is scoped to a
 * section anyway, so this is what any of them actually reads.
 */
export const ATTENDANCE_SECTION_ID = MOCK_SECTIONS[0]?.id ?? "";

/** Students in that section. */
export const ATTENDANCE_STUDENTS = MOCK_STUDENTS.filter(
  (student) => student.sectionId === ATTENDANCE_SECTION_ID && student.status === "ACTIVE"
);

/** Distinct courses timetabled for that section. */
const ATTENDANCE_COURSES = Array.from(
  new Set(
    MOCK_TIMETABLE.filter((slot) => slot.sectionId === ATTENDANCE_SECTION_ID).map(
      (slot) => slot.courseId
    )
  )
);

/** Weeks of history generated. Twelve is a full teaching term. */
const WEEKS = 12;

/**
 * Attendance for one section, over the last twelve weeks.
 *
 * Per-student attendance rates are seeded so a given student is consistently
 * strong or weak rather than randomly different each session. That is what
 * makes the shortage report meaningful — a register where everyone lands at
 * 75% has nobody to flag.
 */
export const MOCK_ATTENDANCE: Attendance[] = ATTENDANCE_STUDENTS.flatMap(
  (student, studentIndex) => {
    // Each student's own baseline: mostly 70-95%, with a genuine tail below the
    // 75% threshold so the detention list is not empty.
    const baseline = seededInt(55, 98, `${student.id}-attendance-rate`);

    return ATTENDANCE_COURSES.flatMap((courseId, courseIndex) =>
      Array.from({ length: WEEKS }, (_, week): Attendance | null => {
        const seed = `att-${student.id}-${courseId}-${week}`;
        const date = daysAgo((WEEKS - week) * 7);

        const roll = seededInt(0, 99, `${seed}-roll`);
        // A student above their own baseline is present; the remainder splits
        // into absent, late and excused rather than all being flat absences.
        const status =
          roll < baseline
            ? "PRESENT"
            : roll < baseline + 4
              ? "LATE"
              : roll < baseline + 7
                ? "EXCUSED"
                : "ABSENT";

        return {
          id: mockId("att", studentIndex * 1000 + courseIndex * 100 + week, 6),
          tenantId: MOCK_TENANT_ID,
          studentId: student.id,
          facultyId: null,
          sectionId: ATTENDANCE_SECTION_ID,
          courseId,
          date,
          status,
          sessionType: "LECTURE",
          remarks: null,
          markedAt: date,
          markedBy: null,
        };
      }).filter((row): row is Attendance => row !== null)
    );
  }
);

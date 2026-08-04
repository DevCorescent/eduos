// ============================================================================
// MODULE : Mock Data — Courses
// PURPOSE: The course catalogue, plus the faculty-to-course assignments that
//          make "courses running this semester" a real number rather than a
//          guess.
//
//          No backend route serves any of this yet — courses are backend
//          Phase 8. The fixtures are written against the contract in
//          types/entities.ts so the screens built on them need no change when
//          those routes land.
// ============================================================================

import type { Course, FacultyCourseAssignment } from "@/types";
import { daysAgo, seededInt, seededPick } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import { CURRENT_SEMESTER, MOCK_DEPARTMENTS, MOCK_SECTIONS } from "./academics";
import { MOCK_FACULTY } from "./people";

const CREATED = daysAgo(600);

/** Subject titles per department code, so a course sits plausibly in its department. */
const SUBJECTS: Record<string, string[]> = {
  CSE: [
    "Data Structures & Algorithms", "Operating Systems", "Database Management Systems",
    "Computer Networks", "Machine Learning", "Compiler Design", "Software Engineering",
    "Theory of Computation", "Cloud Computing", "Cyber Security Fundamentals",
  ],
  ECE: [
    "Digital Signal Processing", "Analog Electronics", "VLSI Design",
    "Microprocessors & Microcontrollers", "Communication Systems", "Embedded Systems",
  ],
  MECH: [
    "Thermodynamics", "Fluid Mechanics", "Strength of Materials",
    "Manufacturing Processes", "Heat Transfer",
  ],
  MBA: [
    "Marketing Management", "Financial Accounting", "Organisational Behaviour",
    "Operations Research", "Strategic Management", "Business Analytics",
  ],
  COM: ["Corporate Accounting", "Business Law", "Auditing & Assurance"],
  PHY: ["Quantum Mechanics", "Classical Mechanics", "Statistical Physics", "Electrodynamics"],
  PDES: ["Design Thinking", "Material Studies", "Human-Centred Design"],
  PED: ["Sports Physiology", "Fitness & Conditioning"],
};

/**
 * The catalogue.
 *
 * Built per department so every course has a real departmentId, and the
 * department filter on the courses screen returns sensible groupings rather
 * than an arbitrary scatter.
 */
export const MOCK_COURSES: Course[] = MOCK_DEPARTMENTS.flatMap((department, deptIndex) => {
  const subjects = SUBJECTS[department.code] ?? [];

  return subjects.map((name, subjectIndex): Course => {
    const seed = `course-${department.code}-${subjectIndex}`;
    // Labs and projects are the minority; most of a catalogue is core teaching.
    const type = seededPick(
      ["CORE", "CORE", "CORE", "ELECTIVE", "ELECTIVE", "LAB", "PROJECT"] as const,
      `${seed}-type`
    );

    return {
      id: mockId("crs", deptIndex * 20 + subjectIndex + 1),
      tenantId: MOCK_TENANT_ID,
      departmentId: department.id,
      code: `${department.code}${String(101 + subjectIndex * 2)}`,
      name,
      type,
      // A lab carries fewer credits than a lecture course; a project more.
      credits: type === "LAB" ? 2 : type === "PROJECT" ? 6 : seededInt(3, 4, `${seed}-cr`),
      description: null,
      syllabus: null,
      // One retired course per department, so the inactive branch renders.
      isActive: subjectIndex !== subjects.length - 1 || subjects.length < 4,
      createdAt: CREATED,
      updatedAt: CREATED,
    };
  });
});

export const COURSE_BY_ID = new Map(MOCK_COURSES.map((c) => [c.id, c]));

/**
 * Which faculty teaches which course, in which section, this semester.
 *
 * This is what makes "courses running" answerable. A course existing in the
 * catalogue does not mean it is being taught — only an assignment against the
 * current semester does, and counting the catalogue instead would overstate
 * the figure by every retired and unscheduled course.
 */
export const MOCK_FACULTY_ASSIGNMENTS: FacultyCourseAssignment[] = MOCK_SECTIONS.flatMap(
  (section, sectionIndex) => {
    // Five or six taught courses per section per semester — a normal load.
    const courseCount = seededInt(5, 6, `assign-${section.id}`);
    const activeCourses = MOCK_COURSES.filter((c) => c.isActive);

    return Array.from({ length: courseCount }, (_, i): FacultyCourseAssignment => {
      const seed = `assign-${section.id}-${i}`;
      // Offset by the loop index so one section does not draw the same course
      // repeatedly — seededPick is deterministic per seed, not per draw.
      const course = activeCourses[(seededInt(0, activeCourses.length - 1, seed) + i) % activeCourses.length];
      const faculty = seededPick(MOCK_FACULTY, `${seed}-fac`);

      return {
        id: mockId("fca", sectionIndex * 10 + i + 1, 4),
        tenantId: MOCK_TENANT_ID,
        facultyId: faculty.id,
        courseId: course.id,
        sectionId: section.id,
        semesterId: CURRENT_SEMESTER.id,
        isActive: true,
        createdAt: CREATED,
      };
    });
  }
);

/**
 * Distinct courses actually being taught in the current semester.
 *
 * Deduplicated by courseId: the same course taught to four sections is one
 * course running, not four.
 */
export function coursesRunningCount(): number {
  const running = new Set(
    MOCK_FACULTY_ASSIGNMENTS.filter((a) => a.semesterId === CURRENT_SEMESTER.id).map(
      (a) => a.courseId
    )
  );
  return running.size;
}

// ============================================================================
// MODULE : Mock Data — Assignments & Submissions
// PURPOSE: Set work for the section attendance and results exist for, plus one
//          submission per student per published assignment.
//
//          Scoped to that same section for the same reason attendance is: the
//          full cross-product across 186 students is tens of thousands of rows
//          that no screen reads.
//
//          The submission mix is deliberate — some graded, some submitted and
//          awaiting marking, some late, some not handed in at all. A fixture
//          where everyone submitted on time leaves the faculty portal's
//          grading queue permanently empty.
// ============================================================================

import type { Assignment, AssignmentSubmission } from "@/types";
import { daysAgo, seededInt, seededPick } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import { CURRENT_SEMESTER } from "./academics";
import { MOCK_COURSES, MOCK_FACULTY_ASSIGNMENTS } from "./courses";
import { ATTENDANCE_SECTION_ID, ATTENDANCE_STUDENTS } from "./academics-ops";
import { MOCK_FACULTY, MOCK_FACULTY_USERS } from "./people";

/** Courses taught to the demo section this semester. */
const SECTION_ASSIGNMENTS = MOCK_FACULTY_ASSIGNMENTS.filter(
  (assignment) =>
    assignment.sectionId === ATTENDANCE_SECTION_ID &&
    assignment.semesterId === CURRENT_SEMESTER.id
);

const TITLES = [
  "Problem Set",
  "Lab Report",
  "Case Study",
  "Term Project Proposal",
  "Literature Review",
  "Design Exercise",
];

const FACULTY_USER_BY_FACULTY_ID = new Map(
  MOCK_FACULTY.map((faculty) => [faculty.id, faculty.userId])
);

/** Three assignments per taught course. */
export const MOCK_ASSIGNMENTS: Assignment[] = SECTION_ASSIGNMENTS.flatMap(
  (facultyAssignment, courseIndex) => {
    const course = MOCK_COURSES.find((c) => c.id === facultyAssignment.courseId);

    return Array.from({ length: 3 }, (_, i): Assignment => {
      const seed = `assignment-${facultyAssignment.id}-${i}`;
      const title = seededPick(TITLES, `${seed}-title`);

      // The most recent one is still open; the older two are past their due
      // date, which is what gives the student portal both "due soon" and
      // "overdue" states to render.
      const daysUntilDue = i === 2 ? 9 : -(i + 1) * 14;
      const isPublished = true;

      return {
        id: mockId("asg", courseIndex * 10 + i + 1, 4),
        tenantId: MOCK_TENANT_ID,
        courseId: facultyAssignment.courseId,
        sectionId: ATTENDANCE_SECTION_ID,
        // A user id, not a faculty id — the column is createdBy.
        createdBy:
          FACULTY_USER_BY_FACULTY_ID.get(facultyAssignment.facultyId) ??
          MOCK_FACULTY_USERS[0]!.id,
        title: `${course?.code ?? "Course"} ${title} ${i + 1}`,
        description: `Complete and submit the ${title.toLowerCase()} for ${course?.name ?? "this course"}.`,
        type: seededPick(
          ["HOMEWORK", "HOMEWORK", "PROJECT", "ESSAY", "LAB_REPORT"] as const,
          `${seed}-type`
        ),
        // The two past-due ones are closed for submission; the open one is not.
        status: daysUntilDue < 0 ? "CLOSED" : "PUBLISHED",
        maxMarks: seededPick([20, 25, 50, 100], `${seed}-marks`),
        dueDate: daysAgo(-daysUntilDue),
        publishedAt: isPublished ? daysAgo(-daysUntilDue + 21) : null,
        attachments: null,
        createdAt: daysAgo(-daysUntilDue + 21),
        updatedAt: daysAgo(-daysUntilDue + 21),
      };
    });
  }
);

export const ASSIGNMENT_BY_ID = new Map(MOCK_ASSIGNMENTS.map((a) => [a.id, a]));

/**
 * Submissions, one per student per assignment — except where the student did
 * not hand anything in.
 *
 * A closed assignment is mostly graded; the open one is mostly unsubmitted,
 * which is what makes "pending" a real state on both portals rather than a
 * branch nobody reaches.
 */
export const MOCK_SUBMISSIONS: AssignmentSubmission[] = MOCK_ASSIGNMENTS.flatMap(
  (assignment, assignmentIndex) =>
    ATTENDANCE_STUDENTS.map((student, studentIndex): AssignmentSubmission | null => {
      const seed = `submission-${assignment.id}-${student.id}`;
      const roll = seededInt(0, 99, `${seed}-roll`);
      const isClosed = assignment.status === "CLOSED";

      // Nothing handed in: no row at all, which is what the database would
      // hold. Inventing a PENDING row for every non-submitter would make the
      // grading queue look full of work that does not exist.
      if (isClosed ? roll > 88 : roll > 35) return null;

      const graded = isClosed && roll < 75;
      const late = roll >= 60 && roll < 70;
      const submittedAt = daysAgo(
        seededInt(1, 20, `${seed}-submitted`) + (isClosed ? 20 : 0)
      );

      return {
        id: mockId("sub", assignmentIndex * 100 + studentIndex + 1, 5),
        assignmentId: assignment.id,
        studentId: student.id,
        status: graded ? "GRADED" : late ? "LATE" : "SUBMITTED",
        submittedAt,
        attachments: null,
        // Weighted to the upper half of the scale, with a failing tail.
        marks: graded
          ? Math.round((assignment.maxMarks * seededInt(35, 98, `${seed}-marks`)) / 100)
          : null,
        feedback: graded
          ? seededPick(
              [
                "Well structured and clearly argued.",
                "Correct, but show your working next time.",
                "Good effort — revisit the second section.",
                "Meets the brief.",
              ],
              `${seed}-feedback`
            )
          : null,
        gradedAt: graded ? daysAgo(seededInt(1, 10, `${seed}-graded`)) : null,
        gradedBy: graded ? assignment.createdBy : null,
        createdAt: submittedAt,
        updatedAt: graded ? daysAgo(seededInt(1, 10, `${seed}-graded`)) : submittedAt,
      };
    }).filter((row): row is AssignmentSubmission => row !== null)
);

export const SUBMISSIONS_BY_STUDENT = new Map<string, AssignmentSubmission[]>();
for (const submission of MOCK_SUBMISSIONS) {
  const existing = SUBMISSIONS_BY_STUDENT.get(submission.studentId);
  if (existing) existing.push(submission);
  else SUBMISSIONS_BY_STUDENT.set(submission.studentId, [submission]);
}

export const SUBMISSIONS_BY_ASSIGNMENT = new Map<string, AssignmentSubmission[]>();
for (const submission of MOCK_SUBMISSIONS) {
  const existing = SUBMISSIONS_BY_ASSIGNMENT.get(submission.assignmentId);
  if (existing) existing.push(submission);
  else SUBMISSIONS_BY_ASSIGNMENT.set(submission.assignmentId, [submission]);
}

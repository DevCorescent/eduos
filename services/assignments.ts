// ============================================================================
// MODULE : Services — Assignments & Submissions
// PURPOSE: Set work, from both sides: what a student owes, and what a lecturer
//          has to mark.
//
//          Both sides read GET /api/assignments, which returns scalar columns
//          only — no course, no submissions, no counts. Everything a row needs
//          beyond those columns is composed here, so no page issues a join.
// ============================================================================

import type {
  ApiResponse,
  Assignment,
  Course,
  AssignmentRow,
  AssignmentSubmission,
  ListParams,
  PaginatedResult,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { MAX_LIST_LIMIT } from "@/types/api";
import { courseIndex } from "./reference";
import { mapWithConcurrency } from "./concurrency";

/**
 * Attach the course, and the caller's own submission, to an assignment.
 *
 * The course comes from the shared index — GET /api/assignments returns a
 * courseId and no name. `withSubmission` is opt-in because it costs one request
 * per assignment: worth it on the student's own list, where the submission
 * status IS the row, and pointless on a lecturer's list, where every row is
 * their own.
 *
 * A submission read that fails leaves the field null. The API returns only the
 * caller's own submissions for a STUDENT, so an empty result and a forbidden
 * one mean the same thing here: nothing submitted that we may see.
 */
async function toRow(
  assignment: Assignment,
  courses: Map<string, Course>,
  withSubmission = false
): Promise<AssignmentRow> {
  const course = courses.get(assignment.courseId);

  let submission: AssignmentSubmission | null = null;
  if (withSubmission) {
    const result = await apiList<AssignmentSubmission>(
      `/api/assignments/${assignment.id}/submissions`,
      "submissions",
      { limit: 1 }
    );
    submission = result.success ? (result.data.items[0] ?? null) : null;
  }

  return {
    ...assignment,
    courseCode: course?.code ?? "—",
    courseName: course?.name ?? "—",
    submission,
  };
}

/**
 * What one student has been set.
 *
 * Unpublished assignments are excluded — `publishedAt` null means the lecturer
 * is still drafting it, and showing it would leak work that has not been set.
 */
export async function listStudentAssignments(
  studentId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<AssignmentRow>>> {
  // Issued together: the course catalogue does not depend on which assignments
  // come back, so awaiting it after the list put a whole round trip on the
  // critical path for nothing. It is also the call most likely to fail — the
  // catalogue is admin-only — and failing in parallel costs nothing.
  const [result, courses] = await Promise.all([
    apiList<Assignment>("/api/assignments", "assignments", { ...params, studentId }),
    courseIndex(),
  ]);
  if (!result.success) return result;

  const items = await Promise.all(
    result.data.items.map((assignment) => toRow(assignment, courses, true))
  );

  return { success: true, data: { ...result.data, items } };
}

/** What one lecturer has set, with a submission count for the grading queue. */
export interface FacultyAssignmentSummary extends AssignmentRow {
  submissionCount: number;
  gradedCount: number;
  pendingCount: number;
}

export async function listFacultyAssignments(
  createdBy: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<FacultyAssignmentSummary>>> {
  // Issued together, for the reason given in listStudentAssignments.
  const [result, courses] = await Promise.all([
    apiList<Assignment>("/api/assignments", "assignments", { ...params, createdBy }),
    courseIndex(),
  ]);
  if (!result.success) return result;

  // The grading queue counts come from each assignment's own submission list —
  // GET /api/assignments returns no aggregate. One request per row, bounded by
  // the page limit, and the counts are what the screen exists to show.
  const items = await mapWithConcurrency(result.data.items, async (assignment) => {
      const row = await toRow(assignment, courses);
      const submissions = await apiList<AssignmentSubmission>(
        `/api/assignments/${assignment.id}/submissions`,
        "submissions",
        { limit: 100 }
      );

      const rows = submissions.success ? submissions.data.items : [];
      const graded = rows.filter((submission) => submission.gradedAt !== null).length;

      return {
        ...row,
        submissionCount: submissions.success ? submissions.data.pagination.total : 0,
        gradedCount: graded,
        pendingCount: rows.length - graded,
      };
  });

  return { success: true, data: { ...result.data, items } };
}

/** Every submission for one assignment, for the grading screen. */
export interface SubmissionRow extends AssignmentSubmission {
  studentName: string;
  enrollmentNo: string;
}

export async function listSubmissions(
  assignmentId: string
): Promise<ApiResponse<SubmissionRow[]>> {
  const result = await apiList<AssignmentSubmission>(
    `/api/assignments/${assignmentId}/submissions`,
    "submissions",
    { limit: MAX_LIST_LIMIT }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map((submission) => ({
      ...submission,
      studentName: "—",
      enrollmentNo: "—",
    })),
  };
}

/**
 * Record a mark and feedback against one submission.
 *
 * Marks are validated against the assignment's own maximum rather than trusted:
 * a typo entering 95 on a paper out of 50 would otherwise be stored, and every
 * downstream average would be wrong with nothing to show why.
 */
export async function gradeSubmission(
  assignmentId: string,
  submissionId: string,
  marks: number,
  feedback?: string
): Promise<ApiResponse<AssignmentSubmission>> {
  // A submission is addressed under its parent assignment — there is no
  // top-level /api/submissions route, so the previous URL 404'd and no mark was
  // ever saved. The route validates marks against the assignment's own maxMarks,
  // which is why the parent id is part of the path rather than a lookup.
  return apiRequest<AssignmentSubmission>(
    `/api/assignments/${assignmentId}/submissions/${submissionId}`,
    {
      method: "PATCH",
      // feedback is optional in the schema and rejected when empty, so an
      // untouched textarea must be omitted rather than sent as "".
      body: feedback && feedback.trim().length > 0 ? { marks, feedback } : { marks },
    }
  );
}

export async function getAssignment(id: string): Promise<ApiResponse<AssignmentRow>> {
  const result = await apiRequest<Assignment>(`/api/assignments/${id}`);
  if (!result.success) return result;

  return { success: true, data: await toRow(result.data, await courseIndex(), true) };
}

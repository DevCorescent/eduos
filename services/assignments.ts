// ============================================================================
// MODULE : Services — Assignments & Submissions
// PURPOSE: Set work, from both sides: what a student owes, and what a lecturer
//          has to mark.
//
//          No backend route serves this yet (backend Phase 9). Written against
//          the contract in types/entities.ts.
// ============================================================================

import type {
  ApiResponse,
  Assignment,
  AssignmentRow,
  AssignmentSubmission,
  ListParams,
  PaginatedResult,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import { COURSE_BY_ID } from "@/mock/data/courses";
import {
  ASSIGNMENT_BY_ID,
  MOCK_ASSIGNMENTS,
} from "@/mock/data/assignments";
import { studentStore } from "@/mock/studentStore";
import { submissionStore } from "@/mock/assignmentStores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

/**
 * Attach the course, and this student's own submission, to an assignment.
 *
 * Submissions are read from the store, not from the module-load index: grading
 * writes to the store, and reading a snapshot would show a just-marked
 * submission as still ungraded.
 */
function toRow(assignment: Assignment, studentId?: string): AssignmentRow {
  const course = COURSE_BY_ID.get(assignment.courseId);
  const submission = studentId
    ? (submissionStore
        .all()
        .find((s) => s.assignmentId === assignment.id && s.studentId === studentId) ?? null)
    : null;

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
  if (USE_MOCKS) {
    const student = studentStore.find(studentId);

    const rows = MOCK_ASSIGNMENTS.filter(
      (assignment) =>
        assignment.publishedAt !== null &&
        // Section-scoped work only reaches the students in that section.
        (assignment.sectionId === null || assignment.sectionId === student?.sectionId)
    ).map((assignment) => toRow(assignment, studentId));

    return mockList(rows, params, {
      searchFields: ["title", "courseCode", "courseName"],
      filterKeys: ["status", "courseId"],
      // Soonest deadline first — the order a student actually works in. An
      // assignment with no due date sorts last rather than crashing the compare.
      sort: (a, b) =>
        (a.dueDate ? Date.parse(a.dueDate) : Number.MAX_SAFE_INTEGER) -
        (b.dueDate ? Date.parse(b.dueDate) : Number.MAX_SAFE_INTEGER),
    });
  }

  const result = await apiList<Assignment>("/api/assignments", "assignments", {
    ...params,
    studentId,
  });
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((assignment) => toRow(assignment)),
    },
  };
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
  if (USE_MOCKS) {
    const rows: FacultyAssignmentSummary[] = MOCK_ASSIGNMENTS.filter(
      (assignment) => assignment.createdBy === createdBy
    ).map((assignment) => {
      const submissions = submissionStore
        .all()
        .filter((s) => s.assignmentId === assignment.id);
      const graded = submissions.filter((s) => s.status === "GRADED").length;

      return {
        ...toRow(assignment),
        submissionCount: submissions.length,
        gradedCount: graded,
        // What is actually waiting for the lecturer, which is the number the
        // grading queue is sorted and badged by.
        pendingCount: submissions.length - graded,
      };
    });

    return mockList(rows, params, {
      searchFields: ["title", "courseCode"],
      filterKeys: ["status", "courseId"],
      // Most work waiting first.
      sort: (a, b) => b.pendingCount - a.pendingCount,
    });
  }

  const result = await apiList<Assignment>("/api/assignments", "assignments", {
    ...params,
    createdBy,
  });
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((assignment) => ({
        ...toRow(assignment),
        submissionCount: 0,
        gradedCount: 0,
        pendingCount: 0,
      })),
    },
  };
}

/** Every submission for one assignment, for the grading screen. */
export interface SubmissionRow extends AssignmentSubmission {
  studentName: string;
  enrollmentNo: string;
}

export async function listSubmissions(
  assignmentId: string
): Promise<ApiResponse<SubmissionRow[]>> {
  if (USE_MOCKS) {
    const rows = submissionStore
      .all()
      .filter((submission) => submission.assignmentId === assignmentId)
      .map((submission): SubmissionRow => {
        const student = studentStore.find(submission.studentId);
        return {
          ...submission,
          studentName: student?.fullName ?? "—",
          enrollmentNo: student?.enrollmentNo ?? "—",
        };
      });

    // Ungraded first: the lecturer opened this screen to mark, not to re-read
    // work already marked.
    return mockOk(
      rows.sort(
        (a, b) =>
          Number(a.status === "GRADED") - Number(b.status === "GRADED") ||
          a.studentName.localeCompare(b.studentName)
      )
    );
  }

  const result = await apiList<AssignmentSubmission>(
    `/api/assignments/${assignmentId}/submissions`,
    "submissions",
    { limit: 200 }
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
  if (USE_MOCKS) {
    const submission = submissionStore.find(submissionId);
    if (!submission) {
      return mockFail<AssignmentSubmission>("Submission not found", "NOT_FOUND");
    }

    const assignment = ASSIGNMENT_BY_ID.get(submission.assignmentId);
    if (!assignment) {
      return mockFail<AssignmentSubmission>("Assignment not found", "NOT_FOUND");
    }

    if (marks < 0 || marks > assignment.maxMarks) {
      return mockFail<AssignmentSubmission>(
        `Marks must be between 0 and ${assignment.maxMarks}.`,
        "VALIDATION_ERROR"
      );
    }

    const timestamp = new Date().toISOString();
    const updated = submissionStore.update(submissionId, {
      marks,
      feedback: feedback?.trim() || null,
      status: "GRADED",
      gradedAt: timestamp,
      updatedAt: timestamp,
    });

    return updated
      ? mockOk(updated, "Submission graded")
      : mockFail<AssignmentSubmission>("Submission not found", "NOT_FOUND");
  }

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
  if (USE_MOCKS) {
    const assignment = ASSIGNMENT_BY_ID.get(id);
    return assignment
      ? mockOk(toRow(assignment))
      : mockFail<AssignmentRow>("Assignment not found", "NOT_FOUND");
  }

  const result = await apiRequest<Assignment>(`/api/assignments/${id}`);
  return result.success ? { success: true, data: toRow(result.data) } : result;
}

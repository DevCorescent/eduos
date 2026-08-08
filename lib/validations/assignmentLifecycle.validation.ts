// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Validation
// PURPOSE: The request contracts for the six new Phase 24 endpoints.
//
// WHAT IS DELIBERATELY REUSED FROM PHASE 10
//   `attachmentList` is restated here for the same reason Phase 10 restated it
//   between assignment.ts and submission.ts: the columns are separate and may
//   diverge if an upload contract is ever defined for one and not the other.
//   Nothing else is duplicated — the create and update contracts for an
//   assignment remain Phase 10's, and this module adds no second version of
//   them.
//
// THE SUBMIT SCHEMA CARRIES NO studentId, BY CONSTRUCTION
//   POST /api/assignments/[id]/submit is SELF-SERVICE: the student is resolved
//   from session.sub inside the service. There is no key to supply one, and the
//   schema is .strict() so an attempt is a 400 rather than a silent strip — a
//   client that believes it submitted on another student's behalf must be told
//   it did not.
// ============================================================================

import { z } from "zod";
import { identifier } from "@/lib/validations/shared";
import { ASSIGNMENT_ROSTER_MAX_LIMIT } from "@/lib/constants/assignmentLifecycle";

/**
 * Attachment list for a submission.
 *
 * AssignmentSubmission.attachments is a Json? column with no declared
 * structure, so the contents are accepted as given rather than fabricated —
 * the project's settled treatment of a Json column. The array wrapper
 * guarantees a reader can iterate the column, which a bare record would not.
 */
const attachmentList = z.array(z.record(z.string(), z.unknown()));

/** The [id] route segment naming an assignment. */
export const assignmentLifecycleParamSchema = z.object({ id: identifier });

export type AssignmentLifecycleParam = z.infer<typeof assignmentLifecycleParamSchema>;

/**
 * POST /api/assignments/[id]/submit
 *
 * The body may legitimately be empty: a submission is an ACT rather than a
 * payload, and recording that a student submitted with nothing attached is a
 * meaningful outcome. Same reasoning as Phase 10's createSubmissionSchema.
 *
 * `status` and `submittedAt` are absent and therefore refused. Both are
 * server-derived — accepting `submittedAt` would let a client backdate a
 * submission to beat a deadline, and accepting `status` would let a late
 * submission be recorded as on-time.
 */
export const submitAssignmentSchema = z
  .object({
    attachments: attachmentList.optional(),
  })
  .strict();

export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;

/**
 * PATCH /api/assignments/[id]/grade
 *
 * `submissionId` is REQUIRED and lives in the body because the README's route
 * has no segment for it. That is the only structural difference from Phase 10's
 * PATCH /[id]/submissions/[sid]; both reach the same service method, so the
 * grading rules exist once.
 *
 * `marks` is bounded to a non-negative integer here. The upper bound cannot be
 * applied in validation — it depends on Assignment.maxMarks, a stored value
 * this module cannot read — so the service enforces `marks <= maxMarks` after
 * loading the parent.
 *
 * ZERO IS ACCEPTED, deliberately diverging from Phase 10's
 * gradeSubmissionSchema, which requires a positive mark. A student who
 * submitted nothing of merit scores zero, and refusing to record that forces a
 * faculty member either to award a mark that was not earned or to leave the
 * submission ungraded forever. Phase 10's route is untouched and keeps its own
 * rule; this is a new endpoint stating its own.
 */
export const gradeAssignmentSchema = z
  .object({
    submissionId: identifier,
    marks: z.number().int().min(0),
    feedback: z.string().trim().min(1).max(5000).optional(),
  })
  .strict();

export type GradeAssignmentInput = z.infer<typeof gradeAssignmentSchema>;

/**
 * GET /api/assignments/[id]/pending and /submitted.
 *
 * Paginated: a roster is bounded by a cohort, and a first-year core course can
 * carry several hundred students.
 */
export const assignmentRosterQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(ASSIGNMENT_ROSTER_MAX_LIMIT).default(50),
  })
  .strict();

export type AssignmentRosterQuery = z.infer<typeof assignmentRosterQuerySchema>;

/**
 * GET /api/assignments/analytics
 *
 * Every filter optional, so the endpoint answers "how is this course doing",
 * "how is this section doing" and "how is everything doing" without three
 * routes. `assignmentId` narrows to one, which is the per-assignment view a
 * faculty member opens from a list.
 */
export const assignmentAnalyticsQuerySchema = z
  .object({
    assignmentId: identifier.optional(),
    courseId: identifier.optional(),
    sectionId: identifier.optional(),
  })
  .strict();

export type AssignmentAnalyticsQuery = z.infer<typeof assignmentAnalyticsQuerySchema>;

// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Submission Validation
// FLOW   : Validates the submission route params and request bodies before
//          either reaches the database.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
//          No access control is performed here — that stays in requireRole and
//          the routes. Submissions are recorded on a student's behalf, the same
//          shape as attendance; a student never calls these endpoints.
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Keep submission request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";

/**
 * Attachment list for a submission.
 *
 * AssignmentSubmission.attachments is a Json? column with no declared structure.
 * The project's settled treatment of a Json column is z.record(z.string(),
 * z.unknown()) — used for Campus.address, three StudentPersonal columns, two
 * Tenant columns and UserRole.scope — so the contents are accepted as given
 * rather than fabricated. Attachments are plural, so the array wrapper is the
 * only addition: it guarantees a reader can iterate the column, which a bare
 * record would not.
 *
 * The shape is therefore an array of objects and nothing else. A scalar, a
 * string, a number, a boolean, a bare object, an array of primitives and an
 * array of arrays are all rejected — the outer z.array refuses anything that is
 * not an array, and the inner z.record refuses any element that is not a plain
 * object.
 *
 * This restates the identical private constant in lib/validations/assignment.ts
 * rather than importing it. The two columns are separate and may diverge if an
 * upload contract is ever defined for one and not the other, and exporting it
 * from the assignment module would widen that module's surface beyond the three
 * schemas it is specified to export. Restating it is the same trade already made
 * for the *_SELECT constants in the route layer.
 */
const attachmentList = z.array(z.record(z.string(), z.unknown()));

/**
 * Body schema for POST /api/assignments/[id]/submissions.
 *
 * attachments is the only client-writable column on create. Every other field of
 * a new submission is established by the route or by the database.
 *
 * The body may legitimately be empty. A submission is an act rather than a
 * payload — recording that a student submitted, with nothing attached, is a
 * meaningful outcome — so no key is required and {} parses successfully. This
 * differs deliberately from updateAssignmentSchema, which refuses an empty body
 * because an update with no fields would be a silent no-op that still advanced
 * updatedAt. Here the write is a create and always has an effect.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id            — server-managed, a cuid from the database default.
 *   assignmentId  — taken from the [id] route segment, never the body, so a
 *                   submission cannot be filed against a different assignment
 *                   than the one addressed in the URL.
 *   studentId     — supplied by the route after a tenant-scoped lookup. It is
 *                   absent here because this schema validates shape only; the
 *                   route owns which student a submission belongs to and proves
 *                   that student is inside the caller's tenant.
 *   status        — server-derived. SUBMITTED or LATE is decided by comparing the
 *                   submission time against Assignment.dueDate, so accepting it
 *                   from the client would let a late submission be recorded as
 *                   on-time.
 *   submittedAt   — the server clock. Accepting it would let a client backdate a
 *                   submission to beat a deadline.
 *   gradedAt,
 *   gradedBy      — set only by the grading endpoint, from the authenticated
 *                   session. They describe an act that has not happened yet at
 *                   create time.
 *   createdAt,
 *   updatedAt     — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is the
 * project-wide behaviour of a plain z.object(): no schema in this project uses
 * .strict().
 */
export const createSubmissionSchema = z.object({
  attachments: attachmentList.optional(),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

/**
 * Body schema for PATCH /api/assignments/[id]/submissions/[sid].
 *
 * marks is required. A grading request that carries no mark is not a grading
 * request: the route sets status to GRADED as part of applying it, and a GRADED
 * submission with a null mark would be an incoherent row that the schema is
 * happy to store. Requiring it also makes an empty body a validation failure
 * without needing the at-least-one-key refine that updateAssignmentSchema uses.
 *
 * marks is bounded here to a positive integer. The column is a plain Int? with no
 * check constraint, so the database would accept a negative figure. The upper
 * bound cannot be applied here — it depends on Assignment.maxMarks, which is a
 * stored value this module cannot read — so the route enforces
 * marks <= maxMarks after loading the parent assignment. No database lookup is
 * performed in validation, matching every other schema in the project.
 *
 * Note that zero is rejected by this rule. Assignment.maxMarks is bounded the
 * same way in lib/validations/assignment.ts, where a positive lower bound is
 * unambiguous; for a student's score the lower bound also excludes a mark of
 * zero, which the column itself would accept. This follows the specified
 * contract rather than the schema.
 *
 * feedback is optional and trimmed, with an empty or whitespace-only value
 * rejected rather than stored as "". Omitting it leaves the stored value
 * unchanged; there is no way to clear it back to null through this endpoint,
 * matching every other update schema in the project.
 *
 * Deliberately absent, and therefore stripped: id, assignmentId, studentId,
 * status, submittedAt, gradedAt, gradedBy, createdAt and updatedAt. status,
 * gradedAt and gradedBy are precisely what grading writes, and all three are
 * derived — the status becomes GRADED, gradedAt is the server clock, and gradedBy
 * is the authenticated session, so a grade can never be attributed to another
 * user. submittedAt and the two identity columns are equally unwritable, so
 * grading can neither move a submission to a different student nor rewrite when
 * it arrived.
 */
export const gradeSubmissionSchema = z.object({
  marks: z.number().int().positive(),
  feedback: z.string().trim().min(1).optional(),
});

export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;

/**
 * Route param schema for /api/assignments/[id]/submissions/[sid].
 *
 * Keyed on sid rather than id, because that is the segment name and so the key
 * Next.js supplies. assignmentIdParamSchema is keyed on id for the [id] segment
 * and cannot be reused here: a plain z.object() strips unknown keys, so parsing
 * the route's { id, sid } params against it would silently validate the parent
 * assignment's id and never look at the submission's. The two segments would
 * then be indistinguishable to the route. Same reasoning as
 * curriculumSubjectIdParamSchema, timetableSectionParamSchema and
 * attendanceStudentParamSchema, each of which is keyed on its own segment name
 * for exactly this reason.
 *
 * The validation rules are otherwise identical to assignmentIdParamSchema.
 * AssignmentSubmission.id is a cuid, but no format assertion is applied: the id
 * is an opaque key, and asserting a shape would turn an
 * unrecognised-but-well-formed id into a 400 when 404 is the accurate answer.
 * Only an empty or whitespace-only segment is rejected outright.
 */
export const submissionIdParamSchema = z.object({
  sid: z.string().trim().min(1),
});

export type SubmissionIdParam = z.infer<typeof submissionIdParamSchema>;

// No query schema is declared. GET /api/assignments/[id]/submissions pages on the
// shared contract, and paginationQuerySchema is consumed directly by the route
// exactly as the timetable, attendance and assignment routes consume it — the
// aliases other modules define are plain re-exports of that same object, never
// extensions of it. No filter parameter is defined for this phase.

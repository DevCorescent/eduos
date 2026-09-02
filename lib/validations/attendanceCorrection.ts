// ============================================================================
// MODULE : Attendance corrections — request contracts (PRD §13.2)
// LAYER  : Validation
//
// WHAT IS DELIBERATELY ABSENT
//   `requestedById` and `reviewedById`. Both are the authenticated subject and
//   are read from the session, never the body — a correction that could name
//   its own author could be misattributed to someone who never raised it.
//
//   `currentStatus`. It is copied from the attendance row by the service at the
//   moment the request is raised. Accepting it from the client would let a
//   caller state a "before" value that was never true, and an approver would
//   then be shown a change that did not happen.
//
//   `status`. The workflow state is server-managed, the same treatment
//   Assignment.status and ExamStatus receive elsewhere in this project.
// ============================================================================

import { z } from "zod";
import { AttendanceStatus, AttendanceCorrectionStatus } from "@/app/generated/prisma/enums";

/** A trimmed, non-empty explanation. A correction with no reason is not reviewable. */
const reason = z.string().trim().min(1).max(500);

export const raiseCorrectionSchema = z
  .object({
    attendanceId: z.string().trim().min(1),
    requestedStatus: z.enum(AttendanceStatus),
    reason,
  })
  .strict();

export type RaiseCorrectionInput = z.infer<typeof raiseCorrectionSchema>;

/**
 * The review decision.
 *
 * `note` is optional here and REQUIRED on rejection by the service: the rule is
 * conditional on the decision, which a flat schema cannot express without
 * making an approval note mandatory too.
 */
export const reviewCorrectionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type ReviewCorrectionInput = z.infer<typeof reviewCorrectionSchema>;

export const listCorrectionsQuerySchema = z.object({
  status: z.enum(AttendanceCorrectionStatus).optional(),
});

export const correctionIdParamSchema = z.object({ id: z.string().trim().min(1) });

// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score
// LAYER  : Validation
// PURPOSE: Shape and bounds for every marks request, applied before the
//          controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : field shape, the decimal scale of a mark, the batch ceiling, that a
//          batch names no registration twice, and the status/mark invariant —
//          an absent student carries no mark, and a present one must. All of it
//          is decidable from the body alone.
//   Not  : the upper bound on a mark. That is the SITTING's own total, which
//          only the database knows — the same split already used for
//          passMark <= maxMarks in the examination module.
//   Not  : whether the sitting is OPEN, whether the registrations exist, belong
//          to this course, term, teaching group and regulation, or whether the
//          caller may write to this sitting at all.
// ============================================================================

import { z } from "zod";
import { MarkStatus } from "@/app/generated/prisma/client";
import { MAX_MARKS_MAX } from "@/lib/constants/evaluationComponent";
import {
  MARK_MIN,
  MARK_REMARKS_MAX_LENGTH,
  MAX_BULK_MARKS,
  STATUS_WITHOUT_MARKS,
} from "@/lib/constants/studentComponentScore";
import { boundedDecimal, identifier } from "@/lib/validations/shared";

/**
 * One student's mark.
 *
 * `marksObtained` is bounded ABOVE by the widest total any sitting could be set
 * out of, not by this sitting's own — that comparison needs the stored event
 * and belongs to the service. What this bound does is stop a value the
 * Decimal(6,2) column could not hold from reaching the database, which is the
 * overflow class recorded as TD-005 closed at the boundary.
 *
 * `status` defaults to RECORDED, so an ordinary marks spreadsheet needs only a
 * registration id and a number.
 */
const markEntrySchema = z
  .object({
    courseRegistrationId: identifier,
    marksObtained: boundedDecimal(MARK_MIN, MAX_MARKS_MAX).optional(),
    status: z.enum(MarkStatus).optional(),
    remarks: z.string().trim().max(MARK_REMARKS_MAX_LENGTH).optional(),
  })
  .refine(
    (entry) => {
      const status = entry.status ?? MarkStatus.RECORDED;
      const hasMark = entry.marksObtained !== undefined;

      // The invariant the column cannot express: a mark is absent exactly when
      // the student was. Zero is a mark; absence is not.
      return status === STATUS_WITHOUT_MARKS ? !hasMark : hasMark;
    },
    {
      message: "An absent student carries no mark, and a present one must have one",
      path: ["marksObtained"],
    }
  );

export type MarkEntryInput = z.infer<typeof markEntrySchema>;

/**
 * Body schema for POST /api/results/internal and /api/results/external.
 *
 * ONE shape serves single and bulk upload: a single mark is a batch of one, so
 * a separate endpoint for it would be the same code behind a different URL.
 *
 * A batch naming the same registration twice is REJECTED rather than silently
 * de-duplicated. Two rows for one student in a marks spreadsheet is a
 * transcription error, and the second value quietly winning is precisely how a
 * wrong mark reaches a transcript.
 */
export const uploadMarksSchema = z.object({
  assessmentEventId: identifier,
  marks: z
    .array(markEntrySchema)
    .min(1)
    .max(MAX_BULK_MARKS)
    .refine(
      (entries) =>
        new Set(entries.map((entry) => entry.courseRegistrationId)).size === entries.length,
      { message: "The same registration appears more than once in this upload" }
    ),
});

export type UploadMarksInput = z.infer<typeof uploadMarksSchema>;

/** Route param schema for /api/assessment-events/[id]/marks. */
export const marksSheetParamSchema = z.object({
  id: identifier,
});

export type MarksSheetParam = z.infer<typeof marksSheetParamSchema>;

// No pagination schema is declared for the marks sheet. It is bounded by the
// class registered for one sitting, and an examiner reconciling entries against
// a register needs the whole list — a partial one invites the transcription
// error the reconciliation exists to catch.

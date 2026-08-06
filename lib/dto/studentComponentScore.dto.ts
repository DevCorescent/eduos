// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
// The same two boundary conversions as every Phase 16 DTO: Date to ISO-8601
// string, and Decimal to a lossless string. `marksObtained` is nullable in both
// the column and the DTO, and the null is meaningful — it is what absence looks
// like, and it is not the same as zero.
// ============================================================================

import type { MarkStatus } from "@/app/generated/prisma/client";
import type { AssessmentEventStatus } from "@/app/generated/prisma/client";

/** One student's mark at one sitting. */
export interface StudentComponentScoreDTO {
  id: string;
  tenantId: string;

  assessmentEventId: string;
  courseRegistrationId: string;

  /** Decimal(6,2) as a lossless string, or null exactly when ABSENT. */
  marksObtained: string | null;
  status: MarkStatus;
  remarks: string | null;

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * A sitting's whole marks sheet.
 *
 * Returned unpaginated. A marks sheet is bounded by the class registered for
 * one sitting, and a page of it is not a marks sheet — an examiner reconciling
 * entries against a register needs the whole list, and a partial one invites
 * exactly the transcription error the reconciliation exists to catch.
 *
 * The sitting's own state travels with it so a client knows, without a second
 * request, whether to render an editable grid: `acceptsMarks` is the single
 * predicate that decides it.
 */
export interface MarksSheetDTO {
  assessmentEventId: string;
  eventStatus: AssessmentEventStatus;
  /** Derived from the sitting's status — OPEN alone accepts marks. */
  acceptsMarks: boolean;
  /** Decimal(6,2) as a lossless string — what this paper was marked out of. */
  maxMarks: string;

  recordedCount: number;
  absentCount: number;
  withheldCount: number;

  entries: StudentComponentScoreDTO[];
}

/**
 * The outcome of an upload.
 *
 * Reports counts rather than echoing a thousand rows, for the same reason bulk
 * registration does: a payload proportional to the cohort tells the caller
 * nothing it did not already send.
 *
 * `unchanged` is reported separately and is not a failure. Re-uploading a
 * corrected spreadsheet is the ordinary case, and the marks whose values did
 * not move were not written at all — which is both the honest count and the
 * reason a re-upload is cheap.
 */
export interface MarkUploadResultDTO {
  assessmentEventId: string;
  submittedCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
}

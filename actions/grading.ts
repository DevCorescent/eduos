"use server";

// ============================================================================
// MODULE : Actions — Grading
// PURPOSE: Server Action for recording a mark against a submission.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import { gradeSubmission } from "@/services/assignments";
import { uploadInternalMarks, type MarkEntry } from "@/services/evaluation";
import type { ActionResult } from "./setup";

export async function gradeSubmissionAction(
  assignmentId: string,
  submissionId: string,
  marks: number,
  feedback?: string
): Promise<ActionResult> {
  // Caught here as well as in the service so a non-numeric entry never reaches
  // the store — the input is `type="number"` but a pasted value can still be
  // NaN by the time it arrives.
  if (!Number.isFinite(marks)) {
    return { success: false, error: "Enter a number.", field: "marks" };
  }

  const result = await gradeSubmission(assignmentId, submissionId, marks, feedback);

  // The out-of-range message belongs on the marks field, not in a banner — it
  // names the exact bound the lecturer has to stay within.
  if (!result.success && result.code === "VALIDATION_ERROR") {
    return { ...result, field: "marks" };
  }

  return result;
}

/** One row of the marks grid, as the form collects it. */
export interface ComponentMarkInput {
  courseRegistrationId: string;
  /** Empty string means "left blank" — the row is skipped, not zeroed. */
  marksObtained: string;
  absent: boolean;
}

/**
 * Record internal-assessment marks for one sitting.
 *
 * AUTHORIZATION IS NOT DONE HERE, DELIBERATELY.
 *   POST /api/results/internal already resolves the caller from their session
 *   and refuses a lecturer who did not conduct the sitting
 *   (MarkUploadAuthority.restrictToConductedEvents → FACULTY_NOT_CONDUCTOR).
 *   Re-checking in this action would be a second, weaker opinion about the same
 *   question, and the endpoint remains the only thing that can be trusted
 *   because it is the only one a client cannot skip.
 *
 *   No facultyId is sent. The server takes the identity from the session.
 *
 * BLANK ROWS ARE SKIPPED, NOT ZEROED.
 *   A lecturer marking half a cohort must be able to save without recording a
 *   zero for everyone they have not reached yet. A zero is a real mark and
 *   would fail those students.
 */
export async function recordComponentMarksAction(
  assessmentEventId: string,
  rows: ComponentMarkInput[],
  maxMarks: number
): Promise<ActionResult> {
  const entries: MarkEntry[] = [];

  for (const row of rows) {
    if (row.absent) {
      entries.push({ courseRegistrationId: row.courseRegistrationId, status: "ABSENT" });
      continue;
    }

    const raw = row.marksObtained.trim();
    if (raw === "") continue;

    const value = Number(raw);

    // Validated here as well as server-side so a typo is reported beside the
    // grid rather than as a rejected batch the lecturer must reconstruct.
    if (!Number.isFinite(value)) {
      return { success: false, error: `"${raw}" is not a number.`, code: "VALIDATION_ERROR" };
    }
    if (value < 0) {
      return { success: false, error: "A mark cannot be negative.", code: "VALIDATION_ERROR" };
    }
    if (value > maxMarks) {
      return {
        success: false,
        error: `A mark cannot exceed the maximum of ${maxMarks}.`,
        code: "VALIDATION_ERROR",
      };
    }

    // A NUMBER, not a formatted string: internalMarkUploadSchema declares
    // marksObtained as numeric and rejects "27.00" outright. The Decimal
    // rounding belongs to the database column, not to the transport.
    entries.push({
      courseRegistrationId: row.courseRegistrationId,
      marksObtained: value,
      status: "RECORDED",
    });
  }

  if (entries.length === 0) {
    return { success: false, error: "No marks were entered.", code: "VALIDATION_ERROR" };
  }

  return uploadInternalMarks(assessmentEventId, entries);
}

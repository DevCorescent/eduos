"use server";

// ============================================================================
// MODULE : Actions — Grading
// PURPOSE: Server Action for recording a mark against a submission.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import { gradeSubmission } from "@/services/assignments";
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

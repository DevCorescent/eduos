"use server";

// ============================================================================
// MODULE : Actions — attendance corrections (PRD §13.2)
// PURPOSE: Server Actions for raising and deciding correction requests.
//
// AUTHORIZATION IS NOT DECIDED HERE.
//   The routes apply ATTENDANCE_CORRECTION_REQUEST_ROLES and
//   ATTENDANCE_CORRECTION_REVIEW_ROLES, resolve the actor from the session, and
//   refuse self-review in the domain. Re-checking here would be a second,
//   weaker opinion about the same question, and the route is the one a client
//   cannot skip.
// ============================================================================

import {
  raiseAttendanceCorrection,
  reviewAttendanceCorrection,
} from "@/services/academics";
import type { ActionResult } from "./setup";

type FormValues = Record<string, unknown>;

function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

/** Raise a correction. Validated here only for the message beside the field. */
export async function raiseCorrectionAction(values: FormValues): Promise<ActionResult> {
  const attendanceId = str(values, "attendanceId");
  const requestedStatus = str(values, "requestedStatus");
  const reason = str(values, "reason");

  if (attendanceId === "") {
    return { success: false, error: "No attendance record was named." };
  }
  if (requestedStatus === "") {
    return { success: false, error: "Choose the corrected status.", field: "requestedStatus" };
  }
  // The API enforces this too; caught here so the message lands on the field.
  if (reason === "") {
    return { success: false, error: "State why this needs correcting.", field: "reason" };
  }

  return raiseAttendanceCorrection({ attendanceId, requestedStatus, reason });
}

/**
 * Approve or reject one request.
 *
 * A rejection without a note is refused before the request is sent: the person
 * whose correction was refused is owed the reason, and the API refuses it too.
 */
export async function reviewCorrectionAction(
  id: string,
  decision: "APPROVE" | "REJECT",
  note?: string
): Promise<ActionResult> {
  if (id.trim() === "") {
    return { success: false, error: "No correction request was named." };
  }

  if (decision === "REJECT" && (note ?? "").trim() === "") {
    return { success: false, error: "A rejection must state a reason.", field: "note" };
  }

  return reviewAttendanceCorrection(id, decision, note);
}

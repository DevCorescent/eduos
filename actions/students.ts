"use server";

// ============================================================================
// MODULE : Actions — Students
// PURPOSE: Server Actions for enrolment and student edits.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import type { ApiResponse } from "@/types";
import {
  enrolStudent,
  updateStudent,
  type EnrolStudentInput,
  type UpdateStudentInput,
} from "@/services/students";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { ActionResult } from "./setup";

function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

function optionalStr(values: FormValues, key: string): string | undefined {
  const value = str(values, key);
  return value === "" ? undefined : value;
}

function optionalNum(values: FormValues, key: string): number | undefined {
  const raw = values[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? undefined : numeric;
}

/**
 * Route a conflict to the field that caused it.
 *
 * Enrolment has two distinct uniqueness constraints — the enrolment number and
 * the email — and they are fixed in different inputs. A single "Conflict"
 * banner would leave the user guessing which.
 */
function routeConflict(result: ApiResponse<unknown>): ActionResult {
  if (result.success || result.code !== "CONFLICT") return result;

  const field = result.error.toLowerCase().includes("email")
    ? "email"
    : "enrollmentNo";
  return { ...result, field };
}

export async function enrolStudentAction(values: FormValues): Promise<ActionResult> {
  const password = str(values, "password");
  if (password.length < 8) {
    return { success: false, error: "Use at least 8 characters.", field: "password" };
  }

  const input: EnrolStudentInput = {
    firstName: str(values, "firstName"),
    lastName: str(values, "lastName"),
    email: str(values, "email").toLowerCase(),
    password,
    phone: optionalStr(values, "phone"),
    enrollmentNo: str(values, "enrollmentNo"),
    programmeId: optionalStr(values, "programmeId"),
    batchId: optionalStr(values, "batchId"),
    sectionId: optionalStr(values, "sectionId"),
    currentSemester: optionalNum(values, "currentSemester"),
    admissionDate: str(values, "admissionDate"),
  };

  return routeConflict(await enrolStudent(input));
}

export async function updateStudentAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: UpdateStudentInput = {
    enrollmentNo: str(values, "enrollmentNo"),
    // Passed as "" rather than omitted when cleared, so the service can tell
    // "unset this" from "leave unchanged" on a nullable column.
    programmeId: str(values, "programmeId"),
    batchId: str(values, "batchId"),
    sectionId: str(values, "sectionId"),
    currentSemester: optionalNum(values, "currentSemester"),
    status: optionalStr(values, "status") as UpdateStudentInput["status"],
  };

  return routeConflict(await updateStudent(id, input));
}

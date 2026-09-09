"use server";

// ============================================================================
// MODULE : Actions — Assignments
// PURPOSE: Server Actions for the lecturer's coursework screens: set an
//          assignment, and publish one to the students it was set for.
//          See actions/setup.ts for why mutations run server-side.
//
// AUTHORIZATION IS NOT DECIDED HERE.
//   POST /api/assignments and POST /api/assignments/[id]/publish each resolve
//   the caller from their session and apply facultyMaySetCoursework themselves.
//   Re-checking in an action would be a second, weaker opinion about the same
//   question — and it is the endpoint a client cannot skip, not this.
//
//   In particular nothing below sends a facultyId or a createdBy. The route
//   writes authorship from the session and reads the teaching load from the
//   same subject, so there is no claim about identity on this path for anything
//   to get wrong.
// ============================================================================

import type { FormValues } from "@/components/shared/EntityFormModal";
import { decodeCourseworkTarget } from "@/components/shared/assignmentFields";
import {
  createAssignment,
  publishAssignment,
  type CreateAssignmentInput,
} from "@/services/assignments";
import type { Assignment } from "@/types";
import type { ActionResult } from "./setup";

function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

function optionalStr(values: FormValues, key: string): string | undefined {
  const value = str(values, key);
  return value === "" ? undefined : value;
}

function num(values: FormValues, key: string, fallback: number): number {
  const raw = values[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? fallback : numeric;
}

/**
 * Set a new assignment.
 *
 * The class arrives as ONE encoded value carrying the course and, when the
 * lecturer chose a section, that section — see components/shared/
 * assignmentFields.ts for why the two are not separate fields.
 *
 * The two rules checked here are the ones the API answers with a bare
 * "Invalid input" whose `details` never reach the client, so a rejection would
 * otherwise land in a banner with nothing to point at. Both are re-applied
 * server-side; these are for the person typing, not for safety.
 */
export async function createAssignmentAction(values: FormValues): Promise<ActionResult> {
  const target = decodeCourseworkTarget(str(values, "target"));

  if (!target) {
    return {
      success: false,
      error: "Select the course or section this assignment is for.",
      code: "VALIDATION_ERROR",
      field: "target",
    };
  }

  const title = str(values, "title");

  if (title === "") {
    return {
      success: false,
      error: "Give the assignment a title.",
      code: "VALIDATION_ERROR",
      field: "title",
    };
  }

  const maxMarks = num(values, "maxMarks", 0);

  // createAssignmentSchema requires a positive integer. A blank or fractional
  // entry is caught here so the message lands on the field.
  if (!Number.isInteger(maxMarks) || maxMarks <= 0) {
    return {
      success: false,
      error: "Maximum marks must be a whole number above zero.",
      code: "VALIDATION_ERROR",
      field: "maxMarks",
    };
  }

  const input: CreateAssignmentInput = {
    ...target,
    title,
    description: optionalStr(values, "description"),
    type: (optionalStr(values, "type") as Assignment["type"]) ?? "HOMEWORK",
    maxMarks,
    dueDate: optionalStr(values, "dueDate"),
  };

  return createAssignment(input);
}

/**
 * Publish a draft assignment.
 *
 * Takes only the id — the transition is fixed and its target state is not the
 * caller's to choose, so there is nothing here for a client to dictate. The
 * route notifies the course's registered students after the transition commits.
 */
export async function publishAssignmentAction(id: string): Promise<ActionResult> {
  if (id.trim() === "") {
    return { success: false, error: "No assignment was named.", code: "VALIDATION_ERROR" };
  }

  return publishAssignment(id);
}

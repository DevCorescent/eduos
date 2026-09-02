"use server";

// ============================================================================
// MODULE : Actions — Examinations
// PURPOSE: Server Actions for the examination office: schedule an examination,
//          and issue hall tickets to its eligible cohort.
//          See actions/setup.ts for why mutations run server-side.
//
// AUTHORIZATION IS NOT DECIDED HERE.
//   Both endpoints resolve the caller from their session and apply
//   EXAMINATION_MANAGE_ROLES / the examination-office narrowing themselves.
//   Re-checking in an action would be a second, weaker opinion about the same
//   question, and it is the endpoint a client cannot skip.
// ============================================================================

import {
  allocateExaminationSeats,
  issueHallTickets,
  scheduleExamination,
  type ScheduleExaminationInput,
} from "@/services/examinations";
import type { ActionResult } from "./setup";

type FormValues = Record<string, unknown>;

function str(values: FormValues, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
}

function optional(values: FormValues, key: string): string | undefined {
  const value = str(values, key);
  return value === "" ? undefined : value;
}

function optionalNumber(values: FormValues, key: string): number | undefined {
  const value = str(values, key);
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Schedule an examination.
 *
 * The coherence rules the schema cannot express are caught here so the message
 * lands beside the field rather than as a rejected batch: an end before a
 * start, and a pass mark above the maximum. The API re-checks both — these are
 * for the person typing, not for safety.
 */
export async function scheduleExaminationAction(
  values: FormValues
): Promise<ActionResult> {
  const maxMarks = optionalNumber(values, "maxMarks");

  if (maxMarks === undefined || maxMarks <= 0) {
    return {
      success: false,
      error: "Maximum marks must be a positive number.",
      field: "maxMarks",
    };
  }

  const passMark = optionalNumber(values, "passMark");

  if (passMark !== undefined && passMark > maxMarks) {
    return {
      success: false,
      error: "The pass mark cannot exceed the maximum marks.",
      field: "passMark",
    };
  }

  const startTime = optional(values, "startTime");
  const endTime = optional(values, "endTime");

  if (startTime && endTime && endTime <= startTime) {
    return {
      success: false,
      error: "The end time must be after the start time.",
      field: "endTime",
    };
  }

  const input: ScheduleExaminationInput = {
    semesterId: str(values, "semesterId"),
    courseId: str(values, "courseId"),
    title: str(values, "title"),
    type: optional(values, "type"),
    date: optional(values, "date"),
    startTime,
    endTime,
    venue: optional(values, "venue"),
    maxMarks,
    passMark,
    duration: optionalNumber(values, "duration"),
    instructions: optional(values, "instructions"),
  };

  if (input.semesterId === "" || input.courseId === "" || input.title === "") {
    return {
      success: false,
      error: "Course, semester and title are required.",
      field: input.courseId === "" ? "courseId" : "title",
    };
  }

  return scheduleExamination(input);
}

/**
 * Issue hall tickets to the eligible cohort.
 *
 * Takes only the examination id. The cohort and the eligibility gate are both
 * server-side, so this action has no student to name and none to get wrong.
 */
export async function issueHallTicketsAction(
  examinationId: string
): Promise<ActionResult> {
  if (examinationId.trim() === "") {
    return { success: false, error: "No examination was named." };
  }

  return issueHallTickets(examinationId);
}

/**
 * Allocate seats to the issued hall tickets of one examination.
 *
 * Takes only the examination id, for the same reason issuing does: the plan is
 * derived server-side, so there is no seat assignment for this action to get
 * wrong or for a caller to dictate.
 */
export async function allocateSeatsAction(
  examinationId: string
): Promise<ActionResult> {
  if (examinationId.trim() === "") {
    return { success: false, error: "No examination was named." };
  }

  return allocateExaminationSeats(examinationId);
}

"use server";

// ============================================================================
// MODULE : Actions — Academic Calendar
// PURPOSE: Server Actions for academic years, semesters, batches and sections.
//          See actions/setup.ts for why these run on the server rather than in
//          the component, and for the live-mode cookie-forwarding gap.
// ============================================================================

import type { ApiResponse } from "@/types";
import {
  createAcademicYear,
  createBatch,
  createSection,
  createSemester,
  deleteAcademicYear,
  deleteBatch,
  deleteSection,
  deleteSemester,
  updateAcademicYear,
  updateBatch,
  type AcademicYearInput,
  type BatchInput,
  type SectionInput,
  type SemesterInput,
} from "@/services/calendar";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { ActionResult } from "./setup";

function withConflictField(result: ApiResponse<unknown>, field: string): ActionResult {
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field };
  }
  return result;
}

function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

function optionalNum(values: FormValues, key: string): number | undefined {
  const raw = values[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? undefined : numeric;
}

// --- Academic years ---------------------------------------------------------

export async function createAcademicYearAction(values: FormValues): Promise<ActionResult> {
  const input: AcademicYearInput = {
    name: str(values, "name"),
    startDate: str(values, "startDate"),
    endDate: str(values, "endDate"),
    isCurrent: Boolean(values.isCurrent),
  };

  // Caught here rather than at the database: an end before a start is a
  // coherence rule the schema does not express, and the API would accept it.
  if (Date.parse(input.endDate) <= Date.parse(input.startDate)) {
    return { success: false, error: "End date must be after the start date.", field: "endDate" };
  }

  // The name is the only unique column on AcademicYear.
  return withConflictField(await createAcademicYear(input), "name");
}

export async function updateAcademicYearAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<AcademicYearInput> = {
    name: str(values, "name"),
    startDate: str(values, "startDate"),
    endDate: str(values, "endDate"),
    isCurrent: Boolean(values.isCurrent),
  };

  if (
    input.startDate &&
    input.endDate &&
    Date.parse(input.endDate) <= Date.parse(input.startDate)
  ) {
    return { success: false, error: "End date must be after the start date.", field: "endDate" };
  }

  return withConflictField(await updateAcademicYear(id, input), "name");
}

/** "Set as current" — a one-field update, so it needs no form. */
export async function setCurrentAcademicYearAction(id: string): Promise<ActionResult> {
  return updateAcademicYear(id, { isCurrent: true });
}

export async function deleteAcademicYearAction(id: string): Promise<ActionResult> {
  return deleteAcademicYear(id);
}

// --- Semesters --------------------------------------------------------------

export async function createSemesterAction(
  academicYearId: string,
  values: FormValues
): Promise<ActionResult> {
  const input: SemesterInput = {
    name: str(values, "name"),
    semesterNumber: optionalNum(values, "semesterNumber") ?? 1,
    startDate: str(values, "startDate"),
    endDate: str(values, "endDate"),
    isCurrent: Boolean(values.isCurrent),
  };

  if (Date.parse(input.endDate) <= Date.parse(input.startDate)) {
    return { success: false, error: "End date must be after the start date.", field: "endDate" };
  }

  // @@unique([academicYearId, semesterNumber]) — the clash is on the number.
  return withConflictField(await createSemester(academicYearId, input), "semesterNumber");
}

export async function deleteSemesterAction(id: string): Promise<ActionResult> {
  return deleteSemester(id);
}

// --- Batches ----------------------------------------------------------------

export async function createBatchAction(values: FormValues): Promise<ActionResult> {
  const input: BatchInput = {
    programmeId: str(values, "programmeId"),
    academicYearId: str(values, "academicYearId"),
    name: str(values, "name"),
    code: str(values, "code"),
    maxStrength: optionalNum(values, "maxStrength"),
  };
  return withConflictField(await createBatch(input), "code");
}

export async function updateBatchAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<BatchInput> = {
    programmeId: str(values, "programmeId"),
    academicYearId: str(values, "academicYearId"),
    name: str(values, "name"),
    code: str(values, "code"),
    maxStrength: optionalNum(values, "maxStrength"),
  };
  return withConflictField(await updateBatch(id, input), "code");
}

export async function deleteBatchAction(id: string): Promise<ActionResult> {
  return deleteBatch(id);
}

// --- Sections ---------------------------------------------------------------

export async function createSectionAction(
  batchId: string,
  values: FormValues
): Promise<ActionResult> {
  const input: SectionInput = {
    semesterId: str(values, "semesterId"),
    name: str(values, "name"),
    maxStrength: optionalNum(values, "maxStrength"),
  };
  // @@unique([batchId, semesterId, name]) — reported against the name.
  return withConflictField(await createSection(batchId, input), "name");
}

export async function deleteSectionAction(id: string): Promise<ActionResult> {
  return deleteSection(id);
}

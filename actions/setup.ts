"use server";

// ============================================================================
// MODULE : Actions — Academic Setup
// PURPOSE: Server Actions for every create, update and delete on the setup tree.
//
//          These run on the server because the session is an httpOnly cookie:
//          a mutation issued from the server keeps that credential out of
//          client JavaScript entirely.
//
//          A server-side fetch inherits neither the browser's cookie jar nor
//          the request's host, and `credentials: "include"` is a browser-only
//          concept — so services/client.ts reads both from next/headers and
//          attaches them by hand. Without the host the backend resolves no
//          tenant and answers 404; without the cookie it answers 401.
// ============================================================================

import type { ApiResponse } from "@/types";
import {
  createCampus,
  createDepartment,
  createProgramme,
  createSchool,
  createSpecialisation,
  deleteCampus,
  deleteDepartment,
  deleteProgramme,
  deleteSchool,
  updateCampus,
  updateDepartment,
  updateProgramme,
  updateSchool,
  type CampusInput,
  type DepartmentInput,
  type ProgrammeInput,
  type SchoolInput,
  type SpecialisationInput,
} from "@/services/setup";
import type { FormValues } from "@/components/shared/EntityFormModal";

/**
 * A failure envelope carrying the field a conflict belongs to.
 *
 * The API reports a duplicate code as a bare 409 with no indication of which
 * column collided. Every uniqueness constraint on these entities is on `code`,
 * so the action names it — that is what lets EntityFormModal put the message on
 * the input the user must change rather than in a banner above the form.
 */
export type ActionResult = ApiResponse<unknown> & { field?: string };

/** Attach `field: "code"` to a conflict, leave every other failure alone. */
function withConflictField(result: ApiResponse<unknown>, field = "code"): ActionResult {
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field };
  }
  return result;
}

/** Read a required string out of the flat form payload. */
function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

/** Read an optional string; empty becomes undefined so the column defaults. */
function optionalStr(values: FormValues, key: string): string | undefined {
  const value = str(values, key);
  return value === "" ? undefined : value;
}

/** Read an optional number; empty or unparseable becomes undefined. */
function optionalNum(values: FormValues, key: string): number | undefined {
  const raw = values[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? undefined : numeric;
}

// --- Campuses ---------------------------------------------------------------

export async function createCampusAction(values: FormValues): Promise<ActionResult> {
  const input: CampusInput = {
    name: str(values, "name"),
    code: str(values, "code"),
    phone: optionalStr(values, "phone"),
    email: optionalStr(values, "email"),
    isMain: Boolean(values.isMain),
  };
  return withConflictField(await createCampus(input));
}

export async function updateCampusAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<CampusInput> = {
    name: str(values, "name"),
    code: str(values, "code"),
    phone: optionalStr(values, "phone"),
    email: optionalStr(values, "email"),
    isMain: Boolean(values.isMain),
  };
  return withConflictField(await updateCampus(id, input));
}

export async function deleteCampusAction(id: string): Promise<ActionResult> {
  return deleteCampus(id);
}

// --- Schools ----------------------------------------------------------------

export async function createSchoolAction(values: FormValues): Promise<ActionResult> {
  const input: SchoolInput = {
    campusId: str(values, "campusId"),
    name: str(values, "name"),
    code: str(values, "code"),
    deanName: optionalStr(values, "deanName"),
    email: optionalStr(values, "email"),
  };
  return withConflictField(await createSchool(input));
}

export async function updateSchoolAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<SchoolInput> = {
    campusId: str(values, "campusId"),
    name: str(values, "name"),
    code: str(values, "code"),
    deanName: optionalStr(values, "deanName"),
    email: optionalStr(values, "email"),
  };
  return withConflictField(await updateSchool(id, input));
}

export async function deleteSchoolAction(id: string): Promise<ActionResult> {
  return deleteSchool(id);
}

// --- Departments ------------------------------------------------------------

export async function createDepartmentAction(values: FormValues): Promise<ActionResult> {
  const input: DepartmentInput = {
    campusId: str(values, "campusId"),
    schoolId: optionalStr(values, "schoolId"),
    name: str(values, "name"),
    code: str(values, "code"),
    hodName: optionalStr(values, "hodName"),
    // str, not optionalStr: "" is the picker's "no head" option and must reach
    // the API as an explicit clear. optionalStr would drop it, which on PATCH
    // means "leave unchanged" — and a head could then never be released, so no
    // head could ever move between departments (hodUserId is @unique).
    hodUserId: str(values, "hodUserId"),
    email: optionalStr(values, "email"),
  };
  return withConflictField(await createDepartment(input));
}

export async function updateDepartmentAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<DepartmentInput> = {
    campusId: str(values, "campusId"),
    // Passed as "" rather than omitted when cleared, so the service can tell
    // "unset the school" from "leave it unchanged".
    schoolId: str(values, "schoolId"),
    name: str(values, "name"),
    code: str(values, "code"),
    hodName: optionalStr(values, "hodName"),
    // See createDepartmentAction: "" clears the head rather than being dropped.
    hodUserId: str(values, "hodUserId"),
    email: optionalStr(values, "email"),
  };
  return withConflictField(await updateDepartment(id, input));
}

export async function deleteDepartmentAction(id: string): Promise<ActionResult> {
  return deleteDepartment(id);
}

// --- Programmes -------------------------------------------------------------

export async function createProgrammeAction(values: FormValues): Promise<ActionResult> {
  const input: ProgrammeInput = {
    departmentId: str(values, "departmentId"),
    name: str(values, "name"),
    code: str(values, "code"),
    type: (optionalStr(values, "type") as ProgrammeInput["type"]) ?? "UNDERGRADUATE",
    durationValue: optionalNum(values, "durationValue") ?? 1,
    durationUnit: (optionalStr(values, "durationUnit") as ProgrammeInput["durationUnit"]) ?? "YEARS",
    totalCredits: optionalNum(values, "totalCredits"),
    eligibility: optionalStr(values, "eligibility"),
    isActive: Boolean(values.isActive),
  };
  return withConflictField(await createProgramme(input));
}

export async function updateProgrammeAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<ProgrammeInput> = {
    departmentId: str(values, "departmentId"),
    name: str(values, "name"),
    code: str(values, "code"),
    type: optionalStr(values, "type") as ProgrammeInput["type"],
    durationValue: optionalNum(values, "durationValue"),
    durationUnit: optionalStr(values, "durationUnit") as ProgrammeInput["durationUnit"],
    totalCredits: optionalNum(values, "totalCredits"),
    eligibility: optionalStr(values, "eligibility"),
    isActive: Boolean(values.isActive),
  };
  return withConflictField(await updateProgramme(id, input));
}

export async function deleteProgrammeAction(id: string): Promise<ActionResult> {
  return deleteProgramme(id);
}

// --- Specialisations --------------------------------------------------------

export async function createSpecialisationAction(
  programmeId: string,
  values: FormValues
): Promise<ActionResult> {
  const input: SpecialisationInput = {
    name: str(values, "name"),
    code: str(values, "code"),
    isActive: Boolean(values.isActive),
  };
  return withConflictField(await createSpecialisation(programmeId, input));
}

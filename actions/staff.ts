"use server";

// ============================================================================
// MODULE : Actions — Faculty & Employees
// PURPOSE: Server Actions for staff records and teaching assignments.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import type { ApiResponse, Employee } from "@/types";
import {
  addEmployee,
  addFaculty,
  assignCourse,
  retireAssignment,
  updateEmployee,
  updateFaculty,
  type AddEmployeeInput,
  type AddFacultyInput,
  type AssignCourseInput,
  type UpdateEmployeeInput,
  type UpdateFacultyInput,
} from "@/services/faculty";
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
 * Adding staff has two uniqueness constraints — the employee ID and the email —
 * fixed in different inputs. A single banner would leave the user guessing.
 */
function routeConflict(result: ApiResponse<unknown>): ActionResult {
  if (result.success || result.code !== "CONFLICT") return result;

  const field = result.error.toLowerCase().includes("email") ? "email" : "employeeId";
  return { ...result, field };
}

// --- Faculty ----------------------------------------------------------------

export async function addFacultyAction(values: FormValues): Promise<ActionResult> {
  const password = str(values, "password");
  if (password.length < 8) {
    return { success: false, error: "Use at least 8 characters.", field: "password" };
  }

  const input: AddFacultyInput = {
    firstName: str(values, "firstName"),
    lastName: str(values, "lastName"),
    email: str(values, "email").toLowerCase(),
    password,
    phone: optionalStr(values, "phone"),
    employeeId: str(values, "employeeId"),
    departmentId: optionalStr(values, "departmentId"),
    designation: optionalStr(values, "designation"),
    qualification: optionalStr(values, "qualification"),
    specialization: optionalStr(values, "specialization"),
    experience: optionalNum(values, "experience"),
    joinDate: str(values, "joinDate"),
  };

  return routeConflict(await addFaculty(input));
}

export async function updateFacultyAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: UpdateFacultyInput = {
    employeeId: str(values, "employeeId"),
    // Passed as "" rather than omitted when cleared, so the service can tell
    // "unset this" from "leave unchanged" on a nullable column.
    departmentId: str(values, "departmentId"),
    designation: optionalStr(values, "designation"),
    qualification: optionalStr(values, "qualification"),
    specialization: optionalStr(values, "specialization"),
    experience: optionalNum(values, "experience"),
    status: optionalStr(values, "status") as UpdateFacultyInput["status"],
  };

  return routeConflict(await updateFaculty(id, input));
}

// --- Employees --------------------------------------------------------------

export async function addEmployeeAction(values: FormValues): Promise<ActionResult> {
  const password = str(values, "password");
  if (password.length < 8) {
    return { success: false, error: "Use at least 8 characters.", field: "password" };
  }

  const input: AddEmployeeInput = {
    firstName: str(values, "firstName"),
    lastName: str(values, "lastName"),
    email: str(values, "email").toLowerCase(),
    password,
    phone: optionalStr(values, "phone"),
    employeeId: str(values, "employeeId"),
    departmentId: optionalStr(values, "departmentId"),
    designation: optionalStr(values, "designation"),
    type: optionalStr(values, "type") as Employee["type"] | undefined,
    joinDate: str(values, "joinDate"),
  };

  return routeConflict(await addEmployee(input));
}

export async function updateEmployeeAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: UpdateEmployeeInput = {
    employeeId: str(values, "employeeId"),
    departmentId: str(values, "departmentId"),
    designation: optionalStr(values, "designation"),
    type: optionalStr(values, "type") as UpdateEmployeeInput["type"],
    status: optionalStr(values, "status") as UpdateEmployeeInput["status"],
  };

  return routeConflict(await updateEmployee(id, input));
}

// --- Teaching assignments ---------------------------------------------------

export async function assignCourseAction(
  facultyId: string,
  values: FormValues
): Promise<ActionResult> {
  const input: AssignCourseInput = {
    courseId: str(values, "courseId"),
    sectionId: optionalStr(values, "sectionId"),
    semesterId: optionalStr(values, "semesterId"),
  };

  const result = await assignCourse(facultyId, input);
  // The clash is on the whole combination, but the course is what the user
  // changes to resolve it.
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field: "courseId" };
  }
  return result;
}

export async function retireAssignmentAction(id: string): Promise<ActionResult> {
  return retireAssignment(id);
}

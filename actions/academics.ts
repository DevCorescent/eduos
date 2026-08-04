"use server";

// ============================================================================
// MODULE : Actions — Courses, Curriculum & Attendance
// PURPOSE: Server Actions for the academic operations screens.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import type { ApiResponse, AttendanceStatus, Course } from "@/types";
import {
  addCurriculumSubject,
  markAttendance,
  removeCurriculumSubject,
  type AddSubjectInput,
  type MarkAttendanceEntry,
} from "@/services/academics";
import {
  createCourse,
  deleteCourse,
  updateCourse,
  type CourseInput,
} from "@/services/courses";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { ActionResult } from "./setup";

function withConflictField(result: ApiResponse<unknown>, field: string): ActionResult {
  if (!result.success && result.code === "CONFLICT") return { ...result, field };
  return result;
}

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

// --- Courses ----------------------------------------------------------------

export async function createCourseAction(values: FormValues): Promise<ActionResult> {
  const input: CourseInput = {
    name: str(values, "name"),
    code: str(values, "code").toUpperCase(),
    type: (optionalStr(values, "type") as Course["type"]) ?? "CORE",
    credits: num(values, "credits", 3),
    departmentId: optionalStr(values, "departmentId"),
    description: optionalStr(values, "description"),
    isActive: Boolean(values.isActive),
  };
  return withConflictField(await createCourse(input), "code");
}

export async function updateCourseAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<CourseInput> = {
    name: str(values, "name"),
    code: str(values, "code").toUpperCase(),
    type: optionalStr(values, "type") as Course["type"],
    credits: num(values, "credits", 3),
    departmentId: str(values, "departmentId"),
    description: optionalStr(values, "description"),
    isActive: Boolean(values.isActive),
  };
  return withConflictField(await updateCourse(id, input), "code");
}

export async function deleteCourseAction(id: string): Promise<ActionResult> {
  return deleteCourse(id);
}

// --- Curriculum -------------------------------------------------------------

export async function addCurriculumSubjectAction(
  curriculumId: string,
  values: FormValues
): Promise<ActionResult> {
  const input: AddSubjectInput = {
    courseId: str(values, "courseId"),
    semesterNumber: num(values, "semesterNumber", 1),
    credits: num(values, "credits", 3),
    isCompulsory: Boolean(values.isCompulsory),
  };
  return withConflictField(await addCurriculumSubject(curriculumId, input), "courseId");
}

export async function removeCurriculumSubjectAction(id: string): Promise<ActionResult> {
  return removeCurriculumSubject(id);
}

// --- Attendance -------------------------------------------------------------

/**
 * Save a register.
 *
 * Entries arrive as a plain array from the client rather than through
 * EntityFormModal — a register is a list of per-student toggles, not a set of
 * named fields, so the generic form has nothing to offer it.
 */
export async function markAttendanceAction(
  sectionId: string,
  courseId: string,
  date: string,
  entries: { studentId: string; status: AttendanceStatus }[]
): Promise<ActionResult> {
  if (entries.length === 0) {
    return { success: false, error: "No students to mark." };
  }
  return markAttendance(sectionId, courseId, date, entries as MarkAttendanceEntry[]);
}

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
  scheduleClass,
  updateTimetableSlot,
  type AddSubjectInput,
  type MarkAttendanceEntry,
  type ScheduleClassInput,
} from "@/services/academics";
import {
  createCourse,
  deleteCourse,
  updateCourse,
  type CourseInput,
} from "@/services/courses";
import type { FormValues } from "@/components/shared/EntityFormModal";
import { decodeTeachingOption } from "@/components/shared/scheduleClassFields";
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

export async function removeCurriculumSubjectAction(
  curriculumId: string,
  subjectId: string
): Promise<ActionResult> {
  return removeCurriculumSubject(curriculumId, subjectId);
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

// --- Class scheduling -------------------------------------------------------

/**
 * Attach the field a scheduling failure belongs to.
 *
 * A CONFLICT here is not a duplicate code — it is a double-booking, and the
 * field the user must change is the time. Putting it on `startTime` is what
 * makes EntityFormModal show the clash beside the period rather than as a
 * banner with no obvious remedy. The message itself is composed server-side and
 * already names what clashes and when, so it is passed through untouched.
 *
 * A 403 stays in the banner deliberately. "You are not assigned to teach this
 * course for this section" is not fixed by editing one input, and pinning it to
 * the course select would imply the course alone is wrong.
 */
function withScheduleField(result: ApiResponse<unknown>): ActionResult {
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field: "startTime" };
  }
  return result;
}

export async function scheduleClassAction(values: FormValues): Promise<ActionResult> {
  const input: ScheduleClassInput = {
    semesterId: str(values, "semesterId"),
    sectionId: str(values, "sectionId"),
    courseId: str(values, "courseId"),
    facultyId: str(values, "facultyId"),
    day: str(values, "day") as ScheduleClassInput["day"],
    startTime: str(values, "startTime"),
    endTime: str(values, "endTime"),
    roomNo: optionalStr(values, "roomNo"),
    sessionType: (optionalStr(values, "sessionType") as ScheduleClassInput["sessionType"]) ??
      "LECTURE",
  };
  return withScheduleField(await scheduleClass(input));
}

/**
 * Reschedule a class.
 *
 * roomNo is sent as `null` rather than omitted when the field is cleared. An
 * omitted key means "leave it alone" to the PATCH handler, so clearing a room
 * has to be expressed as an explicit null or the old room would silently
 * survive an edit that visibly removed it.
 *
 * isActive is NOT sent. Rescheduling and cancelling are separate actions with
 * separate notifications, and folding the flag into the edit form would let a
 * reschedule quietly cancel a class.
 */
export async function rescheduleClassAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const room = optionalStr(values, "roomNo");

  return withScheduleField(
    await updateTimetableSlot(id, {
      semesterId: str(values, "semesterId"),
      sectionId: str(values, "sectionId"),
      courseId: str(values, "courseId"),
      facultyId: str(values, "facultyId"),
      day: str(values, "day") as ScheduleClassInput["day"],
      startTime: str(values, "startTime"),
      endTime: str(values, "endTime"),
      roomNo: room ?? null,
      sessionType: (optionalStr(values, "sessionType") as ScheduleClassInput["sessionType"]) ??
        "LECTURE",
    })
  );
}

/**
 * Cancel a class.
 *
 * A soft cancel — `isActive: false` — never a DELETE. Attendance references
 * Timetable, so destroying the row would orphan every register already taken
 * against the slot, and the institution would lose its record that the class
 * was ever timetabled. The API notifies the affected students.
 */
export async function cancelClassAction(id: string): Promise<ActionResult> {
  return updateTimetableSlot(id, { isActive: false });
}

/**
 * Put a cancelled class back on the timetable.
 *
 * The conflict scan runs again on the way back in — the period may well have
 * been taken by something else while this slot was inactive — so this can fail
 * with a 409 where the cancel could not.
 */
export async function restoreClassAction(id: string): Promise<ActionResult> {
  return withScheduleField(await updateTimetableSlot(id, { isActive: true }));
}

// --- Class scheduling, faculty ----------------------------------------------

/**
 * Schedule a class as the signed-in lecturer.
 *
 * The (semester, section, course) triple arrives as ONE select value, because
 * those three are not independently choosable for this caller — see
 * components/shared/scheduleClassFields.ts.
 *
 * `facultyId` is bound server-side by the page from the caller's own resolved
 * FacultyMember row, never read from the submitted values. That keeps it out of
 * the client payload as a mutable value, exactly as row ids are bound elsewhere
 * in this project — and the API refuses a mismatch regardless, because
 * facultyMayScheduleClass compares the submitted id against the one it resolves
 * from the session.
 */
export async function scheduleMyClassAction(
  facultyId: string,
  values: FormValues
): Promise<ActionResult> {
  const teaching = decodeTeachingOption(str(values, "teaching"));

  if (!teaching) {
    return {
      success: false,
      error: "Select a class to schedule.",
      code: "VALIDATION_ERROR",
      field: "teaching",
    };
  }

  return withScheduleField(
    await scheduleClass({
      ...teaching,
      facultyId,
      day: str(values, "day") as ScheduleClassInput["day"],
      startTime: str(values, "startTime"),
      endTime: str(values, "endTime"),
      roomNo: optionalStr(values, "roomNo"),
      sessionType: (optionalStr(values, "sessionType") as ScheduleClassInput["sessionType"]) ??
        "LECTURE",
    })
  );
}

/**
 * Reschedule one of the signed-in lecturer's own classes.
 *
 * facultyId is deliberately NOT sent. An omitted key means "leave it alone" to
 * the PATCH handler, so the slot keeps the lecturer it already has — and since
 * the API refuses a faculty caller whose merged facultyId is not their own,
 * this cannot be used to take over a colleague's class or hand one away.
 */
export async function rescheduleMyClassAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const teaching = decodeTeachingOption(str(values, "teaching"));

  if (!teaching) {
    return {
      success: false,
      error: "Select a class to schedule.",
      code: "VALIDATION_ERROR",
      field: "teaching",
    };
  }

  const room = optionalStr(values, "roomNo");

  return withScheduleField(
    await updateTimetableSlot(id, {
      ...teaching,
      day: str(values, "day") as ScheduleClassInput["day"],
      startTime: str(values, "startTime"),
      endTime: str(values, "endTime"),
      roomNo: room ?? null,
      sessionType: (optionalStr(values, "sessionType") as ScheduleClassInput["sessionType"]) ??
        "LECTURE",
    })
  );
}

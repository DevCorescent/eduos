// ============================================================================
// MODULE : Services — Portal Identity
// PURPOSE: Resolves "who am I" for the student and faculty portals.
//
//          Every screen in those portals is scoped to one person's own record,
//          so each needs the Student or FacultyMember row behind the session —
//          not just the session. The JWT carries `sub` (a User id), and both
//          models link to User through a unique userId, so that is the join.
//
// MOCK GAP: the development session's `sub` is a synthetic id
//          (`mock-student@verify.edu`), not a real fixture user id, so the join
//          finds nothing. Rather than special-case every page, the fallback
//          below picks a demo record that actually has data behind it —
//          attendance, results, fees and certificates — so the portals are
//          reviewable. Signing in against a real backend resolves normally and
//          never reaches the fallback.
// ============================================================================

import "server-only";

import type { FacultyWithUser, StudentWithUser } from "@/types";
import { getPortalSession } from "./session";
import { USE_MOCKS } from "./config";
import { studentStore } from "@/mock/studentStore";
import { facultyStore } from "@/mock/staffStores";
import { ATTENDANCE_STUDENTS } from "@/mock/data/academics-ops";
import { MOCK_FACULTY_ASSIGNMENTS } from "@/mock/data/courses";

/**
 * The demo student the portal falls back to.
 *
 * Taken from the section attendance was generated for, so the attendance,
 * assignments and results screens all have rows. An arbitrary student would
 * render four empty states and look broken.
 */
function demoStudent(): StudentWithUser | undefined {
  const target = ATTENDANCE_STUDENTS[0];
  return target ? studentStore.find(target.id) : undefined;
}

/**
 * The demo lecturer the portal falls back to.
 *
 * Picked from the faculty who actually hold a teaching assignment, so the
 * schedule and grading screens have something to show.
 */
function demoFaculty(): FacultyWithUser | undefined {
  const facultyId = MOCK_FACULTY_ASSIGNMENTS[0]?.facultyId;
  return facultyId ? facultyStore.find(facultyId) : undefined;
}

/**
 * The signed-in student, or null.
 *
 * RETURNS null when there is no session, or when the session belongs to
 * somebody who is not a student — the portal layout redirects on that.
 */
export async function getCurrentStudent(): Promise<StudentWithUser | null> {
  const session = await getPortalSession();
  if (!session) return null;

  const byUserId = studentStore.all().find((student) => student.userId === session.sub);
  if (byUserId) return byUserId;

  return USE_MOCKS ? (demoStudent() ?? null) : null;
}

/** The signed-in lecturer, or null. Same contract as getCurrentStudent. */
export async function getCurrentFaculty(): Promise<FacultyWithUser | null> {
  const session = await getPortalSession();
  if (!session) return null;

  const byUserId = facultyStore.all().find((faculty) => faculty.userId === session.sub);
  if (byUserId) return byUserId;

  return USE_MOCKS ? (demoFaculty() ?? null) : null;
}

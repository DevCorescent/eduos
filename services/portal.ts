// ============================================================================
// MODULE : Services — Portal Identity
// PURPOSE: Resolves "who am I" for the student and faculty portals.
//
//          Every screen in those portals is scoped to one person's own record,
//          so each needs the Student or FacultyMember row behind the session —
//          not just the session. Both are resolved here against the live API,
//          and both return null rather than a stand-in when the backend cannot
//          answer: a portal that renders somebody else's data is worse than one
//          that says it could not identify you.
//
// WHY THE TWO HALVES LOOK NOTHING ALIKE
//   A STUDENT has a self-scoped endpoint — GET /api/student/profile resolves
//   the caller's own Student row from the session and needs no id. One request.
//
//   A FACULTY member now has one too: GET /api/faculty/me. It was added because
//   the only other route mapping a User to a FacultyMember is GET /api/faculty,
//   whose guard is requireRole("UNIVERSITY_ADMIN") — so a lecturer scanning it
//   received 403 and every screen in their own portal dead-ended before issuing
//   a second request. Both halves of this module are now one self-scoped call.
// ============================================================================

import "server-only";

import type { StudentProfileDto } from "@/lib/dto/studentProfile.dto";
import type { FacultyMember, StudentStatus, User } from "@/types";
import { getPortalSession } from "./session";
import { apiRequest } from "./client";
import { displayNameFromEmail } from "@/utils/user";

/**
 * The signed-in person as the portals consume them.
 *
 * Narrower than StudentWithUser on purpose: these are exactly the fields the
 * portal screens read, and every one of them is present in the profile
 * response. Widening it to the full Student row would mean claiming columns —
 * tenantId, createdAt — that the self-scoped endpoint does not return.
 */
export interface PortalStudent {
  id: string;
  enrollmentNo: string;
  currentSemester: number;
  admissionDate: string;
  status: StudentStatus;
  user: Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">;
  fullName: string;
}

export interface PortalFaculty extends FacultyMember {
  user: Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">;
  fullName: string;
}

/**
 * The signed-in student, or null.
 *
 * RETURNS null when there is no session, when the caller is not a student, or
 * when the profile endpoint fails — the portal layout redirects on that.
 *
 * @example
 * const student = await getCurrentStudent()
 * if (!student) redirect("/login")
 */
export async function getCurrentStudent(): Promise<PortalStudent | null> {
  const session = await getPortalSession();
  if (!session) return null;

  const result = await apiRequest<StudentProfileDto>("/api/student/profile");
  if (!result.success) return null;

  const { identity, academic } = result.data;

  return {
    id: identity.studentId,
    enrollmentNo: identity.enrollmentNo,
    currentSemester: academic.currentSemester,
    admissionDate: academic.admissionDate,
    status: identity.status,
    user: {
      // The profile endpoint identifies the student, not the User row behind
      // them, so the session's `sub` is the only honest source for this id.
      id: session.sub,
      firstName: identity.firstName,
      lastName: identity.lastName,
      email: identity.email,
      avatarUrl: identity.photo.url,
    },
    fullName:
      identity.displayName ?? `${identity.firstName} ${identity.lastName}`.trim(),
  };
}

/**
 * The signed-in lecturer, or null.
 *
 * One request to GET /api/faculty/me, the self-scoped route. It takes no id —
 * the caller is resolved from the session — so this cannot ask about anybody
 * else, and it is open to FACULTY, which the staff directory is not.
 *
 * RETURNS null when there is no session, when the caller holds no FacultyMember
 * row, or when the lookup fails. The portal layouts render their "couldn't
 * identify you" state on that rather than guessing at a record.
 */
export async function getCurrentFaculty(): Promise<PortalFaculty | null> {
  const session = await getPortalSession();
  if (!session) return null;

  const member = await apiRequest<FacultyMember>("/api/faculty/me");
  if (!member.success) return null;

  // The display name is derived from the session, NOT read from
  // GET /api/users/[id]. That route is requireRole("UNIVERSITY_ADMIN"), so a
  // lecturer asking for their own User row was answered 403 every single time —
  // a guaranteed-useless round trip that still cost a connection and roughly a
  // second, and whose failure branch produced this same fallback anyway.
  //
  // displayNameFromEmail is the project's existing answer to "name this person
  // from a session alone": topbarUserFromSession already labels the very same
  // user with it, so the greeting here and the chrome above it now agree
  // instead of disagreeing whenever the read failed.
  const name = displayNameFromEmail(session.email);

  return {
    ...member.data,
    user: {
      id: member.data.userId,
      firstName: name,
      lastName: "",
      email: session.email,
      avatarUrl: null,
    },
    fullName: name,
  };
}

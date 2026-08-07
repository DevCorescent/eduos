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
//   A FACULTY member has none. The only route that maps a User to a
//   FacultyMember is GET /api/faculty, and its guard is requireRole
//   ("UNIVERSITY_ADMIN") — a lecturer calling it receives 403. So the lookup
//   below succeeds for an administrator browsing the faculty portal and returns
//   null for the lecturer whose portal it is. That is a backend gap, recorded
//   here rather than papered over; closing it means a self-scoped faculty
//   endpoint, and this file is the only caller that would change.
// ============================================================================

import "server-only";

import type { StudentProfileDto } from "@/lib/dto/studentProfile.dto";
import type { FacultyMember, StudentStatus, User } from "@/types";
import { getPortalSession } from "./session";
import { apiList, apiRequest } from "./client";

/** The `limit` cap every collection endpoint enforces. */
const MAX_PAGE_SIZE = 100;

/**
 * How many pages of faculty the lookup below will walk before giving up.
 *
 * Bounded because the scan exists only as a fallback for a missing self-scoped
 * endpoint, and an unbounded loop over a large tenant would stall a page render
 * rather than fail it.
 */
const MAX_FACULTY_PAGES = 10;

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
 * Walks GET /api/faculty looking for the row whose userId matches the session.
 * See the module header for why there is no direct lookup, and why this returns
 * null for a caller holding only the FACULTY role.
 */
export async function getCurrentFaculty(): Promise<PortalFaculty | null> {
  const session = await getPortalSession();
  if (!session) return null;

  for (let page = 1; page <= MAX_FACULTY_PAGES; page++) {
    const result = await apiList<FacultyMember>("/api/faculty", "faculty", {
      page,
      limit: MAX_PAGE_SIZE,
    });

    // A 403 here is the expected outcome for a lecturer, not an anomaly. It is
    // reported as "not identified" rather than retried on the next page.
    if (!result.success) return null;

    const match = result.data.items.find((member) => member.userId === session.sub);
    if (match) {
      const user = await apiRequest<User>(`/api/users/${match.userId}`);

      return {
        ...match,
        user: user.success
          ? {
              id: user.data.id,
              firstName: user.data.firstName,
              lastName: user.data.lastName,
              email: user.data.email,
              avatarUrl: user.data.avatarUrl,
            }
          : {
              id: match.userId,
              firstName: "",
              lastName: "",
              email: session.email,
              avatarUrl: null,
            },
        fullName: user.success
          ? (user.data.displayName ??
            `${user.data.firstName} ${user.data.lastName}`.trim())
          : session.email,
      };
    }

    if (page >= result.data.pagination.totalPages) break;
  }

  return null;
}

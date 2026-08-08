// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Permission System (Phase 21)
// LAYER  : Constants
// PURPOSE: The permission matrix `GET /api/student/permissions` reports — the
//          exact CAN and CANNOT lists the README's Phase 21 declares, and
//          nothing else.
//
// THIS FILE DESCRIBES ACCESS. IT DOES NOT GRANT IT.
//   Nothing here is consulted by a route guard, and deliberately so. Access is
//   enforced where it has always been enforced: requireRole decides which roles
//   may reach a handler, requireTenant scopes every query to one university, and
//   the self-service modules (Phases 17, 18 and this one) resolve the caller to
//   their OWN row from session.sub rather than accepting an id.
//
//   Making this matrix load-bearing would create a second authorisation system
//   able to disagree with the first — a permission listed here as denied but
//   reachable through a route that never consults this file is strictly worse
//   than no matrix at all, because it reads like a guarantee. So the endpoint
//   is DESCRIPTIVE: it tells a client what a student may do, so a portal can
//   render the right navigation and hide the right buttons, and the server
//   refuses the rest regardless of what any client believed.
//
// WHY A CONSTANT AND NOT A TABLE
//   The README states the two lists literally and describes no university
//   editing them. A stored, per-tenant matrix would be configuration nothing
//   reads, free to drift from the guards that actually decide — and the drift
//   would be invisible. Stated once, in code, it cannot.
//
// ON "IF PERMITTED"
//   The README's final CAN entry reads "Update Limited Profile Information
//   (Profile Photo, Contact Details if permitted)". That clause implies a
//   toggle with no schema behind it anywhere in the project. Rather than invent
//   one, the two items are listed as permitted and each carries an explicit
//   `conditional: true` plus the note below, so a client can see that the
//   capability is qualified rather than absolute.
// ============================================================================

import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to read the matrix.
 *
 * STUDENT alone, matching the README's Phase 21 "Roles" section, which names
 * exactly one. This is deliberately NARROWER than STUDENT_PROFILE_ROLES: Phase
 * 18 admits UNIVERSITY_ADMIN at the role gate because an admin may themselves
 * be a student, but a matrix describing what students may do is not something
 * an administrator reads about themselves. An admin holding a Student row still
 * reaches it — they hold the STUDENT role too — which is the only case where
 * admitting them would have mattered.
 */
export const STUDENT_PERMISSION_ROLES = [ROLES.STUDENT] as const;

// --- The matrix -------------------------------------------------------------

/**
 * One capability a student holds.
 *
 * `key` is a stable machine identifier a portal switches on; `label` is the
 * README's own wording, preserved verbatim so the matrix and the specification
 * can be compared line by line without translation.
 */
export interface StudentCapability {
  readonly key: string;
  readonly label: string;
  /**
   * True when the README qualifies the capability rather than granting it
   * outright. Only the two "if permitted" items carry this.
   */
  readonly conditional?: true;
  /** Why it is qualified. Present exactly when `conditional` is. */
  readonly note?: string;
}

/**
 * What a student CAN do — the README's Phase 21 list, in its order.
 *
 * The order is the specification's and is not sorted, so a reviewer can read
 * this array against the README top to bottom.
 */
export const STUDENT_CAN = [
  { key: "VIEW_DASHBOARD", label: "View Dashboard" },
  { key: "VIEW_ATTENDANCE", label: "View Attendance" },
  { key: "VIEW_TIMETABLE", label: "View Timetable" },
  { key: "VIEW_RESULTS", label: "View Results" },
  { key: "VIEW_CERTIFICATES", label: "View Certificates" },
  { key: "VIEW_ASSIGNMENTS", label: "View Assignments" },
  { key: "SUBMIT_ASSIGNMENTS", label: "Submit Assignments" },
  { key: "DOWNLOAD_QUESTION_PAPERS", label: "Download Question Papers" },
  { key: "DOWNLOAD_SOLUTIONS", label: "Download Solutions" },
  { key: "VIEW_FEE_LEDGER", label: "View Fee Ledger" },
  { key: "DOWNLOAD_RECEIPTS", label: "Download Receipts" },
  { key: "FILL_OPEN_ELECTIVES", label: "Fill Open Electives" },
  { key: "SUBMIT_FACULTY_FEEDBACK", label: "Submit Faculty Feedback" },
  { key: "VIEW_NOTIFICATIONS", label: "View Notifications" },
  {
    key: "UPDATE_PROFILE_PHOTO",
    label: "Update Profile Photo",
    conditional: true,
    note: "The README qualifies this with 'if permitted'. No per-tenant setting exists in the schema, so no toggle is consulted.",
  },
  {
    key: "UPDATE_CONTACT_DETAILS",
    label: "Update Contact Details",
    conditional: true,
    note: "The README qualifies this with 'if permitted'. No per-tenant setting exists in the schema, so no toggle is consulted.",
  },
] as const satisfies readonly StudentCapability[];

/**
 * What a student CANNOT do — the README's Phase 21 list, in its order.
 *
 * Reported explicitly rather than left as "everything not above", because a
 * portal rendering a read-only view benefits from knowing which actions are
 * denied by policy as opposed to merely absent from this build.
 */
export const STUDENT_CANNOT = [
  { key: "MODIFY_ATTENDANCE", label: "Modify Attendance" },
  { key: "MODIFY_MARKS", label: "Modify Marks" },
  { key: "MODIFY_INTERNAL_ASSESSMENT", label: "Modify Internal Assessment" },
  { key: "MODIFY_TIMETABLE", label: "Modify Timetable" },
  { key: "MODIFY_FEES", label: "Modify Fees" },
  { key: "MODIFY_CURRICULUM", label: "Modify Curriculum" },
  { key: "MODIFY_FACULTY_INFORMATION", label: "Modify Faculty Information" },
] as const satisfies readonly StudentCapability[];

/** Every capability key a student holds. */
export type StudentPermissionKey = (typeof STUDENT_CAN)[number]["key"];

/** Every capability key a student is denied. */
export type StudentRestrictionKey = (typeof STUDENT_CANNOT)[number]["key"];

// --- Messages ---------------------------------------------------------------

export const STUDENT_PERMISSION_MESSAGE = {
  /**
   * Returned when the caller holds STUDENT but owns no Student row in this
   * tenant. Same wording and status as the Phase 18 profile module, so the two
   * self-service surfaces are indistinguishable from outside.
   */
  FORBIDDEN: "Forbidden",
} as const;

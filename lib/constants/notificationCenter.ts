// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Constants
// PURPOSE: The authorisation sets and the messages this module answers with.
//
// EVERY ROLE READS THEIR OWN NOTIFICATIONS
//   The README's Phase 27 names all seven roles. That is the whole point of a
//   notification centre — a bell that only administrators can open is not one.
//   This is also why Phase 13's GET /api/notifications had to be widened: it
//   was UNIVERSITY_ADMIN-only, so no student or faculty member could read even
//   their own notifications.
//
// ANNOUNCEMENTS ARE RESOLVED ON READ, NEVER FANNED OUT
//   Publishing does NOT write one Notification per recipient. A batch-wide
//   announcement in a large university would be tens of thousands of rows per
//   post; editing one would then have to find and rewrite all of them, and
//   deleting one would leave orphans. The audience is stored on the single row
//   and each caller's entitlement is resolved at query time.
// ============================================================================

import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Who may read and manage THEIR OWN notifications.
 *
 * All seven roles the README names. The confinement is by recipient, not by
 * role: every read filters on `userId = session.sub`, so admitting a role here
 * grants access to that person's own bell and to nothing else.
 */
export const NOTIFICATION_CENTER_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CAMPUS_ADMIN,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.FACULTY,
  ROLES.STUDENT,
  ROLES.PARENT,
] as const;

/** Who may read announcements. Everyone who can be addressed by one. */
export const ANNOUNCEMENT_READ_ROLES = NOTIFICATION_CENTER_ROLES;

/**
 * Who may create, edit and delete an announcement.
 *
 * FACULTY, STUDENT and PARENT are absent. An announcement is an institutional
 * communication addressed to a cohort; the README's "HOD Announcement" among
 * the faculty NOTIFICATIONS confirms the direction of travel — faculty receive
 * them, department heads and administrators write them.
 */
export const ANNOUNCEMENT_MANAGE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CAMPUS_ADMIN,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
] as const;

// --- Bounds -----------------------------------------------------------------

export const NOTIFICATION_MAX_LIMIT = 100;
export const NOTIFICATION_DEFAULT_LIMIT = 20;

/**
 * Notifications a single "mark all read" call will touch.
 *
 * Unbounded, deliberately: the operation is one UPDATE with a WHERE clause, and
 * an artificial cap would leave a user pressing the button repeatedly with no
 * indication of how many remained.
 */
export const MARK_ALL_READ_IS_UNBOUNDED = true;

// --- Messages ---------------------------------------------------------------

export const NOTIFICATION_MESSAGE = {
  NOT_FOUND: "Notification not found",
  ANNOUNCEMENT_NOT_FOUND: "Announcement not found",
  /**
   * Refusing an announcement whose audience and target do not agree.
   *
   * The schema cannot express "exactly one target column is set, and it is the
   * one `audience` names" — three nullable columns and an enum have no CHECK
   * constraint tying them together. The service enforces it and the model's own
   * comment records the gap.
   */
  AUDIENCE_TARGET_MISMATCH:
    "The announcement target does not match its audience",
  DEPARTMENT_NOT_FOUND: "Department not found",
  BATCH_NOT_FOUND: "Batch not found",
  SECTION_NOT_FOUND: "Section not found",
} as const;

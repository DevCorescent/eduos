// ============================================================================
// MODULE : Constants — Audit event catalogue (PRD §47)
// PURPOSE: The closed vocabulary of auditable actions and the resources they
//          act on, so an investigator can filter on a known set rather than
//          guessing which spelling a module happened to use.
//
// WHY A CATALOGUE AND NOT FREE STRINGS
//   AuditLog.action is a plain TEXT column, and the eleven modules that already
//   write to it each declare their own action names in their own constants
//   file. That was fine while audit was a per-module concern. It stops being
//   fine the moment there is ONE viewer over all of them: a filter offering
//   "ROLE_ASSIGNED" finds nothing if another module wrote "ASSIGN_ROLE", and
//   the reader concludes no role was ever assigned.
//
//   This file is the vocabulary for everything WP-2 adds. The existing eleven
//   are NOT retrofitted — rewriting action names already written to two
//   production rows and eleven modules' tests would change the meaning of
//   stored evidence, which is the one thing an audit system must never do.
//   Their names are listed under LEGACY_ACTIONS so the viewer can still offer
//   them, and the divergence is recorded in TECHNICAL_DEBT.md.
// ============================================================================

/**
 * Actions WP-2 records.
 *
 * Named subject-then-verb in the past tense: the log describes what happened,
 * not what was requested. Grouped by the PRD §47 line each satisfies.
 */
export const AUDIT_ACTIONS = {
  // §47 "Login logs"
  LOGIN_SUCCEEDED: "LOGIN_SUCCEEDED",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGGED_OUT: "LOGGED_OUT",

  // §47 "Role modification logs"
  ROLE_CREATED: "ROLE_CREATED",
  ROLE_UPDATED: "ROLE_UPDATED",
  ROLE_DELETED: "ROLE_DELETED",
  ROLE_ASSIGNED: "ROLE_ASSIGNED",
  ROLE_REVOKED: "ROLE_REVOKED",

  // §47 "Certificate generation logs"
  // PRD 13.2 attendance corrections. Three actions, not one: an investigator
  // asking "was this register changed" needs approval distinguished from a
  // request that was refused.
  ATTENDANCE_CORRECTION_REQUESTED: "ATTENDANCE_CORRECTION_REQUESTED",
  ATTENDANCE_CORRECTION_APPROVED: "ATTENDANCE_CORRECTION_APPROVED",
  ATTENDANCE_CORRECTION_REJECTED: "ATTENDANCE_CORRECTION_REJECTED",
  CERTIFICATE_ISSUED: "CERTIFICATE_ISSUED",
  CERTIFICATE_REVOKED: "CERTIFICATE_REVOKED",

  // PRD §9.3 "Generation audit log" — deferred by WP-1, delivered here.
  IDENTIFIER_ISSUED: "IDENTIFIER_ISSUED",
  IDENTIFIER_SEQUENCE_CREATED: "IDENTIFIER_SEQUENCE_CREATED",
  IDENTIFIER_SEQUENCE_UPDATED: "IDENTIFIER_SEQUENCE_UPDATED",

  // PRD §5.2 domains and §45 branding — WP-3
  DOMAIN_ADDED: "DOMAIN_ADDED",
  DOMAIN_UPDATED: "DOMAIN_UPDATED",
  DOMAIN_REMOVED: "DOMAIN_REMOVED",
  BRANDING_UPDATED: "BRANDING_UPDATED",

  // §47 "Data change logs" — W4. Publishing is the moment an institution's
  // PUBLIC statement changes, which is a different class of event from saving a
  // draft: only the publish is recorded, because only the publish is visible
  // outside the university.
  CMS_PAGE_PUBLISHED: "CMS_PAGE_PUBLISHED",
  CMS_PAGE_UNPUBLISHED: "CMS_PAGE_UNPUBLISHED",
  CMS_SITE_UPDATED: "CMS_SITE_UPDATED",

  // §47 "Login logs" — W1.4. A credential change belongs with the session
  // events rather than with data changes: what it alters is who can sign in,
  // and it is the event an investigator correlates a suspicious login against.
  // The entry records that a change happened and never what it changed to.
  PASSWORD_CHANGED: "PASSWORD_CHANGED",

  // §47 "Data change logs" — W1.6 bulk import (PRD §5.1 #14, §54).
  // One entry per IMPORT, not per row: the evidence an investigator needs is
  // that a bulk write happened, by whom, of what kind and how much. Recording
  // a row each would bury every other event in the tenant's trail.
  DATA_IMPORTED: "DATA_IMPORTED",

  // §47 "Data change logs" — W3 Admissions (PRD §8, §49.2).
  // Creation, material edits, every §49.2 stage transition, and the §8.5
  // conversion that turns an applicant into a student. Counts and ids only —
  // never a credential.
  APPLICATION_CREATED: "APPLICATION_CREATED",
  APPLICATION_UPDATED: "APPLICATION_UPDATED",
  APPLICATION_STAGE_CHANGED: "APPLICATION_STAGE_CHANGED",
  APPLICATION_CONVERTED: "APPLICATION_CONVERTED",

  // §47 "Data change logs" — identity records
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  STUDENT_CREATED: "STUDENT_CREATED",
  FACULTY_CREATED: "FACULTY_CREATED",
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** The resource an action acted on. Stored in AuditLog.resource. */
export const AUDIT_RESOURCES = {
  SESSION: "SESSION",
  // W4 — the public website. CMS_PAGE covers the landing page and its versions;
  // CMS_SITE is the header and footer around it.
  CMS_PAGE: "CMS_PAGE",
  CMS_SITE: "CMS_SITE",
  USER: "USER",
  ROLE: "ROLE",
  USER_ROLE: "USER_ROLE",
  STUDENT: "STUDENT",
  FACULTY: "FACULTY",
  EMPLOYEE: "EMPLOYEE",
  CERTIFICATE: "CERTIFICATE",
  ID_SEQUENCE: "ID_SEQUENCE",
  DOMAIN: "DOMAIN",
  TENANT: "TENANT",
  // W1.6 — the target of a bulk import. The imported ENTITY kind travels in the
  // entry's `after` snapshot; this names the act.
  DATA_IMPORT: "DATA_IMPORT",
  // W3 — the admission application a change acted on.
  APPLICATION: "APPLICATION",
  // PRD 13.2 — the correction request a decision acted on. The register itself
  // travels in the entry's before/after, which is what an attendance dispute
  // actually turns on.
  ATTENDANCE_CORRECTION: "ATTENDANCE_CORRECTION",
} as const;

export type AuditResource = (typeof AUDIT_RESOURCES)[keyof typeof AUDIT_RESOURCES];

/**
 * Action names the pre-WP-2 modules already wrote.
 *
 * Read from their own constants files at the time of writing and restated here
 * ONLY so the viewer's filter can offer them. Nothing generates these; they
 * exist in stored rows and must remain findable.
 */
export const LEGACY_ACTION_PREFIXES = [
  "ASSESSMENT_EVENT",
  "ATTENDANCE_LOCK",
  "ATTENDANCE_CORRECTION",
  "COURSE_REGISTRATION",
  "EVALUATION_COMPONENT",
  "EVALUATION_RULE",
  "EVALUATION_SCHEME",
  "EXAM_RESOURCE",
  "INTERNAL_ASSESSMENT",
  "OPEN_ELECTIVE",
  "PASSING_CRITERION",
  "STUDENT_COMPONENT_SCORE",
] as const;

/**
 * How many audit rows one page returns.
 *
 * Twenty matches every other collection in the project. An audit log is read by
 * filtering, not by scrolling — a larger page would move more sensitive data
 * over the wire for no benefit.
 */
export const AUDIT_PAGE_SIZE = 20;
export const AUDIT_MAX_PAGE_SIZE = 100;

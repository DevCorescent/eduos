// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Constants
// PURPOSE: The authorisation set and bounds the five finance-portal endpoints
//          need. No academic or financial policy lives here — pass/fail,
//          waiver rules and due-date logic all come from the fee structures
//          and demands already raised elsewhere; this module only reads them.
//
// SELF-SERVICE ONLY, AND WHY THAT IS NARROWER THAN THE RESULT MODULE
//   Phase 16's result endpoints carry a [studentId] path segment, so an
//   elevated caller (UNIVERSITY_ADMIN, CONTROLLER_OF_EXAMINATION, ...) can name
//   a student and a STUDENT is confined to their own id — an ANY/OWN split.
//   None of the five routes in README Phase 17 carry a [studentId] segment, so
//   there is no id for an elevated caller to name. Every caller — STUDENT and
//   UNIVERSITY_ADMIN alike — is resolved to the Student row THEY OWN, and reads
//   only that record. There is no ANY scope in this module.
//
//   UNIVERSITY_ADMIN is listed because README's own Phase 17 section lists it,
//   and it is honoured exactly as written: an admin account that also owns a
//   Student row (an admin who is themselves a student) reads it, on the same
//   terms. An admin account with no Student row is FORBIDDEN, per the existing
//   requireStudent()-style convention (result.service.ts) — the confinement
//   never degrades into an empty page for a caller who has no record.
//
// SUPER_ADMIN IS DELIBERATELY ABSENT
//   README's Phase 17 section does not list it, and it is never combined with
//   requireTenant anywhere in this codebase — the platform role's own tenantId
//   is the platform tenant, so it fails the tenant-ownership check requireTenant
//   enforces before a route body ever runs. Adding it would need a genuinely
//   new cross-tenant access pattern, which is out of scope for a read-only
//   phase that must not introduce new architecture.
// ============================================================================

import { ROLES } from "@/constants/roles";

/**
 * Roles permitted through the door of every finance-portal route.
 *
 * Passing this gate proves nothing about WHICH student a caller may read —
 * only the service, resolving the caller's own Student row, decides that.
 */
export const STUDENT_FINANCE_ROLES = [ROLES.STUDENT, ROLES.UNIVERSITY_ADMIN] as const;

export const STUDENT_FINANCE_MESSAGE = {
  /**
   * The caller holds a permitted role but owns no Student row in this tenant.
   * Forbidden, not an empty ledger — matches result.service.ts's requireStudent().
   */
  FORBIDDEN: "Forbidden",
  RECEIPT_NOT_FOUND: "Receipt not found",
} as const;
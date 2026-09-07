// ============================================================================
// MODULE : Auth — department-scoped WRITES
// LAYER  : Pure decision. No database, no request, no response.
// PURPOSE: Decide which department a scoped caller may write into, and whether
//          a particular row is theirs to change.
//
// WHY THIS EXISTS — tester issues #49 and #50
//   The confirmed product decision lets a head of department create and edit
//   faculty and courses. A role list alone cannot express that: it says yes or
//   no, so admitting a head would grant tenant-wide writes — editing another
//   department's professor, retitling a course they do not own.
//
//   The listings already narrow a head by direct equality on `departmentId`.
//   These two functions state the WRITE half of the same rule, once, so the
//   four handlers that need it cannot drift apart. Four copies of an
//   authorization check is how one of them ends up missing.
//
// THE TWO QUESTIONS A WRITE ASKS
//   CREATE — which department does this new row belong to?
//   EDIT   — is the row I am about to change mine, and will it still be mine
//            afterwards?
//
//   The second half of the edit question is the one that is easy to forget: a
//   head who may edit their own department's course must not be able to set its
//   departmentId to another department and hand it away — or, worse, pull
//   another department's row INTO their own scope and then edit it freely.
//
// NOTHING HERE READS THE REQUEST
//   The scope is resolved from the authenticated session by
//   resolveDepartmentScope. The only client value these functions see is the
//   departmentId a body asked for, and they exist precisely to refuse it when
//   it disagrees with the caller's own department.
// ============================================================================

import type { DepartmentScope } from "@/lib/auth/departmentScope";

/** Either the department to write, or the reason the caller may not. */
export type DepartmentWriteDecision =
  | { allowed: true; departmentId: string | null }
  | { allowed: false; reason: string };

/**
 * Which department a new row belongs to.
 *
 * UNRESTRICTED (an administrator) — whatever the body asked for, including
 * nothing. Their authority is tenant-wide and the route's own reference check
 * proves the department is in their tenant.
 *
 * RESTRICTED (a head) — their own department, always. A body naming a different
 * one is REFUSED rather than silently rewritten: both are safe, because the
 * returned value is what gets written either way, but quietly substituting
 * would tell the caller their request succeeded as sent and leave the record
 * somewhere they did not choose.
 *
 * A body naming NO department is not an error for a head — it is the ordinary
 * case, and their own department is supplied. A head must not be able to create
 * an unowned row: an unowned course belongs to the university and is invisible
 * to every head, so authoring one would mean writing a record the author cannot
 * afterwards read.
 */
export function departmentForCreate(
  scope: DepartmentScope,
  requested: string | null | undefined
): DepartmentWriteDecision {
  if (!scope.restricted) {
    return { allowed: true, departmentId: requested ?? null };
  }

  if (requested != null && requested !== scope.departmentId) {
    return {
      allowed: false,
      reason: "You can only create records in your own department.",
    };
  }

  return { allowed: true, departmentId: scope.departmentId };
}

/**
 * May this caller change a row that currently sits in `current`, and move it to
 * `requested`?
 *
 * UNRESTRICTED — yes, to anywhere in their tenant.
 *
 * RESTRICTED — the row must ALREADY be theirs, and must STILL be theirs
 * afterwards. Both halves are required:
 *
 *   current !== theirs   → the row is not theirs to touch at all.
 *   requested !== theirs → they would be moving it out of their scope, or
 *                          claiming another department's row by setting its
 *                          department to their own.
 *
 * A NULL `current` is not theirs. An unowned faculty member or course belongs
 * to the university; "nobody has claimed it" must not read as "anybody may",
 * which is the same reading resolveDepartmentScope applies to a head with no
 * department and the listings apply to a null departmentId.
 *
 * `requested` being undefined means the body did not mention the column, so the
 * row keeps the department it has — which, having passed the first check, is
 * already theirs.
 */
export function canWriteDepartmentRow(
  scope: DepartmentScope,
  current: string | null,
  requested?: string | null
): DepartmentWriteDecision {
  if (!scope.restricted) {
    return { allowed: true, departmentId: requested === undefined ? current : requested };
  }

  if (current !== scope.departmentId) {
    return { allowed: false, reason: "This record belongs to another department." };
  }

  if (requested !== undefined && requested !== scope.departmentId) {
    return {
      allowed: false,
      reason: "You cannot move a record out of your own department.",
    };
  }

  return { allowed: true, departmentId: scope.departmentId };
}

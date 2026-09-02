// ============================================================================
// MODULE : Domain — what counts as "attended"
// LAYER  : Domain. PURE — no database, no headers, no environment.
// PURPOSE: Answer one question, once: did this session count toward the
//          student's attendance for the purpose of the attendance FLOOR?
//
// WHY THIS FILE EXISTS
//   Four modules independently decided what "attended" means and they did not
//   agree, each with a comment explaining its own reasoning:
//
//     lib/services/hallTicket.service.ts        PRESENT · LATE · EXCUSED
//     services/academics.ts (report)            PRESENT · LATE · EXCUSED
//     lib/services/attendanceAnalytics.service  PRESENT · LATE
//     lib/controllers/notificationEmitter       PRESENT · LATE
//
//   All four answer the SAME question — is this student below the attendance
//   floor — so the disagreement is not a difference of purpose, it is a
//   contradiction. A student with authorised absences was issued a hall ticket
//   as eligible while the dashboard flagged them short and the system sent them
//   an "Attendance Below 75%" warning. Both statements were produced by this
//   codebase, about the same student, at the same moment.
//
// WHY EXCUSED COUNTS AS ATTENDED
//   EXCUSED is how this schema records an AUTHORISED absence — the exemption a
//   university grants for illness, bereavement, or representing the institution.
//   The whole reason the status exists as something other than ABSENT is that it
//   is not held against the student. Counting it against them at the floor makes
//   the status decorative and detains exactly the students the exemption was
//   granted to protect. That is the reading hall-ticket eligibility already
//   documents, and eligibility is the decision the attendance floor exists to
//   make, so it is the one the rest now follows.
//
// WHAT THIS DELIBERATELY DOES NOT GOVERN
//   Two other modules count PRESENT · LATE only, and they are RIGHT to, because
//   they ask a different question:
//
//     lib/repositories/internalAssessment.repository.ts — the attendance MARKS
//       component. "How much credit did this student earn by being in the room"
//       is not "may this student sit the exam"; an excused student earns no
//       participation credit for a class they did not attend.
//     lib/domain/faculty-analytics/metrics.ts — a TEACHING metric describing who
//       was in the lecturer's room.
//
//   Neither is an eligibility or shortage decision, so neither imports this.
//   The distinction is recorded here so a future reader does not "unify" them
//   into agreement and silently change students' marks.
// ============================================================================

/**
 * The four attendance states, as the schema spells them.
 *
 * Declared structurally rather than imported from the generated Prisma client:
 * this module must stay pure and importable by a test with no database, and the
 * generated client is not present until `prisma generate` has run.
 */
export type AttendanceStatusName = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

/**
 * Did this session count toward the student's attendance?
 *
 * Everything except ABSENT. Expressed as an exclusion rather than a list of
 * three, so a fifth status added to the enum later fails towards counting —
 * a new status that should NOT count has to be added here deliberately, which
 * is a decision someone makes, rather than silently dropping a student below
 * the floor the day the enum grows.
 */
export function isAttended(status: AttendanceStatusName | string): boolean {
  return status !== "ABSENT";
}

/**
 * Split a tally of statuses into sessions held and sessions attended.
 *
 * Held counts EVERY session, EXCUSED included: an authorised absence is still a
 * class that took place, and dropping it from the denominator would quietly
 * improve the student's rate rather than forgive the absence. Forgiving it and
 * erasing it are different things, and only the first is intended.
 */
export function tallyAttendance(
  rows: readonly { readonly status: AttendanceStatusName | string; readonly count?: number }[]
): { held: number; attended: number } {
  let held = 0;
  let attended = 0;

  for (const row of rows) {
    const count = row.count ?? 1;
    held += count;
    if (isAttended(row.status)) attended += count;
  }

  return { held, attended };
}

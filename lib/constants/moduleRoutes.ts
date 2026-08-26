// ============================================================================
// OWNER  : Gauransh
// MODULE : Constants — Module → area mapping (GAP-01 enforcement)
// SOURCE : PRD §57 module catalogue (lib/constants/modules.ts) mapped onto the
//          University Administration navigation this product actually ships.
// PURPOSE: State, in ONE place, which parts of the university console a module
//          switch governs — so `requireModule` and the navigation filter can
//          never disagree about what "Courses is disabled" means.
//
// WHY THIS FILE EXISTS SEPARATELY FROM modules.ts
//   modules.ts is the catalogue: which modules the PRD names. It says nothing
//   about what disabling one does, and deliberately so — the PRD does not
//   define it. This file is that missing half, recorded explicitly rather than
//   scattered through route handlers, so the decision is reviewable in one
//   place and changing it is one edit.
//
// THE MAPPING IS DELIBERATELY PARTIAL, AND THAT IS A DECISION NOT AN OMISSION
//   Of the 21 toggleable modules, ELEVEN have no screen and no endpoint in this
//   product at all — research, alumni, hostel, transport, inventory,
//   procurement, library, placements, support, analytics and learning. A switch
//   for them governs nothing because there is nothing to govern; they are
//   absent below rather than mapped to an invented route.
//
//   Nine map unambiguously and are enforced. The remaining console areas —
//   Setup, Academic Calendar, Timetable, Attendance, Open Electives, Users &
//   Roles, Audit Trail and Feedback — correspond to NO module key in §57's
//   list. Rather than assign each to a "nearest" module (twelve authorization
//   decisions the PRD never made, any of which could lock a university out of
//   its own configuration), they are treated the way `dashboard` and `settings`
//   already are: always available. A university cannot be left unable to define
//   its own campuses or read its own audit trail because of a module switch
//   that was never meant to reach them.
//
// ALWAYS-ON IS NOT "UNGUARDED"
//   Everything below still passes requireRole and requireTenant exactly as it
//   did. Module gating is an ADDITIONAL layer on top of them, never a
//   replacement, and it never widens access.
// ============================================================================

/**
 * One governed area of the console.
 *
 * `modules` is a SET and access needs ANY of them, which matters for exactly
 * one case today: /finance carries both `fees` (§23) and `finance` (§24). §57
 * gives this product a single Finance destination covering both sections, so
 * enabling either opens it. Requiring both would make a switch that reads as
 * "Fees: on" do nothing.
 */
export interface ModuleAreaRule {
  /** Path prefix. Matches the path itself and everything beneath it. */
  readonly prefix: string;
  /** Any ONE of these modules opens the area. */
  readonly modules: readonly string[];
  /**
   * Paths beneath `prefix` that this rule does NOT govern.
   *
   * Used where an admin collection and a portal's own self-service read share a
   * prefix: /api/faculty is the university's faculty directory, but
   * /api/faculty/me is how a lecturer reads their own record. Gating the second
   * on the university's `faculty` module would take the Faculty portal away
   * from its own user, which is not what a module switch means and is outside
   * this change.
   */
  readonly except?: readonly string[];
}

/** Page routes governed by a module. */
export const MODULE_PAGE_RULES: readonly ModuleAreaRule[] = [
  { prefix: "/admissions", modules: ["admissions"] },
  { prefix: "/students", modules: ["students"] },
  { prefix: "/faculty", modules: ["faculty"] },
  { prefix: "/employees", modules: ["employees"] },
  { prefix: "/curriculum", modules: ["academics"] },
  { prefix: "/evaluation", modules: ["examinations"] },
  { prefix: "/certificates", modules: ["certificates"] },
  { prefix: "/finance", modules: ["fees", "finance"] },
  { prefix: "/website", modules: ["websiteCms"] },
] as const;

/**
 * API routes governed by a module.
 *
 * Scoped to the university-administration surface. The student, faculty and
 * parent portals read their own records through their own endpoints
 * (/api/student/*, /api/faculty/me, /api/parent/*) and are not governed here —
 * §57's catalogue is the University Administration navigation, and a lecturer
 * losing their own timetable because a university switched off its staff
 * directory would be a different product decision from the one being made.
 */
export const MODULE_API_RULES: readonly ModuleAreaRule[] = [
  { prefix: "/api/admissions", modules: ["admissions"] },
  // /api/students/me is the STUDENT portal reading its own exam resources, not
  // the university's student directory. Excluded for the same reason
  // /api/faculty/me is: a module switch governs the administration console, and
  // taking a student's own records away is a different decision.
  { prefix: "/api/students", modules: ["students"], except: ["/api/students/me"] },
  { prefix: "/api/faculty", modules: ["faculty"], except: ["/api/faculty/me"] },
  { prefix: "/api/employees", modules: ["employees"] },
  { prefix: "/api/courses", modules: ["academics"] },
  { prefix: "/api/curricula", modules: ["academics"] },
  { prefix: "/api/examinations", modules: ["examinations"] },
  { prefix: "/api/evaluation-schemes", modules: ["examinations"] },
  { prefix: "/api/assessment-events", modules: ["examinations"] },
  { prefix: "/api/certificates", modules: ["certificates"], except: ["/api/certificates/verify"] },
  { prefix: "/api/certificate-templates", modules: ["certificates"] },
  { prefix: "/api/fee-demands", modules: ["fees", "finance"] },
  { prefix: "/api/fee-structures", modules: ["fees", "finance"] },
  // /api/fees/* is NOT listed. Every route beneath it — pending, history,
  // receipts, receipt, download — is a student reading their own fees
  // (ACCESS: STUDENT_FINANCE_ROLES, self-service). The university's fee
  // administration is /api/fee-demands and /api/fee-structures above, and those
  // are governed.
  { prefix: "/api/tenant/cms", modules: ["websiteCms"] },
] as const;

/** True when `path` is `prefix` or sits beneath it — never a bare substring. */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The rule governing `path`, or null when nothing governs it.
 *
 * Null means always-on: the caller applies no module check and the area behaves
 * exactly as it did before this file existed. The longest matching prefix wins,
 * so a more specific rule can be added later without reordering the list.
 */
export function ruleForPath(
  path: string,
  rules: readonly ModuleAreaRule[]
): ModuleAreaRule | null {
  let match: ModuleAreaRule | null = null;

  for (const rule of rules) {
    if (!underPrefix(path, rule.prefix)) continue;
    if (rule.except?.some((exception) => underPrefix(path, exception))) continue;
    if (!match || rule.prefix.length > match.prefix.length) match = rule;
  }

  return match;
}

/**
 * May a tenant holding `enabled` reach `path`?
 *
 * An ungoverned path is always reachable. A governed one needs any one of its
 * modules. `enabled` is the tenant's resolved set — see
 * lib/services/tenantModules.ts, which is the only thing that decides what
 * "enabled" means.
 */
export function pathAllowed(
  path: string,
  enabled: ReadonlySet<string>,
  rules: readonly ModuleAreaRule[]
): boolean {
  const rule = ruleForPath(path, rules);
  return rule === null || rule.modules.some((module) => enabled.has(module));
}

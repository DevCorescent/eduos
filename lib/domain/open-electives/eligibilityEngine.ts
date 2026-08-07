// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Electives — Eligibility
// LAYER  : Domain (pure)
// PURPOSE: Decide whether one student may take one offering.
//
// PURITY
//   No Prisma client, no HTTP, no repository, no service, no DTO. Every input
//   arrives as plain data and the answer is a value. The enum imports below
//   come from the generated `enums` module, which is nothing but frozen const
//   objects — the same precedent Phase 16's result engine set, and for the same
//   reason: a domain copy of a vocabulary the database owns would drift the
//   moment a member was added.
//
// THE RULE, STATED ONCE
//   An offering's eligibility is a set of ALLOW rules, OR-ed together. A rule
//   matches when EVERY narrowing column it declares matches the student; a null
//   column means "any" and narrows nothing.
//
//   ABSENCE OF RULES MEANS UNRESTRICTED. That is the single most consequential
//   line in this file: an offering with no rules is open to the whole
//   university, not closed to it. The opposite reading would silently bar every
//   student from every offering a department had not yet configured, and the
//   failure would look like a working system with no takers.
//
// WHY REASONS ARE COMPUTED, NOT JUST A BOOLEAN
//   "You are not eligible" is unactionable. A student refused because of their
//   branch can ask their advisor; a student refused because of their semester
//   can wait. The reasons are derived from the rules that came CLOSEST to
//   matching, so the message names the dimension that actually blocked them.
//
// COMPLEXITY
//   O(r) in the rules for one student — a handful — with no allocation beyond
//   the reason strings. Evaluated once per (student, offering) pair.
// ============================================================================

/** What the engine needs to know about a student. */
export interface StudentEligibilityProfile {
  readonly studentId: string;
  /** Null for a student not yet assigned to a programme. */
  readonly programmeId: string | null;
  /** The student's branch. Null when they have none. */
  readonly specialisationId: string | null;
  /** Their position in the degree, compared against a rule's semesterNumber. */
  readonly currentSemester: number;
}

/**
 * One ALLOW rule. Every null means "any".
 *
 * Deliberately structural rather than the repository's row type: the engine
 * depends on the three columns it reads, not on a projection that may grow.
 */
export interface EligibilityRule {
  readonly programmeId: string | null;
  readonly specialisationId: string | null;
  readonly semesterNumber: number | null;
}

/** The dimensions a rule can narrow on. */
export const ELIGIBILITY_DIMENSION = {
  PROGRAMME: "PROGRAMME",
  SPECIALISATION: "SPECIALISATION",
  SEMESTER: "SEMESTER",
} as const;

export type EligibilityDimension =
  (typeof ELIGIBILITY_DIMENSION)[keyof typeof ELIGIBILITY_DIMENSION];

/** Human-readable, stable reasons. Stable because a client may match on them. */
export const ELIGIBILITY_REASON: Readonly<Record<EligibilityDimension, string>> = {
  PROGRAMME: "This elective is not open to your programme",
  SPECIALISATION: "This elective is not open to your branch",
  SEMESTER: "This elective is not open to your semester",
};

/** Whether a student may take an offering, and why not when they may not. */
export interface EligibilityVerdict {
  readonly isEligible: boolean;
  /** Empty when eligible. Never empty when not. */
  readonly reasons: readonly string[];
  /** Which dimensions blocked them — for a client that renders its own copy. */
  readonly failedDimensions: readonly EligibilityDimension[];
}

/** Which dimensions of one rule the student fails. Empty means the rule matches. */
function mismatchesOf(
  profile: StudentEligibilityProfile,
  rule: EligibilityRule
): readonly EligibilityDimension[] {
  const failed: EligibilityDimension[] = [];

  // A null on the rule narrows nothing. A null on the STUDENT cannot satisfy a
  // rule that does narrow — an unassigned student is not "any programme", they
  // are a student whose programme is unknown, and admitting them to a
  // programme-restricted elective would be a guess.
  if (rule.programmeId !== null && rule.programmeId !== profile.programmeId) {
    failed.push(ELIGIBILITY_DIMENSION.PROGRAMME);
  }

  if (
    rule.specialisationId !== null &&
    rule.specialisationId !== profile.specialisationId
  ) {
    failed.push(ELIGIBILITY_DIMENSION.SPECIALISATION);
  }

  if (rule.semesterNumber !== null && rule.semesterNumber !== profile.currentSemester) {
    failed.push(ELIGIBILITY_DIMENSION.SEMESTER);
  }

  return failed;
}

/**
 * Decide whether a student satisfies an offering's rules.
 *
 * Rules are OR-ed: satisfying ANY ONE of them admits the student, which is what
 * makes "open to CSE, and to ECE semester 5" expressible as two rows.
 *
 * When none matches, the reported reasons come from the rule with the FEWEST
 * mismatches — the one the student came closest to satisfying. Reporting every
 * mismatch of every rule would tell a CSE student in semester 5 that they
 * failed on programme, branch AND semester, which is true of some rule and
 * useless as advice.
 *
 * COMPLEXITY : O(r), one pass over the rules.
 */
export function evaluateEligibility(
  profile: StudentEligibilityProfile,
  rules: readonly EligibilityRule[]
): EligibilityVerdict {
  // Absence of rules means unrestricted. See the file header — this is the
  // line, and it is deliberate.
  if (rules.length === 0) {
    return { isEligible: true, reasons: [], failedDimensions: [] };
  }

  let closest: readonly EligibilityDimension[] | null = null;

  for (const rule of rules) {
    const failed = mismatchesOf(profile, rule);

    if (failed.length === 0) {
      return { isEligible: true, reasons: [], failedDimensions: [] };
    }

    if (closest === null || failed.length < closest.length) {
      closest = failed;
    }
  }

  const failedDimensions = closest ?? [];

  return {
    isEligible: false,
    reasons: failedDimensions.map((dimension) => ELIGIBILITY_REASON[dimension]),
    failedDimensions,
  };
}

/**
 * Group rules by the offering they belong to, in ONE pass.
 *
 * The repository reads eligibility for a whole catalogue in one statement; this
 * turns that flat list into the per-offering shape the engine consumes, so a
 * caller never filters the list once per offering.
 *
 * COMPLEXITY : O(r). Without it, annotating a forty-offering catalogue would be
 *              O(offerings x rules).
 */
export function groupRulesByOffering<T extends EligibilityRule & { offeringId: string }>(
  rules: readonly T[]
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();

  for (const rule of rules) {
    const held = grouped.get(rule.offeringId);

    if (held === undefined) {
      grouped.set(rule.offeringId, [rule]);
    } else {
      held.push(rule);
    }
  }

  return grouped;
}

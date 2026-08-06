// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Credits, SGPA and CGPA
// LAYER  : Domain (pure)
// PURPOSE: Reduce a set of course results to credits earned and a credit-
//          weighted grade average.
//
// THE ARITHMETIC IS THE EASY PART
//   SGPA = Σ(credits × gradePoint) / Σ(credits) is four lines. What makes this
//   module worth its length is deciding WHICH results go into that sum, and no
//   two universities answer that the same way:
//
//     - a failed course: does it sit in the denominator at zero (US), or is it
//       excluded until cleared (much of India)?    -> GradeBand.countsForGpa
//     - three attempts at one course: which counts? -> EvaluationScheme.attemptPolicy
//     - an audited course: credits but no grade?    -> RegistrationType.AUDIT
//     - a withdrawn course: does it exist at all?   -> RegistrationStatus
//
//   Every one of those is READ FROM CONFIGURATION. There is no institution name
//   in this file and no threshold either.
//
// WHY NULL AND NOT ZERO
//   A student with nothing credit-bearing has NO average. Reporting 0.00 would
//   put them at the bottom of a merit list they do not belong on, and a first-
//   semester transfer student would be ranked below everyone who failed.
//   `creditWeightedAverage` returns null for this and every caller here
//   preserves it.
//
// COMPLEXITY
//   Attempt reconciliation O(n) via one Map keyed by course. Every sum O(n) in
//   one pass. No sort, no nesting, no repeated traversal.
// ============================================================================

import { GPA_SCALE } from "@/lib/constants/resultEngine";
import {
  creditWeightedAverage,
  divideRounded,
  roundToPrecision,
} from "@/lib/domain/result-engine/decimal";
import {
  COURSE_OUTCOME,
  RegistrationType,
  type CourseOutcome,
} from "@/lib/domain/result-engine/enums";
import type { GpaResult, RoundingPolicy, Scaled } from "@/lib/domain/result-engine/types";
import { AttemptPolicy } from "@/app/generated/prisma/enums";

/**
 * One course's contribution, as the GPA stage needs it.
 *
 * Deliberately NOT `CourseResultValue`: that carries a whole component tree,
 * and reconciling attempts across a degree would drag six semesters of trees
 * into memory to read four fields from each. This is the projection, and the
 * calculator builds it.
 */
export interface GpaCourseEntry {
  /** Which course — the key attempts are reconciled against. */
  readonly courseId: string;
  readonly courseRegistrationId: string;
  readonly attemptNumber: number;
  readonly registrationType: RegistrationType;
  readonly creditsScaled: Scaled;
  /** Null when the course produced no grade — incomplete, withheld, withdrawn. */
  readonly gradePointScaled: Scaled | null;
  /** The band's own answer to "does this enter an average". */
  readonly countsForGpa: boolean;
  readonly outcome: CourseOutcome;
}

/**
 * How a semester or a degree reduced to numbers.
 *
 * `creditsRegistered` and `creditsAttempted` differ, and the difference matters:
 * registered counts everything a student signed up for including audits;
 * attempted counts what could have carried credit. A transcript quotes the
 * first and a GPA divides by the second.
 */
export interface CreditSummary {
  readonly creditsRegisteredScaled: Scaled;
  readonly creditsAttemptedScaled: Scaled;
  readonly creditsEarnedScaled: Scaled;
  readonly backlogCount: number;
  readonly coursesCounted: number;
}

/**
 * Registration types that never carry credit toward a degree.
 *
 * AUDIT is attended without assessment weight. CREDIT_TRANSFER already carried
 * its credit elsewhere and counting it again would award it twice.
 */
const NON_CREDIT_TYPES: ReadonlySet<RegistrationType> = new Set([
  RegistrationType.AUDIT,
  RegistrationType.CREDIT_TRANSFER,
]);

/** Whether a registration type can contribute credit at all. */
export function carriesCredit(type: RegistrationType): boolean {
  return !NON_CREDIT_TYPES.has(type);
}

/**
 * Reduce several attempts at one course to the attempts that count.
 *
 * The policy is the REGULATION's, taken from EvaluationScheme.attemptPolicy:
 *
 *   BEST_ATTEMPT   — the highest grade point. What an improvement attempt is
 *                    for: a student who re-sat and did worse keeps their
 *                    original, which is the whole promise of an improvement.
 *   LATEST_ATTEMPT — the highest attempt number, whichever way it went.
 *   FIRST_ATTEMPT  — the original, so a re-sit clears a backlog without
 *                    changing the average.
 *   ALL_ATTEMPTS   — every attempt sits in the denominator. Harsh, and some
 *                    regulations mean it.
 *
 * Ties under BEST_ATTEMPT break toward the LATER attempt: the later sitting is
 * the one the student's record shows as current, and breaking toward the
 * earlier one would make an identical re-sit invisible. Ungraded attempts are
 * only ever chosen when nothing else is available, so a pending re-sit does not
 * erase a completed grade.
 *
 * COMPLEXITY : O(n) — one Map, one pass, no sort.
 */
export function selectAttempts(
  entries: readonly GpaCourseEntry[],
  policy: AttemptPolicy
): readonly GpaCourseEntry[] {
  if (policy === AttemptPolicy.ALL_ATTEMPTS) {
    return entries;
  }

  const chosen = new Map<string, GpaCourseEntry>();

  for (const entry of entries) {
    const held = chosen.get(entry.courseId);

    if (held === undefined) {
      chosen.set(entry.courseId, entry);
      continue;
    }

    chosen.set(entry.courseId, preferAttempt(held, entry, policy));
  }

  // Insertion order, so the output is deterministic and mirrors the input.
  return [...chosen.values()];
}

/** Which of two attempts at the same course the policy prefers. */
function preferAttempt(
  held: GpaCourseEntry,
  candidate: GpaCourseEntry,
  policy: AttemptPolicy
): GpaCourseEntry {
  switch (policy) {
    case AttemptPolicy.FIRST_ATTEMPT:
      return candidate.attemptNumber < held.attemptNumber ? candidate : held;

    case AttemptPolicy.LATEST_ATTEMPT:
      return candidate.attemptNumber > held.attemptNumber ? candidate : held;

    default: {
      // BEST_ATTEMPT. A graded attempt always beats an ungraded one, so a
      // pending re-sit cannot displace a grade the student already holds.
      if (candidate.gradePointScaled === null) {
        return held;
      }

      if (held.gradePointScaled === null) {
        return candidate;
      }

      if (candidate.gradePointScaled !== held.gradePointScaled) {
        return candidate.gradePointScaled > held.gradePointScaled ? candidate : held;
      }

      return candidate.attemptNumber > held.attemptNumber ? candidate : held;
    }
  }
}

/** Whether this entry's credits and grade point enter the average. */
function countsTowardGpa(entry: GpaCourseEntry): boolean {
  return (
    carriesCredit(entry.registrationType) &&
    entry.gradePointScaled !== null &&
    entry.countsForGpa &&
    entry.creditsScaled > 0
  );
}

/**
 * Total the credits a set of entries registered, attempted and earned.
 *
 * Earned credit requires BOTH a credit-bearing registration type and a PASS
 * outcome — a failed course carries no credit however its grade point is
 * treated, and an audited pass carries none either.
 *
 * A backlog is a course that concluded and did not pass. Withheld and
 * incomplete courses are NOT backlogs: the assessment has not finished, and
 * telling a student they have a backlog because their marks are still sealed
 * would be wrong in a way they cannot act on.
 *
 * COMPLEXITY : O(n), single pass.
 */
export function summariseCredits(entries: readonly GpaCourseEntry[]): CreditSummary {
  let creditsRegisteredScaled = 0;
  let creditsAttemptedScaled = 0;
  let creditsEarnedScaled = 0;
  let backlogCount = 0;
  let coursesCounted = 0;

  for (const entry of entries) {
    creditsRegisteredScaled += entry.creditsScaled;

    if (!carriesCredit(entry.registrationType)) {
      continue;
    }

    creditsAttemptedScaled += entry.creditsScaled;

    if (entry.outcome === COURSE_OUTCOME.PASS) {
      creditsEarnedScaled += entry.creditsScaled;
    } else if (
      entry.outcome === COURSE_OUTCOME.FAIL ||
      entry.outcome === COURSE_OUTCOME.INELIGIBLE
    ) {
      backlogCount += 1;
    }

    if (countsTowardGpa(entry)) {
      coursesCounted += 1;
    }
  }

  return {
    creditsRegisteredScaled,
    creditsAttemptedScaled,
    creditsEarnedScaled,
    backlogCount,
    coursesCounted,
  };
}

/**
 * The credit-weighted grade average of a set of entries.
 *
 * Carried at GPA_SCALE through the division and rounded to the regulation's own
 * precision exactly once, at the end. Rounding each term first would let a
 * six-course semester accumulate three hundredths of drift, which is enough to
 * move a student across a classification boundary.
 *
 * COMPLEXITY : O(n), single pass, one division.
 */
export function computeGpa(
  entries: readonly GpaCourseEntry[],
  policy: RoundingPolicy
): GpaResult {
  const terms: { weightScaled: number; valueScaled: number }[] = [];
  const summary = summariseCredits(entries);

  for (const entry of entries) {
    if (!countsTowardGpa(entry) || entry.gradePointScaled === null) {
      continue;
    }

    terms.push({
      weightScaled: entry.creditsScaled,
      valueScaled: entry.gradePointScaled,
    });
  }

  const raw = creditWeightedAverage(terms, policy.gpaRounding);

  return {
    valueScaled:
      raw === null
        ? null
        : roundToPrecision(raw, GPA_SCALE, policy.gpaPrecision, policy.gpaRounding),
    scale: GPA_SCALE,
    creditsAttemptedScaled: summary.creditsAttemptedScaled,
    creditsEarnedScaled: summary.creditsEarnedScaled,
    coursesCounted: summary.coursesCounted,
  };
}

/**
 * The cumulative average across every semester of a degree.
 *
 * Computed from the COURSES, not by averaging the SGPAs. Averaging averages
 * would weight a four-course semester equally with an eight-course one and give
 * a different — wrong — answer whenever semesters differ in size. The attempt
 * policy is applied across the whole degree here, which is what lets a
 * re-sit in semester five replace a failure from semester two.
 *
 * COMPLEXITY : O(n) in the courses of the whole degree.
 */
export function computeCgpa(
  allEntries: readonly GpaCourseEntry[],
  attemptPolicy: AttemptPolicy,
  policy: RoundingPolicy
): GpaResult {
  return computeGpa(selectAttempts(allEntries, attemptPolicy), policy);
}

/**
 * A GPA expressed as a percentage of the scale's ceiling.
 *
 * The only defensible way to read a classification off a CGPA without inventing
 * a second band table: 8.5 on a scale of 10 is 85%, which the tenant's own
 * bands then interpret. A hardcoded "CGPA × 10" would be right for Indian
 * scales and wrong for every four-point one.
 *
 * The arithmetic reduces to one division. gpaScaled sits at GPA_SCALE and
 * maxGradePointScaled at MARK_SCALE, so:
 *
 *   result = (gpa / maxGP) × 100, at MARK_SCALE
 *          = (gpaScaled / 10^6) / (maxGP / 10^2) × 100 × 10^2
 *          = gpaScaled / maxGradePointScaled
 *
 * The scale factors cancel exactly. 8_500_000 / 1000 and 3_400_000 / 400 both
 * give 8500 — 85.00% on a ten-point and on a four-point scale alike.
 *
 * Returns null for a null GPA, and for a scale with no ceiling to divide by.
 */
export function gpaAsPercentage(
  gpaScaled: Scaled | null,
  maxGradePointScaled: Scaled,
  policy: RoundingPolicy
): Scaled | null {
  if (gpaScaled === null || maxGradePointScaled <= 0) {
    return null;
  }

  return divideRounded(gpaScaled, maxGradePointScaled, policy.marksRounding);
}

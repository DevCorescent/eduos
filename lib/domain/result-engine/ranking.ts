// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Ranking
// LAYER  : Domain (pure)
// PURPOSE: Order a cohort and assign positions.
//
// WHY THERE IS ONE FUNCTION AND NOT FIVE
//   Class rank, section rank, programme rank, department rank and university
//   rank are the SAME COMPUTATION over different rows. Writing five functions
//   would be writing one algorithm five times, and the day a tie-break rule
//   changes, four of them would be updated and one forgotten. The scope is a
//   label on the input — `RankScope` — and `rankCohort` does not branch on it.
//
// DETERMINISM IS THE WHOLE REQUIREMENT
//   A rank list that reorders between two runs of the same data is not a rank
//   list. Two students with identical CGPA, SGPA, credits and percentage must
//   still come out in a fixed order, so the comparator ends with `subjectId` —
//   an always-present, always-unique key. Array.prototype.sort is not required
//   to be stable across engines for large arrays, so relying on input order
//   would be relying on an implementation detail; the final key removes the
//   question entirely.
//
// NULLS ARE EXCLUDED, NOT RANKED LAST
//   A student whose result is still withheld has no position. Ranking them last
//   would publish a statement about their performance that nobody has made.
//   They come back in `unranked`.
//
// COMPLEXITY
//   O(n log n) — one sort — plus O(n) for the position sweep. Memory O(n): the
//   input is copied once rather than sorted in place, because the caller's array
//   is readonly and a sort would mutate it.
// ============================================================================

import type { Scaled } from "@/lib/domain/result-engine/types";

/** Which population a ranking was taken over. A label, never a branch. */
export const RANK_SCOPE = {
  CLASS: "CLASS",
  SECTION: "SECTION",
  PROGRAMME: "PROGRAMME",
  DEPARTMENT: "DEPARTMENT",
  UNIVERSITY: "UNIVERSITY",
} as const;

export type RankScope = (typeof RANK_SCOPE)[keyof typeof RANK_SCOPE];

/**
 * How positions are numbered after a tie.
 *
 * COMPETITION — 1, 2, 2, 4. The classic. Two seconds mean no third.
 * DENSE       — 1, 2, 2, 3. No gaps; used where rank counts distinct scores.
 * ORDINAL     — 1, 2, 3, 4. Every subject gets its own number, ties resolved by
 *               the tie-break chain. Required where a fixed number of seats or
 *               medals must be filled and a shared position cannot be honoured.
 */
export const RANK_MODE = {
  COMPETITION: "COMPETITION",
  DENSE: "DENSE",
  ORDINAL: "ORDINAL",
} as const;

export type RankMode = (typeof RANK_MODE)[keyof typeof RANK_MODE];

/**
 * A figure a ranking may order by.
 *
 * The numeric four are compared as scaled integers, DESCENDING — more is
 * better. The two textual ones are compared ASCENDING, because "alphabetical
 * order" and "by enrollment number" both mean the ordinary direction.
 */
export const RANK_KEY = {
  CGPA: "CGPA",
  SGPA: "SGPA",
  CREDITS: "CREDITS",
  PERCENTAGE: "PERCENTAGE",
  ALPHABETICAL: "ALPHABETICAL",
  ENROLLMENT: "ENROLLMENT",
} as const;

export type RankKey = (typeof RANK_KEY)[keyof typeof RANK_KEY];

/** Keys compared as text, ascending. Every other key is numeric, descending. */
const TEXTUAL_KEYS: ReadonlySet<RankKey> = new Set([
  RANK_KEY.ALPHABETICAL,
  RANK_KEY.ENROLLMENT,
]);

/**
 * One subject in a ranking, with every figure a tie-break might consult.
 *
 * All optional except the identity, because a semester ranking has no CGPA yet
 * and a programme ranking has no single SGPA. A key with no value on a subject
 * sorts that subject AFTER one that has it — a missing figure cannot win a
 * tie-break it did not enter.
 */
export interface RankSubject {
  readonly subjectId: string;
  readonly cgpaScaled?: Scaled | null;
  readonly sgpaScaled?: Scaled | null;
  readonly creditsEarnedScaled?: Scaled | null;
  readonly percentageScaled?: Scaled | null;
  /** The name a tie breaks alphabetically on. */
  readonly displayName?: string;
  /** The enrollment or roll number a tie breaks on. */
  readonly enrollmentNumber?: string;
}

/** What a ranking pass is told to do. */
export interface RankingPolicy {
  readonly scope: RankScope;
  readonly mode: RankMode;
  /**
   * The figure ranks are assigned on, and the order tie-breaks are tried in.
   *
   * The FIRST key is the primary ordering. Subsequent keys break ties in the
   * one before. A subject with no value for the primary key is unranked.
   * Never hardcoded: a university that ranks on percentage and breaks ties on
   * enrollment number configures exactly that.
   */
  readonly keys: readonly RankKey[];
}

/** A subject's position in a cohort. */
export interface RankedSubject {
  readonly subjectId: string;
  readonly rank: number;
  readonly outOf: number;
  /** True when another subject shares this rank under the chosen mode. */
  readonly isTied: boolean;
  /** The primary figure the rank was assigned on. */
  readonly valueScaled: Scaled;
}

/** A completed ranking. */
export interface RankingResult {
  readonly scope: RankScope;
  readonly mode: RankMode;
  readonly ranked: readonly RankedSubject[];
  /** Subjects with no value for the primary key — excluded, not ranked last. */
  readonly unranked: readonly string[];
}

/** Read a numeric key off a subject, or null when it has none. */
function numericValue(subject: RankSubject, key: RankKey): Scaled | null {
  switch (key) {
    case RANK_KEY.CGPA:
      return subject.cgpaScaled ?? null;
    case RANK_KEY.SGPA:
      return subject.sgpaScaled ?? null;
    case RANK_KEY.CREDITS:
      return subject.creditsEarnedScaled ?? null;
    default:
      return subject.percentageScaled ?? null;
  }
}

/** Read a textual key off a subject, or null when it has none. */
function textualValue(subject: RankSubject, key: RankKey): string | null {
  const value =
    key === RANK_KEY.ALPHABETICAL ? subject.displayName : subject.enrollmentNumber;

  return value ?? null;
}

/**
 * Compare two subjects on one key.
 *
 * Negative means `left` ranks ahead. A subject missing the key always ranks
 * behind one that has it, and two subjects both missing it are equal on this
 * key so the chain moves on.
 */
function compareOn(left: RankSubject, right: RankSubject, key: RankKey): number {
  if (TEXTUAL_KEYS.has(key)) {
    const leftText = textualValue(left, key);
    const rightText = textualValue(right, key);

    if (leftText === rightText) {
      return 0;
    }

    if (leftText === null) {
      return 1;
    }

    if (rightText === null) {
      return -1;
    }

    // Ascending, and locale-independent: a rank list must not reorder because
    // the server's locale changed.
    return leftText < rightText ? -1 : 1;
  }

  const leftValue = numericValue(left, key);
  const rightValue = numericValue(right, key);

  if (leftValue === rightValue) {
    return 0;
  }

  if (leftValue === null) {
    return 1;
  }

  if (rightValue === null) {
    return -1;
  }

  // Descending: a higher figure ranks ahead.
  return rightValue - leftValue;
}

/**
 * Rank a cohort.
 *
 * The comparator walks the configured keys in order and stops at the first that
 * separates the two subjects, then falls back to `subjectId` so the ordering is
 * total. That final key is not a tie-break policy — it is what makes the result
 * reproducible, and it never decides a rank NUMBER under COMPETITION or DENSE
 * because those modes compare on the keys alone.
 *
 * COMPLEXITY : O(n log n · k) where k is the key count, which is a handful.
 *              Memory O(n).
 */
export function rankCohort(
  subjects: readonly RankSubject[],
  policy: RankingPolicy
): RankingResult {
  const keys = policy.keys.length > 0 ? policy.keys : [RANK_KEY.CGPA];
  const primary = keys[0];

  const eligible: RankSubject[] = [];
  const unranked: string[] = [];

  for (const subject of subjects) {
    const value = TEXTUAL_KEYS.has(primary)
      ? textualValue(subject, primary)
      : numericValue(subject, primary);

    if (value === null) {
      unranked.push(subject.subjectId);
    } else {
      eligible.push(subject);
    }
  }

  // Copied before sorting: the caller's array is readonly.
  eligible.sort((left, right) => {
    for (const key of keys) {
      const verdict = compareOn(left, right, key);

      if (verdict !== 0) {
        return verdict;
      }
    }

    // Total order, so two runs on the same data cannot disagree.
    return left.subjectId < right.subjectId ? -1 : left.subjectId > right.subjectId ? 1 : 0;
  });

  return {
    scope: policy.scope,
    mode: policy.mode,
    ranked: assignPositions(eligible, keys, policy.mode),
    unranked,
  };
}

/**
 * Walk the sorted cohort and number it.
 *
 * "Tied" means equal on every CONFIGURED key — the `subjectId` fallback that
 * ordered them is not part of the comparison, so two genuinely equal students
 * are reported as tied even though one had to be printed first.
 *
 * COMPLEXITY : O(n · k), one pass.
 */
function assignPositions(
  sorted: readonly RankSubject[],
  keys: readonly RankKey[],
  mode: RankMode
): readonly RankedSubject[] {
  const outOf = sorted.length;
  const positions: RankedSubject[] = [];

  // Which group each subject belongs to, and where that group started.
  const groupStart: number[] = [];
  const groupIndex: number[] = [];
  let currentGroup = 0;

  for (let index = 0; index < outOf; index += 1) {
    if (index > 0 && !equalOnKeys(sorted[index - 1], sorted[index], keys)) {
      currentGroup += 1;
      groupStart[currentGroup] = index;
    } else if (index === 0) {
      groupStart[0] = 0;
    }

    groupIndex[index] = currentGroup;
  }

  const groupSizes = new Array<number>(currentGroup + 1).fill(0);

  for (let index = 0; index < outOf; index += 1) {
    groupSizes[groupIndex[index]] += 1;
  }

  for (let index = 0; index < outOf; index += 1) {
    const group = groupIndex[index];
    const primary = keys[0];
    const value = TEXTUAL_KEYS.has(primary) ? 0 : (numericValue(sorted[index], primary) ?? 0);

    let rank: number;

    if (mode === RANK_MODE.ORDINAL) {
      // Every subject its own number; the sort already decided the order.
      rank = index + 1;
    } else if (mode === RANK_MODE.DENSE) {
      // Consecutive group numbers, no gaps after a tie.
      rank = group + 1;
    } else {
      // Competition: the position the group began at, so a tie consumes the
      // places it occupies.
      rank = groupStart[group] + 1;
    }

    positions.push({
      subjectId: sorted[index].subjectId,
      rank,
      outOf,
      isTied: groupSizes[group] > 1,
      valueScaled: value,
    });
  }

  return positions;
}

/** Whether two subjects are equal on every configured key. */
function equalOnKeys(
  left: RankSubject,
  right: RankSubject,
  keys: readonly RankKey[]
): boolean {
  for (const key of keys) {
    if (compareOn(left, right, key) !== 0) {
      return false;
    }
  }

  return true;
}

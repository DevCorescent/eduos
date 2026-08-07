// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Electives — Preference Resolution
// LAYER  : Domain (pure)
// PURPOSE: Put a set of applicants into the order seats will be handed out in.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO. Everything arrives
//   as plain data and the answer is a new array — the input is never sorted in
//   place, because a caller's array is theirs.
//
// THE ORDER, AND WHY IT IS EXACTLY THIS
//   1. PREFERENCE RANK, ascending. Always, before anything else. A student who
//      ranked an elective first outranks one who ranked it third, whatever
//      either scored. This is the rule the whole design was told to protect.
//   2. The offering's declared STRATEGY, applied only WITHIN a rank.
//   3. `studentId`, ascending — never a policy, only a guarantee. Two students
//      identical on every configured key must still come out in a fixed order,
//      or the same cohort allocates differently on two runs and the result is
//      unauditable.
//
// MERIT, AND THE STUDENTS WHO HAVE NO CGPA
//   Per the Phase 19 decision: students WITH a CGPA are ordered by merit;
//   students WITHOUT one are placed AFTER the entire graded group and ordered
//   among themselves by FCFS.
//
//   No CGPA is ever invented. A first-semester student has no grade point
//   average — not a zero, not an average of nothing — and substituting any
//   number would rank them against a figure nobody computed. Placing them after
//   the graded group is a stated policy; giving them a value would be a
//   fabrication.
//
// COMPLEXITY
//   O(n log n), one sort. Comparators are O(1). No nested scan, no grouping
//   pass — the ordering is expressed entirely in the comparator.
// ============================================================================

import { ElectiveAllocationStrategy } from "@/app/generated/prisma/enums";

/** One applicant for one offering. */
export interface AllocationCandidate {
  readonly studentId: string;
  /** 1 is most preferred. Honoured before any strategy. */
  readonly preferenceRank: number;
  /** When the preference was submitted. The FCFS key. */
  readonly submittedAt: Date;
  /**
   * The merit key, at whatever scale the caller computed it.
   *
   * NULL means "this student has no CGPA", which is a real state and not a
   * missing value to be defaulted. See the file header.
   */
  readonly cgpaScaled: number | null;
}

/** Compare two candidates' submission instants. Earlier wins. */
function byFcfs(left: AllocationCandidate, right: AllocationCandidate): number {
  return left.submittedAt.getTime() - right.submittedAt.getTime();
}

/** Total-order fallback. Not a policy — a determinism guarantee. */
function bySubjectId(left: AllocationCandidate, right: AllocationCandidate): number {
  return left.studentId < right.studentId ? -1 : left.studentId > right.studentId ? 1 : 0;
}

/**
 * Order two candidates who share a rank, under MERIT.
 *
 * A graded student always precedes an ungraded one. Within the graded group,
 * higher CGPA wins and an exact tie falls to FCFS. Within the ungraded group,
 * FCFS decides outright — there is nothing else to decide on.
 */
function byMerit(left: AllocationCandidate, right: AllocationCandidate): number {
  const leftGraded = left.cgpaScaled !== null;
  const rightGraded = right.cgpaScaled !== null;

  if (leftGraded !== rightGraded) {
    // The graded group goes first, entire.
    return leftGraded ? -1 : 1;
  }

  if (leftGraded && rightGraded && left.cgpaScaled !== right.cgpaScaled) {
    // Descending: a higher average ranks ahead.
    return (right.cgpaScaled ?? 0) - (left.cgpaScaled ?? 0);
  }

  // Either both ungraded, or graded and exactly equal. FCFS decides both.
  return byFcfs(left, right);
}

/**
 * Order a set of applicants for one offering.
 *
 * Returns a NEW array; the caller's is untouched. The comparator is total, so
 * two runs over the same cohort produce byte-identical output whatever order
 * the rows arrived in — which is what makes an allocation reproducible and a
 * disputed outcome explainable.
 *
 * COMPLEXITY : O(n log n).
 */
export function resolvePreferenceOrder(
  candidates: readonly AllocationCandidate[],
  strategy: ElectiveAllocationStrategy
): readonly AllocationCandidate[] {
  const tieBreak = strategy === ElectiveAllocationStrategy.MERIT ? byMerit : byFcfs;

  return [...candidates].sort((left, right) => {
    // Rank first. Always.
    if (left.preferenceRank !== right.preferenceRank) {
      return left.preferenceRank - right.preferenceRank;
    }

    const broken = tieBreak(left, right);

    if (broken !== 0) {
      return broken;
    }

    return bySubjectId(left, right);
  });
}

/**
 * Split a resolved order into the graded and ungraded groups.
 *
 * Reporting only — it lets an allocation report state how many seats went to
 * students with a computed CGPA and how many to students without one, which is
 * the question an examination office asks first when a MERIT run is disputed.
 *
 * COMPLEXITY : O(n), one pass.
 */
export function partitionByMerit(
  candidates: readonly AllocationCandidate[]
): {
  readonly graded: readonly AllocationCandidate[];
  readonly ungraded: readonly AllocationCandidate[];
} {
  const graded: AllocationCandidate[] = [];
  const ungraded: AllocationCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.cgpaScaled === null) {
      ungraded.push(candidate);
    } else {
      graded.push(candidate);
    }
  }

  return { graded, ungraded };
}

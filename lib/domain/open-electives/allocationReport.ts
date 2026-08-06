// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Electives — Allocation Report
// LAYER  : Domain (pure)
// PURPOSE: Summarise a run, so an examination office can defend it.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO, no clock. Every
//   figure is derived from the verdicts handed in, which is what stops a
//   report's header disagreeing with the rows printed beneath it.
//
// WHAT A REPORT HAS TO ANSWER
//   Not "how many seats went out" — a count answers that. The questions that
//   actually arrive are:
//
//     "I ranked it first and did not get it. How is that possible?"
//        -> byRank shows how deep the queue was served. If rank 1 was itself
//           oversubscribed, the answer is there.
//     "Was the merit rule applied, or did first-come win?"
//        -> meritSplit shows how many awards went to graded and ungraded
//           students, which is the first thing asked of a disputed MERIT run.
//     "Why was I never considered?"
//        -> ineligibleCount plus the reasons on the run itself.
//
//   A report that cannot answer those is a count with a title.
//
// COMPLEXITY
//   O(n), one pass per aggregate. No sort — the verdicts arrive in allocation
//   order and every figure here is a tally.
// ============================================================================

import { ElectiveAllocationOutcome } from "@/app/generated/prisma/enums";
import type { AllocationRunResult } from "@/lib/domain/open-electives/allocationEngine";
import { partitionByMerit } from "@/lib/domain/open-electives/preferenceResolver";

/** How one preference rank fared. */
export interface RankBreakdown {
  readonly preferenceRank: number;
  readonly applied: number;
  readonly awarded: number;
  readonly refused: number;
}

/** How the two merit groups fared. Meaningful only for a MERIT offering. */
export interface MeritSplit {
  readonly gradedApplied: number;
  readonly gradedAwarded: number;
  readonly ungradedApplied: number;
  readonly ungradedAwarded: number;
}

/** Everything a run can be asked to account for. */
export interface AllocationSummary {
  readonly offeringId: string;
  readonly totalSeats: number;
  readonly applied: number;
  readonly awarded: number;
  readonly refused: number;
  readonly ineligible: number;
  readonly seatsRemaining: number;
  readonly wasOversubscribed: boolean;
  /** Ascending by rank. Only ranks that actually appeared. */
  readonly byRank: readonly RankBreakdown[];
  readonly meritSplit: MeritSplit;
  /** The deepest rank that still received a seat. Null when nothing was awarded. */
  readonly deepestAwardedRank: number | null;
}

/**
 * Summarise one run.
 *
 * `totalSeats` is passed in rather than inferred from `awarded + remaining`,
 * because an OVERSUBSCRIBED run has a negative remainder internally and
 * inferring capacity from it would report a smaller offering than the
 * department declared.
 *
 * COMPLEXITY : O(n + k log k), where k is the number of distinct ranks — a
 *              handful. The sort is over ranks, not over students.
 */
export function summariseAllocation(
  result: AllocationRunResult,
  totalSeats: number
): AllocationSummary {
  const ranks = new Map<number, { applied: number; awarded: number }>();

  let awarded = 0;
  let deepestAwardedRank: number | null = null;

  for (const verdict of result.verdicts) {
    const held = ranks.get(verdict.preferenceRank) ?? { applied: 0, awarded: 0 };

    held.applied += 1;

    if (verdict.outcome === ElectiveAllocationOutcome.ALLOCATED) {
      held.awarded += 1;
      awarded += 1;

      if (deepestAwardedRank === null || verdict.preferenceRank > deepestAwardedRank) {
        deepestAwardedRank = verdict.preferenceRank;
      }
    }

    ranks.set(verdict.preferenceRank, held);
  }

  const byRank: RankBreakdown[] = [];

  for (const [preferenceRank, tally] of ranks) {
    byRank.push({
      preferenceRank,
      applied: tally.applied,
      awarded: tally.awarded,
      refused: tally.applied - tally.awarded,
    });
  }

  // Ascending, so a reader walks the queue in the order it was served.
  byRank.sort((left, right) => left.preferenceRank - right.preferenceRank);

  const remaining = totalSeats - awarded;

  return {
    offeringId: result.offeringId,
    totalSeats,
    applied: result.verdicts.length,
    awarded,
    refused: result.verdicts.length - awarded,
    ineligible: result.ineligible.length,
    // Floored: an oversubscribed offering has no negative seats to report.
    seatsRemaining: remaining > 0 ? remaining : 0,
    wasOversubscribed: result.wasOversubscribed,
    byRank,
    meritSplit: buildMeritSplit(result),
    deepestAwardedRank,
  };
}

/**
 * How the graded and ungraded groups fared.
 *
 * The first question asked of a disputed MERIT run is whether students with no
 * CGPA displaced students with one. This answers it directly rather than
 * leaving it to be inferred from a list.
 *
 * For an FCFS offering the split is still computed and still true — it simply
 * carries no policy meaning there, which is better than being absent and
 * looking like an error.
 */
function buildMeritSplit(result: AllocationRunResult): MeritSplit {
  const { graded, ungraded } = partitionByMerit(result.queue);
  const awardedIds = new Set(
    result.verdicts
      .filter((verdict) => verdict.outcome === ElectiveAllocationOutcome.ALLOCATED)
      .map((verdict) => verdict.studentId)
  );

  return {
    gradedApplied: graded.length,
    gradedAwarded: graded.filter((candidate) => awardedIds.has(candidate.studentId)).length,
    ungradedApplied: ungraded.length,
    ungradedAwarded: ungraded.filter((candidate) => awardedIds.has(candidate.studentId))
      .length,
  };
}

/**
 * Whether a run's own numbers are internally consistent.
 *
 * Exists so a caller can assert the invariant before persisting, rather than
 * discovering a contradiction in a published report. A run that fails this has
 * a defect in the engine, not in its inputs — which is precisely why it is
 * worth checking at the boundary where it can still be caught.
 */
export function isSummaryCoherent(summary: AllocationSummary): boolean {
  const rankApplied = summary.byRank.reduce((sum, rank) => sum + rank.applied, 0);
  const rankAwarded = summary.byRank.reduce((sum, rank) => sum + rank.awarded, 0);

  return (
    summary.awarded + summary.refused === summary.applied &&
    rankApplied === summary.applied &&
    rankAwarded === summary.awarded &&
    summary.awarded <= summary.totalSeats
  );
}

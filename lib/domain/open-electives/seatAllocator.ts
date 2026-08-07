// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Electives — Seat Allocation
// LAYER  : Domain (pure)
// PURPOSE: Hand out a fixed number of seats to an already-ordered queue.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO, no clock. The
//   allocation instant is a PARAMETER, so a whole run is stamped with one time
//   and two verdicts from one run cannot disagree about when it happened.
//
// THIS MODULE MAKES NO CHOICES
//   It receives a queue and awards seats from the front until they run out.
//   WHO is at the front was decided by preferenceResolver; WHETHER a candidate
//   belongs in the queue at all was decided by eligibilityEngine. Splitting it
//   this way means the part that is easy to get wrong (ordering) is tested
//   separately from the part that is easy to get right (counting), and neither
//   can quietly acquire the other's responsibility.
//
// EVERY APPLICANT GETS A VERDICT
//   A student who applied and was refused is written down, not omitted. That is
//   the whole reason OpenElectiveAllocation exists as a table: a report listing
//   only winners cannot answer "why did I not get it", and an examination
//   office asked that question cannot reconstruct the answer after the fact.
//
// COMPLEXITY
//   O(n), one pass. No sort — the queue arrived sorted. Memory O(n) in the
//   verdicts, which are the output.
// ============================================================================

import { ElectiveAllocationOutcome } from "@/app/generated/prisma/enums";
import type { AllocationCandidate } from "@/lib/domain/open-electives/preferenceResolver";

/** What the allocator concluded for one applicant. */
export interface SeatVerdict {
  readonly studentId: string;
  readonly preferenceRank: number;
  readonly outcome: ElectiveAllocationOutcome;
  /** The position they occupied in the queue. 1-based. For the report. */
  readonly queuePosition: number;
  readonly allocatedAt: Date;
}

/** The outcome of handing out one offering's seats. */
export interface SeatAllocationResult {
  readonly verdicts: readonly SeatVerdict[];
  readonly awarded: number;
  readonly refused: number;
  /** Seats left over. Zero when the offering filled. */
  readonly seatsRemaining: number;
  /** True when demand exceeded supply — the interesting case for a report. */
  readonly wasOversubscribed: boolean;
}

/**
 * Award seats from the front of a queue.
 *
 * `totalSeats` is clamped at zero: a negative capacity is a misconfiguration
 * and awarding a negative number of seats is not a coherent alternative. Every
 * applicant is then refused, which is the honest consequence.
 *
 * The queue is NOT re-sorted. It arrives in allocation order and is consumed in
 * that order; re-sorting here would be a second opinion about an ordering
 * preferenceResolver already settled, and the two could disagree.
 *
 * COMPLEXITY : O(n), one pass, no allocation beyond the verdict array.
 */
export function allocateSeats(
  queue: readonly AllocationCandidate[],
  totalSeats: number,
  allocatedAt: Date
): SeatAllocationResult {
  const capacity = totalSeats > 0 ? totalSeats : 0;
  const verdicts: SeatVerdict[] = [];

  let awarded = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    const hasSeat = awarded < capacity;

    if (hasSeat) {
      awarded += 1;
    }

    verdicts.push({
      studentId: candidate.studentId,
      preferenceRank: candidate.preferenceRank,
      outcome: hasSeat
        ? ElectiveAllocationOutcome.ALLOCATED
        : ElectiveAllocationOutcome.NOT_ALLOCATED,
      queuePosition: index + 1,
      allocatedAt,
    });
  }

  return {
    verdicts,
    awarded,
    refused: verdicts.length - awarded,
    seatsRemaining: capacity - awarded,
    wasOversubscribed: queue.length > capacity,
  };
}

/**
 * Refuse every applicant, for a reason outside the seat count.
 *
 * Used when an offering cannot allocate at all — no eligible applicants, or a
 * capacity of zero. Produces the same verdict shape as a real run so a report
 * has rows to print rather than a special empty case, and so a student who
 * applied still has a record explaining that they did.
 *
 * COMPLEXITY : O(n).
 */
export function refuseAll(
  candidates: readonly AllocationCandidate[],
  allocatedAt: Date
): readonly SeatVerdict[] {
  return candidates.map((candidate, index) => ({
    studentId: candidate.studentId,
    preferenceRank: candidate.preferenceRank,
    outcome: ElectiveAllocationOutcome.NOT_ALLOCATED,
    queuePosition: index + 1,
    allocatedAt,
  }));
}

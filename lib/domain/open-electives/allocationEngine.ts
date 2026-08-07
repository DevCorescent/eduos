// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Electives — Allocation Engine
// LAYER  : Domain (pure)
// PURPOSE: Run one offering's allocation, end to end, as a pure function.
//
//   eligibility  ->  preference order  ->  seats  ->  verdicts
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO, no clock. Every
//   input arrives as plain data and the allocation instant is a parameter, so
//   the same input always produces byte-identical output. That is not a nicety:
//   an allocation that could not be reproduced could not be defended when a
//   student disputes it.
//
// WHY ELIGIBILITY IS APPLIED HERE AND NOT EARLIER
//   An INELIGIBLE applicant is not simply dropped — they receive a verdict
//   explaining why. Filtering them out before the engine would leave no record
//   that they applied, and "I applied and heard nothing" is the complaint this
//   design exists to make answerable. They are refused with reasons, and they
//   never enter the seat queue, so they cannot displace an eligible student.
//
// WHAT THIS MODULE DOES NOT DO
//   It does not read a database, does not write one, does not know what a
//   CourseRegistration is, and does not decide whether the offering was in a
//   state that permits allocation. That last one is a LIFECYCLE rule and lives
//   in the service — the engine will happily allocate a DRAFT offering if asked,
//   which is why the service asks only when it should.
//
// COMPLEXITY
//   O(n log n) overall, dominated by the single sort in preferenceResolver.
//   Eligibility is O(n x r) with r a handful of rules. One pass for seats.
//   Memory O(n).
// ============================================================================

import type { ElectiveAllocationStrategy } from "@/app/generated/prisma/enums";
import {
  evaluateEligibility,
  type EligibilityRule,
  type StudentEligibilityProfile,
} from "@/lib/domain/open-electives/eligibilityEngine";
import {
  resolvePreferenceOrder,
  type AllocationCandidate,
} from "@/lib/domain/open-electives/preferenceResolver";
import {
  allocateSeats,
  refuseAll,
  type SeatVerdict,
} from "@/lib/domain/open-electives/seatAllocator";

/** One applicant, with everything the run needs to judge them. */
export interface AllocationApplicant extends AllocationCandidate {
  readonly profile: StudentEligibilityProfile;
}

/** Everything one allocation run consumes. */
export interface AllocationRunInput {
  readonly offeringId: string;
  readonly totalSeats: number;
  readonly strategy: ElectiveAllocationStrategy;
  /** Empty means the offering is unrestricted. */
  readonly eligibilityRules: readonly EligibilityRule[];
  readonly applicants: readonly AllocationApplicant[];
  /** Stamped on every verdict, so one run has one time. */
  readonly allocatedAt: Date;
}

/** Why an applicant was refused before the queue was even formed. */
export interface IneligibleApplicant {
  readonly studentId: string;
  readonly preferenceRank: number;
  readonly reasons: readonly string[];
}

/** Everything one allocation run produced. */
export interface AllocationRunResult {
  readonly offeringId: string;
  /** Every applicant's verdict — eligible and ineligible alike. */
  readonly verdicts: readonly SeatVerdict[];
  readonly awarded: number;
  readonly refused: number;
  readonly seatsRemaining: number;
  readonly wasOversubscribed: boolean;
  /** Applicants the rules excluded, with the reasons they were given. */
  readonly ineligible: readonly IneligibleApplicant[];
  /** The queue that was actually served, in the order it was served. */
  readonly queue: readonly AllocationCandidate[];
}

/**
 * Run one offering's allocation.
 *
 * Three stages, each delegated to the module that owns it, so no stage can
 * quietly acquire another's responsibility:
 *
 *   eligibilityEngine   decides WHO may queue
 *   preferenceResolver  decides IN WHAT ORDER
 *   seatAllocator       decides HOW MANY are served
 *
 * The ineligible are refused with reasons and excluded from the queue; the
 * eligible are ordered and served. Every applicant appears in `verdicts`.
 *
 * COMPLEXITY : O(n log n).
 */
export function runAllocation(input: AllocationRunInput): AllocationRunResult {
  const eligible: AllocationApplicant[] = [];
  const ineligible: IneligibleApplicant[] = [];

  for (const applicant of input.applicants) {
    const verdict = evaluateEligibility(applicant.profile, input.eligibilityRules);

    if (verdict.isEligible) {
      eligible.push(applicant);
    } else {
      ineligible.push({
        studentId: applicant.studentId,
        preferenceRank: applicant.preferenceRank,
        reasons: verdict.reasons,
      });
    }
  }

  const queue = resolvePreferenceOrder(eligible, input.strategy);
  const seated = allocateSeats(queue, input.totalSeats, input.allocatedAt);

  // The ineligible are refused AFTER the queue, so their queuePosition does not
  // imply they were ever in contention — they were not.
  const refusedForEligibility = refuseAll(
    ineligible.map((entry) => ({
      studentId: entry.studentId,
      preferenceRank: entry.preferenceRank,
      submittedAt: input.allocatedAt,
      cgpaScaled: null,
    })),
    input.allocatedAt
  );

  return {
    offeringId: input.offeringId,
    verdicts: [...seated.verdicts, ...refusedForEligibility],
    awarded: seated.awarded,
    refused: seated.refused + refusedForEligibility.length,
    seatsRemaining: seated.seatsRemaining,
    wasOversubscribed: seated.wasOversubscribed,
    ineligible,
    queue,
  };
}

/**
 * The students a run awarded a seat to.
 *
 * A projection, so a caller enrolling the winners need not re-filter the
 * verdicts and cannot filter them differently than the report does.
 *
 * COMPLEXITY : O(n).
 */
export function awardedStudentIds(result: AllocationRunResult): readonly string[] {
  return result.verdicts
    .filter((verdict) => verdict.outcome === "ALLOCATED")
    .map((verdict) => verdict.studentId);
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Electives — Domain
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove the four rules the whole phase rests on:
//
//   1. absence of eligibility rules means UNRESTRICTED, not barred
//   2. preference rank is honoured BEFORE any tie-breaker, always
//   3. a student with no CGPA is placed after the graded group — never given
//      an invented value
//   4. every applicant receives a verdict, refusals included
//
// These modules import no Prisma client, no HTTP and no service, so all of this
// runs with no database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ElectiveAllocationOutcome,
  ElectiveAllocationStrategy,
} from "@/app/generated/prisma/enums";
import {
  ELIGIBILITY_REASON,
  evaluateEligibility,
  groupRulesByOffering,
  type EligibilityRule,
  type StudentEligibilityProfile,
} from "@/lib/domain/open-electives/eligibilityEngine";
import {
  partitionByMerit,
  resolvePreferenceOrder,
  type AllocationCandidate,
} from "@/lib/domain/open-electives/preferenceResolver";
import { allocateSeats, refuseAll } from "@/lib/domain/open-electives/seatAllocator";
import {
  awardedStudentIds,
  runAllocation,
  type AllocationApplicant,
} from "@/lib/domain/open-electives/allocationEngine";
import {
  isSummaryCoherent,
  summariseAllocation,
} from "@/lib/domain/open-electives/allocationReport";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function profile(overrides: Partial<StudentEligibilityProfile> = {}): StudentEligibilityProfile {
  return {
    studentId: "student_1",
    programmeId: "prog_cse",
    specialisationId: "spec_aiml",
    currentSemester: 5,
    ...overrides,
  };
}

function candidate(
  studentId: string,
  preferenceRank: number,
  overrides: Partial<AllocationCandidate> = {}
): AllocationCandidate {
  return {
    studentId,
    preferenceRank,
    submittedAt: at(0),
    cgpaScaled: null,
    ...overrides,
  };
}

function applicant(
  studentId: string,
  preferenceRank: number,
  overrides: Partial<AllocationApplicant> = {}
): AllocationApplicant {
  return {
    ...candidate(studentId, preferenceRank),
    profile: profile({ studentId }),
    ...overrides,
  };
}

// --- Eligibility ------------------------------------------------------------

describe("eligibilityEngine — absence of rules means UNRESTRICTED", () => {
  it("admits a student when an offering declares no rules", () => {
    // The single most consequential line in the engine. The opposite reading
    // would bar every student from every offering a department had not yet
    // configured, and it would look like a working system with no takers.
    const verdict = evaluateEligibility(profile(), []);

    assert.equal(verdict.isEligible, true);
    assert.deepEqual(verdict.reasons, []);
  });

  it("admits a student a rule narrows on nothing", () => {
    const anyRule: EligibilityRule = {
      programmeId: null,
      specialisationId: null,
      semesterNumber: null,
    };

    assert.equal(evaluateEligibility(profile(), [anyRule]).isEligible, true);
  });
});

describe("eligibilityEngine — rules are OR-ed, columns are AND-ed", () => {
  const cseRule: EligibilityRule = {
    programmeId: "prog_cse",
    specialisationId: null,
    semesterNumber: null,
  };
  const eceSem5Rule: EligibilityRule = {
    programmeId: "prog_ece",
    specialisationId: null,
    semesterNumber: 5,
  };

  it("admits a student satisfying ANY ONE rule", () => {
    // "Open to CSE, and to ECE semester 5" is two rows.
    assert.equal(
      evaluateEligibility(profile({ programmeId: "prog_cse" }), [cseRule, eceSem5Rule])
        .isEligible,
      true
    );

    assert.equal(
      evaluateEligibility(
        profile({ programmeId: "prog_ece", currentSemester: 5 }),
        [cseRule, eceSem5Rule]
      ).isEligible,
      true
    );
  });

  it("refuses a student satisfying no rule", () => {
    const verdict = evaluateEligibility(
      profile({ programmeId: "prog_mech", currentSemester: 3 }),
      [cseRule, eceSem5Rule]
    );

    assert.equal(verdict.isEligible, false);
    assert.ok(verdict.reasons.length > 0);
  });

  it("requires EVERY narrowing column of a rule to match", () => {
    // An ECE student in semester 3 fails eceSem5Rule on semester alone.
    const verdict = evaluateEligibility(
      profile({ programmeId: "prog_ece", currentSemester: 3 }),
      [eceSem5Rule]
    );

    assert.equal(verdict.isEligible, false);
    assert.deepEqual(verdict.failedDimensions, ["SEMESTER"]);
  });

  it("narrows on BRANCH, which is Specialisation", () => {
    const branchRule: EligibilityRule = {
      programmeId: null,
      specialisationId: "spec_aiml",
      semesterNumber: null,
    };

    assert.equal(
      evaluateEligibility(profile({ specialisationId: "spec_aiml" }), [branchRule]).isEligible,
      true
    );
    assert.equal(
      evaluateEligibility(profile({ specialisationId: "spec_ds" }), [branchRule]).isEligible,
      false
    );
  });

  it("does NOT treat an unassigned student as 'any'", () => {
    // A student with no programme is not "any programme" — their programme is
    // unknown, and admitting them would be a guess.
    const verdict = evaluateEligibility(profile({ programmeId: null }), [
      { programmeId: "prog_cse", specialisationId: null, semesterNumber: null },
    ]);

    assert.equal(verdict.isEligible, false);
  });
});

describe("eligibilityEngine — reasons are actionable", () => {
  it("reports the dimension that actually blocked the student", () => {
    const verdict = evaluateEligibility(profile({ currentSemester: 3 }), [
      { programmeId: "prog_cse", specialisationId: null, semesterNumber: 5 },
    ]);

    assert.deepEqual(verdict.failedDimensions, ["SEMESTER"]);
    assert.deepEqual(verdict.reasons, [ELIGIBILITY_REASON.SEMESTER]);
  });

  it("reports the CLOSEST rule, not every mismatch of every rule", () => {
    // Reporting all would tell a CSE semester-3 student they failed on
    // programme, branch AND semester — true of some rule, useless as advice.
    const verdict = evaluateEligibility(profile({ currentSemester: 3 }), [
      { programmeId: "prog_mech", specialisationId: "spec_x", semesterNumber: 8 },
      { programmeId: "prog_cse", specialisationId: "spec_aiml", semesterNumber: 5 },
    ]);

    assert.deepEqual(verdict.failedDimensions, ["SEMESTER"]);
  });

  it("never reports reasons for an eligible student", () => {
    const verdict = evaluateEligibility(profile(), [
      { programmeId: "prog_cse", specialisationId: null, semesterNumber: null },
    ]);

    assert.deepEqual(verdict.reasons, []);
    assert.deepEqual(verdict.failedDimensions, []);
  });
});

describe("groupRulesByOffering", () => {
  it("groups in one pass, so a catalogue is not filtered per offering", () => {
    const grouped = groupRulesByOffering([
      { offeringId: "a", programmeId: "p1", specialisationId: null, semesterNumber: null },
      { offeringId: "a", programmeId: "p2", specialisationId: null, semesterNumber: null },
      { offeringId: "b", programmeId: "p3", specialisationId: null, semesterNumber: null },
    ]);

    assert.equal(grouped.get("a")?.length, 2);
    assert.equal(grouped.get("b")?.length, 1);
    assert.equal(grouped.get("c"), undefined, "an offering with no rules is absent");
  });
});

// --- Preference ordering ----------------------------------------------------

describe("preferenceResolver — rank is honoured FIRST, always", () => {
  it("puts rank 1 ahead of rank 2 whatever the tie-breakers say", () => {
    // The rank-2 student submitted first AND scored higher. Rank still wins.
    const ordered = resolvePreferenceOrder(
      [
        candidate("late_rank1", 1, { submittedAt: at(100), cgpaScaled: 100 }),
        candidate("early_rank2", 2, { submittedAt: at(0), cgpaScaled: 900 }),
      ],
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), ["late_rank1", "early_rank2"]);
  });

  it("honours rank under FCFS too", () => {
    const ordered = resolvePreferenceOrder(
      [
        candidate("rank3", 3, { submittedAt: at(0) }),
        candidate("rank1", 1, { submittedAt: at(50) }),
      ],
      ElectiveAllocationStrategy.FCFS
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), ["rank1", "rank3"]);
  });
});

describe("preferenceResolver — FCFS", () => {
  it("breaks a rank tie by the earlier submission", () => {
    const ordered = resolvePreferenceOrder(
      [
        candidate("second", 1, { submittedAt: at(10) }),
        candidate("first", 1, { submittedAt: at(0) }),
      ],
      ElectiveAllocationStrategy.FCFS
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), ["first", "second"]);
  });

  it("IGNORES CGPA under FCFS", () => {
    const ordered = resolvePreferenceOrder(
      [
        candidate("early_low", 1, { submittedAt: at(0), cgpaScaled: 100 }),
        candidate("late_high", 1, { submittedAt: at(10), cgpaScaled: 999 }),
      ],
      ElectiveAllocationStrategy.FCFS
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), ["early_low", "late_high"]);
  });
});

describe("preferenceResolver — MERIT, and the students with no CGPA", () => {
  it("orders the graded group by CGPA descending", () => {
    const ordered = resolvePreferenceOrder(
      [
        candidate("low", 1, { cgpaScaled: 600 }),
        candidate("high", 1, { cgpaScaled: 900 }),
        candidate("mid", 1, { cgpaScaled: 750 }),
      ],
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), ["high", "mid", "low"]);
  });

  it("places EVERY ungraded student after the ENTIRE graded group", () => {
    // The Phase 19 rule, stated exactly.
    const ordered = resolvePreferenceOrder(
      [
        candidate("ungraded_early", 1, { submittedAt: at(0), cgpaScaled: null }),
        candidate("graded_low", 1, { submittedAt: at(90), cgpaScaled: 10 }),
      ],
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(
      ordered.map((entry) => entry.studentId),
      ["graded_low", "ungraded_early"],
      "an ungraded student overtook a graded one"
    );
  });

  it("orders the ungraded group among themselves by FCFS", () => {
    const ordered = resolvePreferenceOrder(
      [
        candidate("ungraded_late", 1, { submittedAt: at(10), cgpaScaled: null }),
        candidate("ungraded_early", 1, { submittedAt: at(0), cgpaScaled: null }),
      ],
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), [
      "ungraded_early",
      "ungraded_late",
    ]);
  });

  it("breaks an EXACT CGPA tie by FCFS", () => {
    const ordered = resolvePreferenceOrder(
      [
        candidate("tied_late", 1, { submittedAt: at(10), cgpaScaled: 800 }),
        candidate("tied_early", 1, { submittedAt: at(0), cgpaScaled: 800 }),
      ],
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(ordered.map((entry) => entry.studentId), ["tied_early", "tied_late"]);
  });

  it("NEVER treats a null CGPA as zero", () => {
    // A zero would rank an ungraded student against a graded one who scored
    // 0.00 — and lose to them. The null must place them after the group
    // entirely, not inside it at the bottom.
    const ordered = resolvePreferenceOrder(
      [
        candidate("ungraded", 1, { submittedAt: at(0), cgpaScaled: null }),
        candidate("scored_zero", 1, { submittedAt: at(90), cgpaScaled: 0 }),
      ],
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(
      ordered.map((entry) => entry.studentId),
      ["scored_zero", "ungraded"],
      "a null CGPA was treated as a value"
    );
  });

  it("partitions the two groups for reporting", () => {
    const { graded, ungraded } = partitionByMerit([
      candidate("a", 1, { cgpaScaled: 800 }),
      candidate("b", 1, { cgpaScaled: null }),
      candidate("c", 1, { cgpaScaled: 0 }),
    ]);

    assert.deepEqual(graded.map((entry) => entry.studentId), ["a", "c"]);
    assert.deepEqual(ungraded.map((entry) => entry.studentId), ["b"]);
  });
});

describe("preferenceResolver — determinism", () => {
  it("gives the identical order however the rows arrived", () => {
    const cohort = [
      candidate("c", 1, { submittedAt: at(0) }),
      candidate("a", 1, { submittedAt: at(0) }),
      candidate("b", 1, { submittedAt: at(0) }),
    ];

    const forward = resolvePreferenceOrder(cohort, ElectiveAllocationStrategy.FCFS);
    const reversed = resolvePreferenceOrder(
      [...cohort].reverse(),
      ElectiveAllocationStrategy.FCFS
    );

    assert.deepEqual(
      forward.map((entry) => entry.studentId),
      reversed.map((entry) => entry.studentId)
    );
    assert.deepEqual(forward.map((entry) => entry.studentId), ["a", "b", "c"]);
  });

  it("does NOT mutate the caller's array", () => {
    const cohort = [candidate("z", 1), candidate("a", 1)];

    resolvePreferenceOrder(cohort, ElectiveAllocationStrategy.FCFS);

    assert.equal(cohort[0].studentId, "z");
  });

  it("orders a thousand applicants deterministically", () => {
    const cohort = Array.from({ length: 1000 }, (_value, index) =>
      candidate(`s${String(index).padStart(4, "0")}`, (index % 3) + 1, {
        submittedAt: at(index % 7),
        cgpaScaled: index % 5 === 0 ? null : (index % 100) * 10,
      })
    );

    const first = resolvePreferenceOrder(cohort, ElectiveAllocationStrategy.MERIT);
    const second = resolvePreferenceOrder(
      [...cohort].reverse(),
      ElectiveAllocationStrategy.MERIT
    );

    assert.deepEqual(
      first.map((entry) => entry.studentId),
      second.map((entry) => entry.studentId)
    );
  });
});

// --- Seat allocation --------------------------------------------------------

describe("seatAllocator", () => {
  const queue = [candidate("a", 1), candidate("b", 1), candidate("c", 1)];

  it("awards seats from the front until they run out", () => {
    const result = allocateSeats(queue, 2, NOW);

    assert.deepEqual(
      result.verdicts.map((verdict) => verdict.outcome),
      ["ALLOCATED", "ALLOCATED", "NOT_ALLOCATED"]
    );
    assert.equal(result.awarded, 2);
    assert.equal(result.refused, 1);
    assert.equal(result.seatsRemaining, 0);
    assert.equal(result.wasOversubscribed, true);
  });

  it("gives EVERY applicant a verdict, refusals included", () => {
    // A report listing only winners cannot answer "why did I not get it".
    assert.equal(allocateSeats(queue, 1, NOW).verdicts.length, 3);
  });

  it("leaves seats remaining when demand is short", () => {
    const result = allocateSeats(queue, 10, NOW);

    assert.equal(result.awarded, 3);
    assert.equal(result.seatsRemaining, 7);
    assert.equal(result.wasOversubscribed, false);
  });

  it("refuses everyone when capacity is zero", () => {
    const result = allocateSeats(queue, 0, NOW);

    assert.equal(result.awarded, 0);
    assert.equal(result.refused, 3);
  });

  it("CLAMPS a negative capacity rather than awarding negative seats", () => {
    const result = allocateSeats(queue, -5, NOW);

    assert.equal(result.awarded, 0);
    assert.equal(result.seatsRemaining, 0);
  });

  it("does NOT re-sort the queue it was given", () => {
    // Re-sorting would be a second opinion about an ordering preferenceResolver
    // already settled, and the two could disagree.
    const result = allocateSeats([candidate("z", 1), candidate("a", 1)], 1, NOW);

    assert.equal(result.verdicts[0].studentId, "z");
  });

  it("stamps every verdict with ONE instant", () => {
    const result = allocateSeats(queue, 2, NOW);

    for (const verdict of result.verdicts) {
      assert.equal(verdict.allocatedAt, NOW);
    }
  });

  it("records queue position, 1-based", () => {
    const result = allocateSeats(queue, 3, NOW);

    assert.deepEqual(result.verdicts.map((verdict) => verdict.queuePosition), [1, 2, 3]);
  });

  it("handles an empty queue", () => {
    const result = allocateSeats([], 10, NOW);

    assert.deepEqual(result.verdicts, []);
    assert.equal(result.seatsRemaining, 10);
  });

  it("refuseAll refuses everyone", () => {
    const verdicts = refuseAll(queue, NOW);

    assert.equal(verdicts.length, 3);
    assert.ok(verdicts.every((verdict) => verdict.outcome === "NOT_ALLOCATED"));
  });
});

// --- The engine end to end --------------------------------------------------

describe("allocationEngine", () => {
  const cseRule: EligibilityRule = {
    programmeId: "prog_cse",
    specialisationId: null,
    semesterNumber: null,
  };

  it("runs eligibility, ordering and seats in that order", () => {
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 2,
      strategy: ElectiveAllocationStrategy.FCFS,
      eligibilityRules: [cseRule],
      applicants: [
        applicant("cse_early", 1, { submittedAt: at(0) }),
        applicant("cse_late", 1, { submittedAt: at(10) }),
        applicant("mech", 1, {
          submittedAt: at(0),
          profile: profile({ studentId: "mech", programmeId: "prog_mech" }),
        }),
      ],
      allocatedAt: NOW,
    });

    assert.deepEqual(awardedStudentIds(result), ["cse_early", "cse_late"]);
    assert.equal(result.ineligible.length, 1);
    assert.equal(result.ineligible[0].studentId, "mech");
  });

  it("gives an INELIGIBLE applicant a verdict, not silence", () => {
    // "I applied and heard nothing" is the complaint this design answers.
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 5,
      strategy: ElectiveAllocationStrategy.FCFS,
      eligibilityRules: [cseRule],
      applicants: [
        applicant("mech", 1, {
          profile: profile({ studentId: "mech", programmeId: "prog_mech" }),
        }),
      ],
      allocatedAt: NOW,
    });

    assert.equal(result.verdicts.length, 1);
    assert.equal(result.verdicts[0].outcome, ElectiveAllocationOutcome.NOT_ALLOCATED);
    assert.ok(result.ineligible[0].reasons.length > 0);
  });

  it("does NOT let an ineligible applicant consume a seat", () => {
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 1,
      strategy: ElectiveAllocationStrategy.FCFS,
      eligibilityRules: [cseRule],
      applicants: [
        applicant("mech_first", 1, {
          submittedAt: at(0),
          profile: profile({ studentId: "mech_first", programmeId: "prog_mech" }),
        }),
        applicant("cse_second", 1, { submittedAt: at(10) }),
      ],
      allocatedAt: NOW,
    });

    assert.deepEqual(awardedStudentIds(result), ["cse_second"]);
  });

  it("admits everyone when the offering declares no rules", () => {
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 3,
      strategy: ElectiveAllocationStrategy.FCFS,
      eligibilityRules: [],
      applicants: [
        applicant("a", 1),
        applicant("b", 1, { profile: profile({ studentId: "b", programmeId: "prog_mech" }) }),
      ],
      allocatedAt: NOW,
    });

    assert.equal(result.ineligible.length, 0);
    assert.equal(result.awarded, 2);
  });

  it("applies MERIT within a rank, and rank across ranks", () => {
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 2,
      strategy: ElectiveAllocationStrategy.MERIT,
      eligibilityRules: [],
      applicants: [
        applicant("rank2_genius", 2, { cgpaScaled: 1000 }),
        applicant("rank1_ungraded", 1, { cgpaScaled: null, submittedAt: at(5) }),
        applicant("rank1_graded", 1, { cgpaScaled: 500, submittedAt: at(9) }),
      ],
      allocatedAt: NOW,
    });

    assert.deepEqual(awardedStudentIds(result), ["rank1_graded", "rank1_ungraded"]);
  });

  it("is reproducible — the same input gives byte-identical output", () => {
    const input = {
      offeringId: "offering_1",
      totalSeats: 3,
      strategy: ElectiveAllocationStrategy.MERIT,
      eligibilityRules: [],
      applicants: [
        applicant("a", 1, { cgpaScaled: 700 }),
        applicant("b", 1, { cgpaScaled: 700 }),
        applicant("c", 2, { cgpaScaled: null }),
      ],
      allocatedAt: NOW,
    };

    assert.deepEqual(runAllocation(input), runAllocation(input));
  });

  it("allocates a thousand applicants", () => {
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 60,
      strategy: ElectiveAllocationStrategy.MERIT,
      eligibilityRules: [],
      applicants: Array.from({ length: 1000 }, (_value, index) =>
        applicant(`s${String(index).padStart(4, "0")}`, (index % 3) + 1, {
          submittedAt: at(index),
          cgpaScaled: index % 4 === 0 ? null : index,
        })
      ),
      allocatedAt: NOW,
    });

    assert.equal(result.awarded, 60);
    assert.equal(result.verdicts.length, 1000);
    assert.equal(result.wasOversubscribed, true);
  });
});

// --- Reporting --------------------------------------------------------------

describe("allocationReport", () => {
  function run(totalSeats: number) {
    return runAllocation({
      offeringId: "offering_1",
      totalSeats,
      strategy: ElectiveAllocationStrategy.MERIT,
      eligibilityRules: [],
      applicants: [
        applicant("g1", 1, { cgpaScaled: 900, submittedAt: at(0) }),
        applicant("g2", 1, { cgpaScaled: 800, submittedAt: at(1) }),
        applicant("u1", 1, { cgpaScaled: null, submittedAt: at(2) }),
        applicant("g3", 2, { cgpaScaled: 950, submittedAt: at(3) }),
      ],
      allocatedAt: NOW,
    });
  }

  it("breaks the outcome down BY RANK, so a refused rank-1 is explicable", () => {
    const summary = summariseAllocation(run(2), 2);
    const rank1 = summary.byRank.find((entry) => entry.preferenceRank === 1);

    assert.equal(rank1?.applied, 3);
    assert.equal(rank1?.awarded, 2);
    assert.equal(rank1?.refused, 1, "rank 1 was itself oversubscribed — that is the answer");
  });

  it("reports the deepest rank that still received a seat", () => {
    assert.equal(summariseAllocation(run(4), 4).deepestAwardedRank, 2);
    assert.equal(summariseAllocation(run(2), 2).deepestAwardedRank, 1);
  });

  it("reports the MERIT split, the first question of a disputed run", () => {
    // Queue under MERIT: rank 1 first (g1 900, g2 800, then the ungraded u1),
    // then rank 2 (g3, 950). Three seats therefore go to g1, g2 and u1.
    //
    // g3 has the HIGHEST CGPA in the cohort and gets nothing, because they
    // ranked the elective second. That is not a defect — it is the rule the
    // whole design was told to protect: preference order outranks merit, and
    // merit only orders students who competed at the same rank.
    const summary = summariseAllocation(run(3), 3);

    assert.equal(summary.meritSplit.gradedApplied, 3);
    assert.equal(summary.meritSplit.ungradedApplied, 1);
    assert.equal(summary.meritSplit.gradedAwarded, 2, "g3 lost on RANK, not on merit");
    assert.equal(
      summary.meritSplit.ungradedAwarded,
      1,
      "an ungraded rank-1 student rightly beat a graded rank-2 one"
    );
  });

  it("orders the rank breakdown ascending", () => {
    const summary = summariseAllocation(run(4), 4);

    assert.deepEqual(summary.byRank.map((entry) => entry.preferenceRank), [1, 2]);
  });

  it("floors remaining seats at zero for an oversubscribed run", () => {
    const summary = summariseAllocation(run(1), 1);

    assert.equal(summary.awarded, 1);
    assert.equal(summary.seatsRemaining, 0);
  });

  it("reports the declared capacity, not one inferred from the awards", () => {
    const summary = summariseAllocation(run(2), 2);

    assert.equal(summary.totalSeats, 2);
  });

  it("produces internally coherent numbers", () => {
    for (const seats of [0, 1, 2, 3, 4, 10]) {
      assert.ok(
        isSummaryCoherent(summariseAllocation(run(seats), seats)),
        `incoherent at ${seats} seats`
      );
    }
  });

  it("counts the ineligible separately from the refused-for-seats", () => {
    const result = runAllocation({
      offeringId: "offering_1",
      totalSeats: 5,
      strategy: ElectiveAllocationStrategy.FCFS,
      eligibilityRules: [
        { programmeId: "prog_cse", specialisationId: null, semesterNumber: null },
      ],
      applicants: [
        applicant("cse", 1),
        applicant("mech", 1, {
          profile: profile({ studentId: "mech", programmeId: "prog_mech" }),
        }),
      ],
      allocatedAt: NOW,
    });

    const summary = summariseAllocation(result, 5);

    assert.equal(summary.ineligible, 1);
    assert.equal(summary.awarded, 1);
    assert.equal(summary.applied, 2, "both applied, and both are accounted for");
  });

  it("handles an offering nobody applied for", () => {
    const summary = summariseAllocation(
      runAllocation({
        offeringId: "offering_1",
        totalSeats: 30,
        strategy: ElectiveAllocationStrategy.FCFS,
        eligibilityRules: [],
        applicants: [],
        allocatedAt: NOW,
      }),
      30
    );

    assert.equal(summary.applied, 0);
    assert.equal(summary.seatsRemaining, 30);
    assert.equal(summary.deepestAwardedRank, null);
    assert.deepEqual(summary.byRank, []);
  });
});

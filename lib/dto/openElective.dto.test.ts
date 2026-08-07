// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : DTO — Unit Tests
// PURPOSE: Prove the boundary conversion, and that the seat figures a client
//          sees can never contradict the rows behind them.
//
//          The seat tests carry the most weight. `seatsRemaining` is a
//          presentation of a subtraction the service performed; the mapper must
//          never invent one, must never show a negative, and an allocation
//          report's totals must be derived from the verdicts it prints rather
//          than from a separate count that could disagree with them.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ElectiveAllocationOutcome,
  ElectiveAllocationStrategy,
  OpenElectiveStatus,
} from "@/app/generated/prisma/enums";
import {
  isoDate,
  toAllocationDto,
  toAllocationReportDto,
  toEligibilityRuleDto,
  toOfferingDto,
  toPreferenceDto,
  toStudentOfferingDto,
} from "@/lib/dto/openElective.dto";

const NOW = new Date("2026-08-08T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

function offeringRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "offering_1",
    tenantId: "tenant_1",
    courseId: "course_1",
    semesterId: "sem_1",
    offeringDepartmentId: "dept_1",
    evaluationSchemeId: "scheme_1",
    totalSeats: 60,
    status: OpenElectiveStatus.OPEN,
    allocationStrategy: ElectiveAllocationStrategy.FCFS,
    statusChangedAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
    course: { id: "course_1", code: "CS301", name: "Machine Learning", credits: 3, type: "ELECTIVE" },
    semester: { id: "sem_1", name: "Semester 5" },
    department: { id: "dept_1", code: "CSE", name: "Computer Science" },
    evaluationScheme: { id: "scheme_1", code: "REG2024", version: 2 },
    ...overrides,
  } as Parameters<typeof toOfferingDto>[0];
}

function eligibilityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "elig_1",
    offeringId: "offering_1",
    programmeId: "prog_1",
    specialisationId: null,
    semesterNumber: 5,
    programme: { id: "prog_1", code: "BTECH", name: "B.Tech" },
    specialisation: null,
    ...overrides,
  } as Parameters<typeof toEligibilityRuleDto>[0];
}

function allocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "alloc_1",
    offeringId: "offering_1",
    studentId: "student_1",
    preferenceRank: 1,
    outcome: ElectiveAllocationOutcome.ALLOCATED,
    courseRegistrationId: "reg_1",
    allocatedAt: NOW,
    ...overrides,
  } as Parameters<typeof toAllocationDto>[0];
}

describe("isoDate", () => {
  it("renders a Date as ISO-8601", () => {
    assert.equal(isoDate(NOW), "2026-08-08T00:00:00.000Z");
  });

  it("preserves null and undefined alike", () => {
    assert.equal(isoDate(null), null);
    assert.equal(isoDate(undefined), null);
  });
});

describe("toOfferingDto — seats", () => {
  it("presents the subtraction the service performed", () => {
    const dto = toOfferingDto(offeringRow(), 18, []);

    assert.equal(dto.totalSeats, 60);
    assert.equal(dto.seatsRemaining, 42);
    assert.equal(dto.isFull, false);
  });

  it("reports FULL at exactly zero remaining", () => {
    const dto = toOfferingDto(offeringRow(), 60, []);

    assert.equal(dto.seatsRemaining, 0);
    assert.equal(dto.isFull, true);
  });

  it("FLOORS an oversubscribed offering at zero rather than showing a negative", () => {
    // A negative remainder is a fault to be reported, not a number to display —
    // "-3 seats left" helps nobody.
    const dto = toOfferingDto(offeringRow(), 63, []);

    assert.equal(dto.seatsRemaining, 0);
    assert.equal(dto.isFull, true, "and it is still full");
  });

  it("reports every seat free when nothing is allocated", () => {
    const dto = toOfferingDto(offeringRow(), 0, []);

    assert.equal(dto.seatsRemaining, 60);
    assert.equal(dto.isFull, false);
  });

  it("handles an offering that declared no seats", () => {
    const dto = toOfferingDto(offeringRow({ totalSeats: 0 }), 0, []);

    assert.equal(dto.seatsRemaining, 0);
    assert.equal(dto.isFull, true);
  });
});

describe("toOfferingDto — lifecycle", () => {
  it("accepts preferences ONLY while OPEN", () => {
    assert.equal(toOfferingDto(offeringRow(), 0, []).acceptsPreferences, true);

    for (const status of [
      OpenElectiveStatus.DRAFT,
      OpenElectiveStatus.LOCKED,
      OpenElectiveStatus.ALLOCATED,
    ]) {
      assert.equal(
        toOfferingDto(offeringRow({ status }), 0, []).acceptsPreferences,
        false,
        status
      );
    }
  });

  it("derives acceptsPreferences so a client need not restate the rule", () => {
    const dto = toOfferingDto(offeringRow({ status: OpenElectiveStatus.LOCKED }), 0, []);

    assert.equal(dto.status, OpenElectiveStatus.LOCKED);
    assert.equal(dto.acceptsPreferences, false);
  });
});

describe("toOfferingDto — composition", () => {
  it("flattens the course, semester and department", () => {
    const dto = toOfferingDto(offeringRow(), 0, []);

    assert.equal(dto.course.code, "CS301");
    assert.equal(dto.course.credits, 3);
    assert.equal(dto.semesterName, "Semester 5");
    assert.equal(dto.offeringDepartmentName, "Computer Science");
  });

  it("carries the regulation that will grade it", () => {
    // The offering department's scheme, per the Phase 19 decision.
    const dto = toOfferingDto(offeringRow(), 0, []);

    assert.equal(dto.evaluationSchemeCode, "REG2024");
    assert.equal(dto.evaluationSchemeVersion, 2);
  });

  it("reports NO eligibility rules as an empty list, meaning unrestricted", () => {
    const dto = toOfferingDto(offeringRow(), 0, []);

    assert.deepEqual(dto.eligibility, []);
  });

  it("carries the rules when there are any", () => {
    const dto = toOfferingDto(offeringRow(), 0, [eligibilityRow()]);

    assert.equal(dto.eligibility.length, 1);
    assert.equal(dto.eligibility[0].programmeName, "B.Tech");
    assert.equal(dto.eligibility[0].semesterNumber, 5);
  });

  it("carries NO Prisma value across the boundary", () => {
    const dto = toOfferingDto(offeringRow(), 0, []);

    assert.equal(typeof dto.statusChangedAt, "string");
    assert.equal(typeof dto.createdAt, "string");
  });

  it("round-trips through JSON unchanged", () => {
    const dto = toOfferingDto(offeringRow(), 12, [eligibilityRow()]);

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});

describe("toEligibilityRuleDto — a null means ANY", () => {
  it("preserves each null rather than substituting a value", () => {
    const rule = toEligibilityRuleDto(
      eligibilityRow({
        programmeId: null,
        programme: null,
        specialisationId: null,
        specialisation: null,
        semesterNumber: null,
      })
    );

    assert.equal(rule.programmeId, null);
    assert.equal(rule.specialisationId, null);
    assert.equal(rule.semesterNumber, null);
  });

  it("resolves a branch to its Specialisation name", () => {
    // "Branch" is Specialisation, per the Phase 19 decision.
    const rule = toEligibilityRuleDto(
      eligibilityRow({
        specialisationId: "spec_1",
        specialisation: { id: "spec_1", code: "AIML", name: "AI & ML" },
      })
    );

    assert.equal(rule.specialisationName, "AI & ML");
  });

  it("survives a rule whose relation was not loaded", () => {
    const rule = toEligibilityRuleDto(eligibilityRow({ programme: null }));

    assert.equal(rule.programmeId, "prog_1");
    assert.equal(rule.programmeName, null);
  });
});

describe("toStudentOfferingDto — the per-caller facts", () => {
  it("extends the shared shape rather than replacing it", () => {
    const base = toOfferingDto(offeringRow(), 10, []);
    const dto = toStudentOfferingDto(base, true, [], 2);

    assert.equal(dto.seatsRemaining, 50, "the shared figures survive");
    assert.equal(dto.isEligible, true);
    assert.equal(dto.preferenceRank, 2);
  });

  it("carries the reasons a student is refused", () => {
    const base = toOfferingDto(offeringRow(), 0, []);
    const dto = toStudentOfferingDto(base, false, ["Programme not permitted"], null);

    assert.equal(dto.isEligible, false);
    assert.deepEqual(dto.ineligibilityReasons, ["Programme not permitted"]);
  });

  it("reports a null rank for an offering the student has not chosen", () => {
    const base = toOfferingDto(offeringRow(), 0, []);

    assert.equal(toStudentOfferingDto(base, true, [], null).preferenceRank, null);
  });

  it("does not mutate the base it was given", () => {
    const base = toOfferingDto(offeringRow(), 0, []);
    toStudentOfferingDto(base, false, ["x"], 1);

    assert.equal("isEligible" in base, false);
  });
});

describe("toPreferenceDto", () => {
  it("carries the rank and the submission instant", () => {
    const dto = toPreferenceDto({
      id: "pref_1",
      studentId: "student_1",
      offeringId: "offering_1",
      semesterId: "sem_1",
      preferenceRank: 1,
      submittedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });

    assert.equal(dto.preferenceRank, 1);
    assert.equal(dto.submittedAt, "2026-08-08T00:00:00.000Z");
  });

  it("does not echo studentId back to the student who asked", () => {
    const dto = toPreferenceDto({
      id: "pref_1",
      studentId: "student_1",
      offeringId: "offering_1",
      semesterId: "sem_1",
      preferenceRank: 1,
      submittedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });

    assert.equal("studentId" in dto, false);
  });
});

describe("toAllocationDto", () => {
  it("carries the registration an award produced", () => {
    assert.equal(toAllocationDto(allocationRow()).courseRegistrationId, "reg_1");
  });

  it("carries a null registration for a refusal", () => {
    const dto = toAllocationDto(
      allocationRow({
        outcome: ElectiveAllocationOutcome.NOT_ALLOCATED,
        courseRegistrationId: null,
      })
    );

    assert.equal(dto.outcome, ElectiveAllocationOutcome.NOT_ALLOCATED);
    assert.equal(dto.courseRegistrationId, null);
  });

  it("records the rank a REFUSAL answers", () => {
    // "You were refused at rank 1" and "at rank 4" are different answers to the
    // same complaint.
    const dto = toAllocationDto(
      allocationRow({ outcome: ElectiveAllocationOutcome.NOT_ALLOCATED, preferenceRank: 4 })
    );

    assert.equal(dto.preferenceRank, 4);
  });
});

describe("toAllocationReportDto", () => {
  const rows = [
    allocationRow({ id: "a1", studentId: "s1" }),
    allocationRow({ id: "a2", studentId: "s2" }),
    allocationRow({
      id: "a3",
      studentId: "s3",
      outcome: ElectiveAllocationOutcome.NOT_ALLOCATED,
      courseRegistrationId: null,
    }),
  ];

  it("derives its totals FROM the verdicts it prints", () => {
    // A report whose header disagreed with its own rows would be unusable.
    const report = toAllocationReportDto("offering_1", 60, rows);

    assert.equal(report.allocated, 2);
    assert.equal(report.notAllocated, 1);
    assert.equal(report.allocations.length, 3);
    assert.equal(report.allocated + report.notAllocated, report.allocations.length);
  });

  it("computes remaining seats from the awards, not from a separate count", () => {
    const report = toAllocationReportDto("offering_1", 60, rows);

    assert.equal(report.seatsRemaining, 58);
  });

  it("INCLUDES refusals — a report without them explains nothing", () => {
    const report = toAllocationReportDto("offering_1", 60, rows);
    const refused = report.allocations.filter(
      (entry) => entry.outcome === ElectiveAllocationOutcome.NOT_ALLOCATED
    );

    assert.equal(refused.length, 1);
  });

  it("floors remaining at zero for an oversubscribed offering", () => {
    const many = Array.from({ length: 5 }, (_value, index) =>
      allocationRow({ id: `a${index}`, studentId: `s${index}` })
    );

    const report = toAllocationReportDto("offering_1", 3, many);

    assert.equal(report.allocated, 5);
    assert.equal(report.seatsRemaining, 0);
  });

  it("handles an offering nobody applied for", () => {
    const report = toAllocationReportDto("offering_1", 60, []);

    assert.equal(report.allocated, 0);
    assert.equal(report.notAllocated, 0);
    assert.equal(report.seatsRemaining, 60);
    assert.deepEqual(report.allocations, []);
  });

  it("round-trips through JSON unchanged", () => {
    const report = toAllocationReportDto("offering_1", 60, rows);

    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  });
});

// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the lifecycle gates, the dual-mode authorisation, and that the
//          service DELEGATES allocation rather than performing it.
//
//          The service depends on a repository type and four narrow ports, so
//          all of this runs with no database and no environment. The ports
//          record what they were asked, which is how "no duplicated logic" is
//          tested rather than asserted: enrolment must go through
//          CourseRegistrationService, and the offering's own scheme must reach
//          it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import {
  ElectiveAllocationStrategy,
  OpenElectiveStatus,
} from "@/app/generated/prisma/enums";
import { canTransition } from "@/lib/constants/openElective";
import { OpenElectiveService } from "@/lib/services/openElective.service";
import type { OpenElectiveRepository } from "@/lib/repositories/openElective.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const OFFERING_ID = "offering_1";
const SEMESTER_ID = "sem_1";
const NOW = new Date("2026-08-08T12:00:00.000Z");

// --- Fixtures ---------------------------------------------------------------

function offeringRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OFFERING_ID,
    tenantId: TENANT_ID,
    courseId: "course_1",
    semesterId: SEMESTER_ID,
    offeringDepartmentId: "dept_1",
    evaluationSchemeId: "scheme_offering_dept",
    totalSeats: 2,
    status: OpenElectiveStatus.OPEN,
    allocationStrategy: ElectiveAllocationStrategy.FCFS,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    course: { id: "course_1", code: "CS301", name: "ML", credits: 3, type: "ELECTIVE" },
    semester: { id: SEMESTER_ID, name: "Semester 5" },
    department: { id: "dept_1", code: "CSE", name: "Computer Science" },
    evaluationScheme: { id: "scheme_offering_dept", code: "REG2024", version: 1 },
    ...overrides,
  };
}

function preferenceRow(studentId: string, rank: number, minutes = 0) {
  return {
    id: `pref_${studentId}`,
    studentId,
    offeringId: OFFERING_ID,
    semesterId: SEMESTER_ID,
    preferenceRank: rank,
    submittedAt: new Date(NOW.getTime() + minutes * 60_000),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface FakeData {
  offering?: unknown;
  offerings?: unknown[];
  eligibility?: unknown[];
  studentPreferences?: unknown[];
  offeringPreferences?: unknown[];
  allocations?: unknown[];
  listPage?: { rows: unknown[]; total: number };
  seatCounts?: unknown[];
  own?: { id: string } | null;
  profiles?: unknown[];
  cgpa?: Map<string, number | null>;
  roster?: { id: string; studentId: string }[];
}

function build(data: FakeData = {}) {
  const calls: string[] = [];
  const enrolments: Record<string, unknown>[] = [];
  const writtenAllocations: Record<string, unknown>[][] = [];
  const statusWrites: string[] = [];

  const repository = {
    async listOfferings() {
      calls.push("listOfferings");
      return data.listPage ?? { rows: [offeringRow()], total: 1 };
    },
    async findOfferingById() {
      calls.push("findOfferingById");
      return data.offering === undefined ? offeringRow() : data.offering;
    },
    async findOfferingsByIds() {
      calls.push("findOfferingsByIds");
      return data.offerings ?? [offeringRow()];
    },
    async findEligibility() {
      calls.push("findEligibility");
      return data.eligibility ?? [];
    },
    async findStudentPreferences() {
      calls.push("findStudentPreferences");
      return data.studentPreferences ?? [];
    },
    async findOfferingPreferences() {
      calls.push("findOfferingPreferences");
      return data.offeringPreferences ?? [];
    },
    async findStudentAllocations() {
      calls.push("findStudentAllocations");
      return data.allocations ?? [];
    },
    async findAllocations() {
      calls.push("findAllocations");
      return data.allocations ?? [];
    },
    async countAllocated() {
      calls.push("countAllocated");
      return 0;
    },
    async countAllocatedForOfferings() {
      calls.push("countAllocatedForOfferings");
      return data.seatCounts ?? [];
    },
    async replacePreferences(
      _t: string,
      _s: string,
      _sem: string,
      rows: readonly unknown[]
    ) {
      calls.push("replacePreferences");
      return rows.length;
    },
    async deleteAllocations() {
      calls.push("deleteAllocations");
      return 0;
    },
    async createAllocations(rows: Record<string, unknown>[]) {
      calls.push("createAllocations");
      writtenAllocations.push(rows);
      return rows.length;
    },
    async updateOfferingStatus(_t: string, _o: string, status: string) {
      calls.push("updateOfferingStatus");
      statusWrites.push(status);
      return offeringRow({ status });
    },
    async transaction<T>(fn: (client: unknown) => Promise<T>) {
      calls.push("transaction");
      return fn({});
    },
  } as unknown as OpenElectiveRepository;

  const students = {
    async findStudentByUserId() {
      calls.push("findStudentByUserId");
      return data.own === undefined ? { id: STUDENT_ID } : data.own;
    },
    async findStudentProfiles() {
      calls.push("findStudentProfiles");
      return (
        data.profiles ?? [
          {
            id: STUDENT_ID,
            programmeId: "prog_cse",
            specialisationId: "spec_aiml",
            currentSemester: 5,
          },
        ]
      );
    },
  };

  const merit = {
    async findCgpaScaled() {
      calls.push("findCgpaScaled");
      return data.cgpa ?? new Map<string, number | null>();
    },
  };

  const enrolment = {
    async registerBulk(_tenantId: string, input: Record<string, unknown>) {
      calls.push("registerBulk");
      enrolments.push(input);
      return { registeredCount: (input.studentIds as string[]).length };
    },
  };

  const roster = {
    async findRoster() {
      calls.push("findRoster");
      return data.roster ?? [];
    },
  };

  const service = new OpenElectiveService(
    repository,
    students as never,
    merit as never,
    enrolment as never,
    roster as never
  );

  return { service, calls, enrolments, writtenAllocations, statusWrites };
}

async function expectAppError(run: () => Promise<unknown>, status: number): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    assert.equal(error.statusCode, status);
    return error;
  }

  throw new Error(`expected a ${status}`);
}

const STAFF = { scope: "STAFF" } as const;
const STUDENT = { scope: "STUDENT", userId: USER_ID } as const;

// --- Dual-mode authorisation ------------------------------------------------

describe("OpenElectiveService — dual-mode access", () => {
  it("serves STAFF the plain catalogue, without resolving a student", async () => {
    const { service, calls } = build();
    const page = await service.listOfferings(TENANT_ID, { page: 1, limit: 20 }, STAFF);

    assert.equal(page.offerings.length, 1);
    assert.equal(calls.includes("findStudentByUserId"), false, "staff need no student row");
  });

  it("annotates a STUDENT's catalogue with their own eligibility", async () => {
    const { service } = build({
      eligibility: [
        {
          id: "e1",
          offeringId: OFFERING_ID,
          programmeId: "prog_cse",
          specialisationId: null,
          semesterNumber: null,
          programme: null,
          specialisation: null,
        },
      ],
    });

    const page = await service.listOfferings(TENANT_ID, { page: 1, limit: 20 }, STUDENT);
    const first = page.offerings[0] as { isEligible: boolean };

    assert.equal(first.isEligible, true);
  });

  it("marks an ineligible offering with reasons rather than hiding it", async () => {
    const { service } = build({
      profiles: [
        {
          id: STUDENT_ID,
          programmeId: "prog_mech",
          specialisationId: null,
          currentSemester: 5,
        },
      ],
      eligibility: [
        {
          id: "e1",
          offeringId: OFFERING_ID,
          programmeId: "prog_cse",
          specialisationId: null,
          semesterNumber: null,
          programme: null,
          specialisation: null,
        },
      ],
    });

    const page = await service.listOfferings(TENANT_ID, { page: 1, limit: 20 }, STUDENT);
    const first = page.offerings[0] as { isEligible: boolean; ineligibilityReasons: string[] };

    assert.equal(first.isEligible, false);
    assert.ok(first.ineligibilityReasons.length > 0);
  });

  it("FORBIDS a caller with a permitted role but no Student row", async () => {
    const { service } = build({ own: null });

    await expectAppError(
      () => service.listOfferings(TENANT_ID, { page: 1, limit: 20 }, STUDENT),
      403
    );
  });

  it("forbids that caller on every student method", async () => {
    const { service } = build({ own: null });

    await expectAppError(() => service.getStatus(TENANT_ID, USER_ID, SEMESTER_ID), 403);
    await expectAppError(
      () =>
        service.submitPreferences(
          TENANT_ID,
          USER_ID,
          { semesterId: SEMESTER_ID, preferences: [{ offeringId: OFFERING_ID, preferenceRank: 1 }] },
          NOW
        ),
      403
    );
  });
});

// --- Preference submission --------------------------------------------------

describe("OpenElectiveService — submitPreferences", () => {
  const body = {
    semesterId: SEMESTER_ID,
    preferences: [{ offeringId: OFFERING_ID, preferenceRank: 1 }],
  };

  it("records a valid submission", async () => {
    const { service, calls } = build({
      studentPreferences: [preferenceRow(STUDENT_ID, 1)],
    });

    const result = await service.submitPreferences(TENANT_ID, USER_ID, body, NOW);

    assert.equal(result.recorded, 1);
    assert.equal(result.studentId, STUDENT_ID);
    assert.ok(calls.includes("replacePreferences"));
  });

  it("REFUSES a choice whose offering is not OPEN", async () => {
    for (const status of [
      OpenElectiveStatus.DRAFT,
      OpenElectiveStatus.LOCKED,
      OpenElectiveStatus.ALLOCATED,
    ]) {
      const { service } = build({ offerings: [offeringRow({ status })] });

      await expectAppError(() => service.submitPreferences(TENANT_ID, USER_ID, body, NOW), 409);
    }
  });

  it("REFUSES a choice from a different semester", async () => {
    const { service } = build({ offerings: [offeringRow({ semesterId: "sem_other" })] });

    await expectAppError(() => service.submitPreferences(TENANT_ID, USER_ID, body, NOW), 422);
  });

  it("raises 404 for an offering that does not resolve", async () => {
    const { service } = build({ offerings: [] });

    await expectAppError(() => service.submitPreferences(TENANT_ID, USER_ID, body, NOW), 404);
  });

  it("REFUSES an ineligible student at SELECTION, not at allocation", async () => {
    // Telling them at allocation time is the worse of two moments to find out.
    const { service } = build({
      profiles: [
        { id: STUDENT_ID, programmeId: "prog_mech", specialisationId: null, currentSemester: 5 },
      ],
      eligibility: [
        {
          id: "e1",
          offeringId: OFFERING_ID,
          programmeId: "prog_cse",
          specialisationId: null,
          semesterNumber: null,
          programme: null,
          specialisation: null,
        },
      ],
    });

    await expectAppError(() => service.submitPreferences(TENANT_ID, USER_ID, body, NOW), 403);
  });

  it("writes inside ONE transaction", async () => {
    const { service, calls } = build();

    await service.submitPreferences(TENANT_ID, USER_ID, body, NOW);

    assert.ok(calls.includes("transaction"));
  });

  it("stamps every choice with the SAME instant, for FCFS", async () => {
    const { service } = build({
      studentPreferences: [preferenceRow(STUDENT_ID, 1), preferenceRow(STUDENT_ID, 2)],
    });

    const result = await service.submitPreferences(
      TENANT_ID,
      USER_ID,
      {
        semesterId: SEMESTER_ID,
        preferences: [
          { offeringId: OFFERING_ID, preferenceRank: 1 },
          { offeringId: OFFERING_ID, preferenceRank: 2 },
        ],
      },
      NOW
    );

    assert.equal(result.recorded, 2);
  });
});

// --- Lifecycle --------------------------------------------------------------

describe("OpenElectiveService — lifecycle", () => {
  it("locks an OPEN offering", async () => {
    const { service, statusWrites } = build({ offering: offeringRow({ status: "OPEN" }) });

    const locked = await service.lock(TENANT_ID, { offeringId: OFFERING_ID }, NOW);

    assert.equal(locked.status, OpenElectiveStatus.LOCKED);
    assert.deepEqual(statusWrites, [OpenElectiveStatus.LOCKED]);
  });

  it("REFUSES to lock a DRAFT offering", async () => {
    const { service } = build({ offering: offeringRow({ status: "DRAFT" }) });

    await expectAppError(() => service.lock(TENANT_ID, { offeringId: OFFERING_ID }, NOW), 409);
  });

  it("REFUSES to lock an ALLOCATED offering — ALLOCATED is terminal", async () => {
    const { service } = build({ offering: offeringRow({ status: "ALLOCATED" }) });

    await expectAppError(() => service.lock(TENANT_ID, { offeringId: OFFERING_ID }, NOW), 409);
  });

  it("raises 404 for an offering outside the tenant", async () => {
    const { service } = build({ offering: null });

    await expectAppError(() => service.lock(TENANT_ID, { offeringId: OFFERING_ID }, NOW), 404);
  });

  it("reads its rules from the transition table, not from inline checks", () => {
    assert.equal(canTransition(OpenElectiveStatus.OPEN, OpenElectiveStatus.LOCKED), true);
    assert.equal(canTransition(OpenElectiveStatus.DRAFT, OpenElectiveStatus.LOCKED), false);
    assert.equal(canTransition(OpenElectiveStatus.ALLOCATED, OpenElectiveStatus.OPEN), false);
    assert.deepEqual(
      canTransition(OpenElectiveStatus.LOCKED, OpenElectiveStatus.ALLOCATED),
      true
    );
  });
});

// --- Allocation -------------------------------------------------------------

describe("OpenElectiveService — allocate", () => {
  function allocatable(data: FakeData = {}) {
    return build({
      offering: offeringRow({ status: OpenElectiveStatus.LOCKED }),
      offeringPreferences: [
        preferenceRow("s1", 1, 0),
        preferenceRow("s2", 1, 5),
        preferenceRow("s3", 1, 10),
      ],
      profiles: [
        { id: "s1", programmeId: "prog_cse", specialisationId: null, currentSemester: 5 },
        { id: "s2", programmeId: "prog_cse", specialisationId: null, currentSemester: 5 },
        { id: "s3", programmeId: "prog_cse", specialisationId: null, currentSemester: 5 },
      ],
      roster: [
        { id: "reg_s1", studentId: "s1" },
        { id: "reg_s2", studentId: "s2" },
      ],
      ...data,
    });
  }

  it("REFUSES to allocate an offering that is not LOCKED", async () => {
    // Allocating against a set that can still move would make the result
    // unreproducible — which is why LOCKED precedes ALLOCATED.
    for (const status of [OpenElectiveStatus.DRAFT, OpenElectiveStatus.OPEN]) {
      const { service } = build({ offering: offeringRow({ status }) });

      await expectAppError(
        () => service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW),
        409
      );
    }
  });

  it("REFUSES a re-run without force", async () => {
    const { service } = build({ offering: offeringRow({ status: "ALLOCATED" }) });

    await expectAppError(
      () => service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW),
      409
    );
  });

  it("PERMITS a re-run with force, clearing the previous verdicts first", async () => {
    const { service, calls } = allocatable({
      offering: offeringRow({ status: "ALLOCATED" }),
    });

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: true }, USER_ID, NOW);

    assert.ok(calls.includes("deleteAllocations"), "the previous run was not cleared");
  });

  it("writes a verdict for EVERY applicant, refusals included", async () => {
    const { service, writtenAllocations } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    // Two seats, three applicants.
    assert.equal(writtenAllocations[0].length, 3);

    const outcomes = writtenAllocations[0].map((row) => row.outcome);

    assert.equal(outcomes.filter((outcome) => outcome === "ALLOCATED").length, 2);
    assert.equal(outcomes.filter((outcome) => outcome === "NOT_ALLOCATED").length, 1);
  });

  it("DELEGATES enrolment to CourseRegistrationService", async () => {
    const { service, calls } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.ok(calls.includes("registerBulk"), "the service wrote registrations itself");
  });

  it("passes the OFFERING DEPARTMENT's scheme to the enrolment", async () => {
    // The Phase 19 decision: an open elective is graded by the department that
    // offers it, not by the student's own programme.
    const { service, enrolments } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.equal(enrolments[0].evaluationSchemeId, "scheme_offering_dept");
    assert.equal(enrolments[0].registrationType, "OPEN_ELECTIVE");
  });

  it("enrols ONLY the awarded students", async () => {
    const { service, enrolments } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.equal((enrolments[0].studentIds as string[]).length, 2);
  });

  it("LINKS each award to the registration it produced", async () => {
    const { service, writtenAllocations } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    const awarded = writtenAllocations[0].filter((row) => row.outcome === "ALLOCATED");

    for (const row of awarded) {
      assert.ok(row.courseRegistrationId, "an award has no registration linked");
    }
  });

  it("leaves a REFUSAL with no registration", async () => {
    const { service, writtenAllocations } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    const refused = writtenAllocations[0].filter((row) => row.outcome === "NOT_ALLOCATED");

    assert.equal(refused[0].courseRegistrationId, null);
  });

  it("moves the offering to ALLOCATED", async () => {
    const { service, statusWrites } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.deepEqual(statusWrites, [OpenElectiveStatus.ALLOCATED]);
  });

  it("does everything inside ONE transaction", async () => {
    const { service, calls } = allocatable();

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.equal(calls.filter((call) => call === "transaction").length, 1);
  });

  it("enrols NOBODY when every applicant is ineligible", async () => {
    const { service, calls, writtenAllocations } = allocatable({
      eligibility: [
        {
          id: "e1",
          offeringId: OFFERING_ID,
          programmeId: "prog_other",
          specialisationId: null,
          semesterNumber: null,
          programme: null,
          specialisation: null,
        },
      ],
    });

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.equal(calls.includes("registerBulk"), false);
    assert.equal(writtenAllocations[0].length, 3, "but all three still get a verdict");
  });

  it("handles an offering nobody applied for", async () => {
    const { service, calls } = allocatable({ offeringPreferences: [] });

    const report = await service.allocate(
      TENANT_ID,
      { offeringId: OFFERING_ID, force: false },
      USER_ID,
      NOW
    );

    assert.equal(report.allocated, 0);
    assert.equal(calls.includes("registerBulk"), false);
  });

  it("refuses a cohort beyond the bound rather than allocating a slice", async () => {
    const { service } = allocatable({
      offeringPreferences: Array.from({ length: 5001 }, (_value, index) =>
        preferenceRow(`s${index}`, 1, index)
      ),
    });

    await expectAppError(
      () => service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW),
      422
    );
  });

  it("never invents a CGPA for a student who has none", async () => {
    // The merit port returns an empty map; the service must read that as null
    // and pass null to the engine, not a zero.
    const { service, writtenAllocations } = allocatable({
      offering: offeringRow({
        status: OpenElectiveStatus.LOCKED,
        allocationStrategy: ElectiveAllocationStrategy.MERIT,
      }),
      cgpa: new Map<string, number | null>(),
    });

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    // With nobody graded, MERIT degrades to FCFS within the rank: s1 and s2
    // submitted earliest and take the two seats.
    const awarded = writtenAllocations[0]
      .filter((row) => row.outcome === "ALLOCATED")
      .map((row) => row.studentId);

    assert.deepEqual(awarded.sort(), ["s1", "s2"]);
  });

  it("orders by MERIT when CGPAs ARE supplied", async () => {
    const { service, writtenAllocations } = allocatable({
      offering: offeringRow({
        status: OpenElectiveStatus.LOCKED,
        allocationStrategy: ElectiveAllocationStrategy.MERIT,
      }),
      cgpa: new Map<string, number | null>([
        ["s1", 100],
        ["s2", 900],
        ["s3", 800],
      ]),
      roster: [
        { id: "reg_s2", studentId: "s2" },
        { id: "reg_s3", studentId: "s3" },
      ],
    });

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    const awarded = writtenAllocations[0]
      .filter((row) => row.outcome === "ALLOCATED")
      .map((row) => row.studentId);

    assert.deepEqual(
      awarded.sort(),
      ["s2", "s3"],
      "the earliest submitter lost to two higher scores"
    );
  });
});

// --- Status -----------------------------------------------------------------

describe("OpenElectiveService — getStatus", () => {
  it("returns a student's own choices and verdicts", async () => {
    const { service } = build({
      studentPreferences: [preferenceRow(STUDENT_ID, 1)],
      allocations: [],
    });

    const status = await service.getStatus(TENANT_ID, USER_ID, SEMESTER_ID);

    assert.equal(status.studentId, STUDENT_ID);
    assert.equal(status.preferences.length, 1);
    assert.equal(status.isAllocated, false);
  });

  it("reports allocated once a verdict exists", async () => {
    const { service } = build({
      studentPreferences: [preferenceRow(STUDENT_ID, 1)],
      allocations: [
        {
          id: "alloc_1",
          offeringId: OFFERING_ID,
          studentId: STUDENT_ID,
          preferenceRank: 1,
          outcome: "ALLOCATED",
          courseRegistrationId: "reg_1",
          allocatedAt: NOW,
        },
      ],
    });

    const status = await service.getStatus(TENANT_ID, USER_ID, SEMESTER_ID);

    assert.equal(status.isAllocated, true);
    assert.equal(status.isEditable, false, "an allocated result is not editable");
  });

  it("is editable while a chosen offering is still OPEN", async () => {
    const { service } = build({
      studentPreferences: [preferenceRow(STUDENT_ID, 1)],
      offerings: [offeringRow({ status: OpenElectiveStatus.OPEN })],
      allocations: [],
    });

    const status = await service.getStatus(TENANT_ID, USER_ID, SEMESTER_ID);

    assert.equal(status.isEditable, true);
  });

  it("is NOT editable once every chosen offering is locked", async () => {
    const { service } = build({
      studentPreferences: [preferenceRow(STUDENT_ID, 1)],
      offerings: [offeringRow({ status: OpenElectiveStatus.LOCKED })],
      allocations: [],
    });

    const status = await service.getStatus(TENANT_ID, USER_ID, SEMESTER_ID);

    assert.equal(status.isEditable, false);
  });

  it("returns empty collections for a student who chose nothing", async () => {
    const { service } = build({ studentPreferences: [], allocations: [] });

    const status = await service.getStatus(TENANT_ID, USER_ID, SEMESTER_ID);

    assert.deepEqual(status.preferences, []);
    assert.deepEqual(status.allocations, []);
  });
});

// --- Query budget -----------------------------------------------------------

describe("OpenElectiveService — the catalogue does not become an N+1", () => {
  it("costs a FIXED number of reads however many offerings a page holds", async () => {
    const small = build({ listPage: { rows: [offeringRow()], total: 1 } });
    const large = build({
      listPage: {
        rows: Array.from({ length: 40 }, (_value, index) =>
          offeringRow({ id: `offering_${index}` })
        ),
        total: 40,
      },
    });

    await small.service.listOfferings(TENANT_ID, { page: 1, limit: 40 }, STAFF);
    await large.service.listOfferings(TENANT_ID, { page: 1, limit: 40 }, STAFF);

    assert.equal(
      small.calls.length,
      large.calls.length,
      "forty offerings cost more reads than one"
    );
  });

  it("reads eligibility and seat counts ONCE for the whole page", async () => {
    const { service, calls } = build({
      listPage: {
        rows: Array.from({ length: 40 }, (_value, index) =>
          offeringRow({ id: `offering_${index}` })
        ),
        total: 40,
      },
    });

    await service.listOfferings(TENANT_ID, { page: 1, limit: 40 }, STAFF);

    assert.equal(calls.filter((call) => call === "findEligibility").length, 1);
    assert.equal(calls.filter((call) => call === "countAllocatedForOfferings").length, 1);
  });

  it("reads the cohort's profiles and CGPAs ONCE per allocation", async () => {
    const { service, calls } = build({
      offering: offeringRow({ status: OpenElectiveStatus.LOCKED }),
      offeringPreferences: Array.from({ length: 200 }, (_value, index) =>
        preferenceRow(`s${index}`, 1, index)
      ),
      profiles: Array.from({ length: 200 }, (_value, index) => ({
        id: `s${index}`,
        programmeId: "prog_cse",
        specialisationId: null,
        currentSemester: 5,
      })),
    });

    await service.allocate(TENANT_ID, { offeringId: OFFERING_ID, force: false }, USER_ID, NOW);

    assert.equal(calls.filter((call) => call === "findStudentProfiles").length, 1);
    assert.equal(calls.filter((call) => call === "findCgpaScaled").length, 1);
  });
});

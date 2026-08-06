// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify what every query ASKS OF THE DATABASE.
//
//          A repository holds no logic, so the meaningful questions are
//          structural — and here each is a correctness or security property:
//
//            • is every query scoped by tenant?
//            • does the catalogue avoid an N+1 across forty offerings?
//            • is the allocation input read in RANK-then-SUBMISSION order, so a
//              run needs no sort of its own?
//            • does a status write carry its OWN tenant predicate rather than
//              inheriting one from a preceding read?
//            • does the repository decide NOTHING about seats or eligibility?
//
//          Every method takes an injectable client, so all of it runs with no
//          database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ElectiveAllocationOutcome,
  OpenElectiveStatus,
} from "@/app/generated/prisma/enums";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";
import {
  ALLOCATION_SELECT,
  ELIGIBILITY_SELECT,
  OFFERING_ORDER_BY,
  OFFERING_SELECT,
  OpenElectiveRepository,
  PREFERENCE_ORDER_BY,
  PREFERENCE_SELECT,
  PREFERENCE_WRITABLE_STATUS,
  SEAT_CONSUMING_OUTCOME,
  type DbClient,
} from "@/lib/repositories/openElective.repository";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const OFFERING_ID = "offering_1";
const STUDENT_ID = "student_1";
const SEMESTER_ID = "semester_1";
const NOW = new Date("2026-08-08T00:00:00.000Z");

const repository = new OpenElectiveRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

const PAGE = { page: 1, limit: 20 };

// --- Tenant isolation -------------------------------------------------------

describe("OpenElectiveRepository — tenant isolation", () => {
  it("scopes the catalogue by tenant", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, PAGE, db);

    assert.equal(
      whereOf(client.onlyCallTo("openElectiveOffering", "findMany").args).tenantId,
      TENANT_ID
    );
  });

  it("scopes the COUNT by the identical predicate as the page", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, { ...PAGE, semesterId: SEMESTER_ID }, db);

    assert.deepEqual(
      whereOf(client.onlyCallTo("openElectiveOffering", "count").args),
      whereOf(client.onlyCallTo("openElectiveOffering", "findMany").args)
    );
  });

  it("folds the tenant into a single-offering lookup rather than checking after", async () => {
    // A caller able to distinguish "found but not yours" from "not found" would
    // learn that another tenant's offering exists.
    const { client, db } = fake();

    await repository.findOfferingById(TENANT_ID, OFFERING_ID, db);

    const where = whereOf(client.onlyCallTo("openElectiveOffering", "findFirst").args);

    assert.equal(where.id, OFFERING_ID);
    assert.equal(where.tenantId, TENANT_ID);
  });

  it("uses findFirst, never findUnique, for the tenant-scoped lookup", async () => {
    const { client, db } = fake();

    await repository.findOfferingById(TENANT_ID, OFFERING_ID, db);

    assert.equal(client.callsTo("openElectiveOffering", "findUnique").length, 0);
  });

  it("carries the caller's OWN tenant, never a substituted one", async () => {
    const { client, db } = fake();

    await repository.listOfferings(OTHER_TENANT, PAGE, db);

    assert.equal(
      whereOf(client.onlyCallTo("openElectiveOffering", "findMany").args).tenantId,
      OTHER_TENANT
    );
  });

  it("scopes EVERY read by tenant", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, PAGE, db);
    await repository.findOfferingById(TENANT_ID, OFFERING_ID, db);
    await repository.findEligibility(TENANT_ID, [OFFERING_ID], db);
    await repository.findStudentPreferences(TENANT_ID, STUDENT_ID, SEMESTER_ID, db);
    await repository.findOfferingPreferences(TENANT_ID, OFFERING_ID, db);
    await repository.findOfferingsByIds(TENANT_ID, [OFFERING_ID], db);
    await repository.countAllocated(TENANT_ID, OFFERING_ID, db);
    await repository.countAllocatedForOfferings(TENANT_ID, [OFFERING_ID], db);
    await repository.findAllocations(TENANT_ID, OFFERING_ID, db);
    await repository.findStudentAllocations(TENANT_ID, STUDENT_ID, SEMESTER_ID, db);

    assert.ok(client.calls.length > 0);

    for (const call of client.calls) {
      assert.equal(
        whereOf(call.args).tenantId,
        TENANT_ID,
        `${call.model}.${call.operation} is not tenant-scoped`
      );
    }
  });

  it("writes a status change with its OWN tenant predicate", async () => {
    // The compound selector carries the tenant rather than inheriting it from a
    // preceding read — the TOCTOU defence Phase 16 established.
    const { client, db } = fake();

    await repository.updateOfferingStatus(
      TENANT_ID,
      OFFERING_ID,
      OpenElectiveStatus.LOCKED,
      NOW,
      db
    );

    assert.deepEqual(client.onlyCallTo("openElectiveOffering", "update").args.where, {
      tenantId_id: { tenantId: TENANT_ID, id: OFFERING_ID },
    });
  });

  it("scopes both preference writes by tenant", async () => {
    const { client, db } = fake();

    await repository.replacePreferences(
      TENANT_ID,
      STUDENT_ID,
      SEMESTER_ID,
      [{ offeringId: OFFERING_ID, preferenceRank: 1, submittedAt: NOW }],
      db
    );

    const deleted = whereOf(client.onlyCallTo("openElectivePreference", "deleteMany").args);

    assert.equal(deleted.tenantId, TENANT_ID);
    assert.equal(deleted.studentId, STUDENT_ID);
    assert.equal(deleted.semesterId, SEMESTER_ID);

    const created = client.onlyCallTo("openElectivePreference", "createMany").args
      .data as Record<string, unknown>[];

    assert.equal(created[0].tenantId, TENANT_ID);
  });
});

// --- No N+1 -----------------------------------------------------------------

describe("OpenElectiveRepository — the catalogue cannot become an N+1", () => {
  it("reads eligibility for MANY offerings in one statement", async () => {
    // Forty offerings cost one read, not forty.
    const { client, db } = fake();
    const ids = Array.from({ length: 40 }, (_value, index) => `offering_${index}`);

    await repository.findEligibility(TENANT_ID, ids, db);

    assert.equal(client.callCount, 1);
    assert.deepEqual(
      (whereOf(client.onlyCallTo("openElectiveEligibility", "findMany").args)
        .offeringId as { in: string[] }).in.length,
      40
    );
  });

  it("counts allocated seats for MANY offerings in one groupBy", async () => {
    const { client, db } = fake();
    const ids = Array.from({ length: 40 }, (_value, index) => `offering_${index}`);

    await repository.countAllocatedForOfferings(TENANT_ID, ids, db);

    assert.equal(client.callCount, 1);

    const args = client.onlyCallTo("openElectiveAllocation", "groupBy").args;

    assert.deepEqual(args.by, ["offeringId"]);
    assert.deepEqual(args._count, { _all: true });
  });

  it("costs exactly TWO statements for a paginated catalogue", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, PAGE, db);

    assert.equal(client.callCount, 2, "one page, one count — no per-row read");
  });

  it("short-circuits an empty id set rather than issuing a query", async () => {
    // An empty IN list is a query that can match nothing; issuing it is a round
    // trip spent to learn what the caller already knew.
    const { client, db } = fake();

    assert.deepEqual(await repository.findEligibility(TENANT_ID, [], db), []);
    assert.deepEqual(await repository.countAllocatedForOfferings(TENANT_ID, [], db), []);
    assert.deepEqual(await repository.findOfferingsByIds(TENANT_ID, [], db), []);

    assert.equal(client.callCount, 0);
  });

  it("validates a whole preference submission with ONE offering read", async () => {
    const { client, db } = fake();

    await repository.findOfferingsByIds(TENANT_ID, ["a", "b", "c", "d", "e"], db);

    assert.equal(client.callCount, 1);
  });
});

// --- Ordering ---------------------------------------------------------------

describe("OpenElectiveRepository — orderings", () => {
  it("reads the allocation input in RANK then SUBMISSION order", async () => {
    // This matches the composite index exactly, so an allocation run reads its
    // cohort already sorted and performs no sort of its own.
    assert.deepEqual([...PREFERENCE_ORDER_BY], [
      { preferenceRank: "asc" },
      { submittedAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("applies that ordering to the offering's preference read", async () => {
    const { client, db } = fake();

    await repository.findOfferingPreferences(TENANT_ID, OFFERING_ID, db);

    assert.deepEqual(client.onlyCallTo("openElectivePreference", "findMany").args.orderBy, [
      ...PREFERENCE_ORDER_BY,
    ]);
  });

  it("puts rank BEFORE the tie-breaker, never after", () => {
    // Preference order is always honoured first; submittedAt only separates two
    // students competing at the SAME rank.
    const first = PREFERENCE_ORDER_BY[0] as Record<string, string>;

    assert.ok("preferenceRank" in first);
  });

  it("closes every ordering with id, so pagination cannot skip a row", () => {
    for (const ordering of [OFFERING_ORDER_BY, PREFERENCE_ORDER_BY]) {
      const last = ordering[ordering.length - 1] as Record<string, string>;

      assert.ok("id" in last, JSON.stringify(ordering));
    }
  });

  it("orders the catalogue by semester start then course code", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, PAGE, db);

    assert.deepEqual(client.onlyCallTo("openElectiveOffering", "findMany").args.orderBy, [
      ...OFFERING_ORDER_BY,
    ]);
  });
});

// --- Filters and pagination -------------------------------------------------

describe("OpenElectiveRepository — filters and pagination", () => {
  it("omits a filter entirely when it was not supplied", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, PAGE, db);

    const where = whereOf(client.onlyCallTo("openElectiveOffering", "findMany").args);

    for (const key of ["semesterId", "status", "offeringDepartmentId", "courseId"]) {
      assert.equal(key in where, false, key);
    }
  });

  it("applies every filter it accepts", async () => {
    const { client, db } = fake();

    await repository.listOfferings(
      TENANT_ID,
      {
        ...PAGE,
        semesterId: SEMESTER_ID,
        status: OpenElectiveStatus.OPEN,
        departmentId: "dept_1",
        courseId: "course_1",
      },
      db
    );

    const where = whereOf(client.onlyCallTo("openElectiveOffering", "findMany").args);

    assert.equal(where.semesterId, SEMESTER_ID);
    assert.equal(where.status, OpenElectiveStatus.OPEN);
    assert.equal(where.offeringDepartmentId, "dept_1");
    assert.equal(where.courseId, "course_1");
  });

  it("translates page and limit to skip and take", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, { page: 3, limit: 25 }, db);

    const args = client.onlyCallTo("openElectiveOffering", "findMany").args;

    assert.equal(args.skip, 50);
    assert.equal(args.take, 25);
  });

  it("does NOT paginate the count", async () => {
    const { client, db } = fake();

    await repository.listOfferings(TENANT_ID, { page: 2, limit: 10 }, db);

    const args = client.onlyCallTo("openElectiveOffering", "count").args;

    assert.equal(args.skip, undefined);
    assert.equal(args.take, undefined);
  });

  it("returns the rows and the total together", async () => {
    const { client, db } = fake();

    client.resultFor("openElectiveOffering", "findMany", [{ id: OFFERING_ID }]);
    client.resultFor("openElectiveOffering", "count", 7);

    const page = await repository.listOfferings(TENANT_ID, PAGE, db);

    assert.equal(page.rows.length, 1);
    assert.equal(page.total, 7);
  });
});

// --- Seats ------------------------------------------------------------------

describe("OpenElectiveRepository — seats are COUNTED, never computed", () => {
  it("counts only ALLOCATED verdicts as consuming a seat", async () => {
    // A NOT_ALLOCATED verdict is a record of a refusal, not an occupant.
    const { client, db } = fake();

    await repository.countAllocated(TENANT_ID, OFFERING_ID, db);

    assert.equal(
      whereOf(client.onlyCallTo("openElectiveAllocation", "count").args).outcome,
      ElectiveAllocationOutcome.ALLOCATED
    );
  });

  it("names ALLOCATED as the seat-consuming outcome, in one place", () => {
    assert.equal(SEAT_CONSUMING_OUTCOME, ElectiveAllocationOutcome.ALLOCATED);
  });

  it("filters the grouped count to ALLOCATED too", async () => {
    const { client, db } = fake();

    await repository.countAllocatedForOfferings(TENANT_ID, [OFFERING_ID], db);

    assert.equal(
      whereOf(client.onlyCallTo("openElectiveAllocation", "groupBy").args).outcome,
      ElectiveAllocationOutcome.ALLOCATED
    );
  });

  it("exposes NO method that returns a remaining-seat figure", () => {
    // `totalSeats - allocated` is a subtraction, and a subtraction is a
    // calculation. The service performs it; this file has no method for it.
    const methods = Object.getOwnPropertyNames(OpenElectiveRepository.prototype);

    for (const method of methods) {
      assert.equal(
        /remaining|available|hasSeat|isFull/i.test(method),
        false,
        `${method} implies seat arithmetic`
      );
    }
  });

  it("exposes NO method that evaluates eligibility", () => {
    const methods = Object.getOwnPropertyNames(OpenElectiveRepository.prototype);

    for (const method of methods) {
      assert.equal(
        /isEligible|checkEligib|canTake|allocate[A-Z]/.test(method),
        false,
        `${method} implies a decision`
      );
    }
  });
});

// --- Preferences ------------------------------------------------------------

describe("OpenElectiveRepository — preference writes", () => {
  it("replaces wholesale: delete then insert, in that order", async () => {
    // A per-row diff would have to reason about the (student, semester, rank)
    // unique constraint mid-flight, where a transient duplicate rank aborts the
    // transaction. Clearing first removes the hazard entirely.
    const { client, db } = fake();

    await repository.replacePreferences(
      TENANT_ID,
      STUDENT_ID,
      SEMESTER_ID,
      [
        { offeringId: "a", preferenceRank: 1, submittedAt: NOW },
        { offeringId: "b", preferenceRank: 2, submittedAt: NOW },
      ],
      db
    );

    assert.deepEqual(
      client.calls.map((call) => call.operation),
      ["deleteMany", "createMany"]
    );
  });

  it("writes every choice in ONE createMany", async () => {
    const { client, db } = fake();

    const rows = Array.from({ length: 10 }, (_value, index) => ({
      offeringId: `offering_${index}`,
      preferenceRank: index + 1,
      submittedAt: NOW,
    }));

    const written = await repository.replacePreferences(
      TENANT_ID,
      STUDENT_ID,
      SEMESTER_ID,
      rows,
      db
    );

    assert.equal(written, 10);
    assert.equal(client.callsTo("openElectivePreference", "createMany").length, 1);
  });

  it("carries submittedAt through, because FCFS reads it", async () => {
    const { client, db } = fake();

    await repository.replacePreferences(
      TENANT_ID,
      STUDENT_ID,
      SEMESTER_ID,
      [{ offeringId: "a", preferenceRank: 1, submittedAt: NOW }],
      db
    );

    const data = client.onlyCallTo("openElectivePreference", "createMany").args
      .data as Record<string, unknown>[];

    assert.equal(data[0].submittedAt, NOW);
  });

  it("CLEARS without inserting when handed an empty list", async () => {
    // Withdrawal is expressible; whether it is permitted is the service's rule.
    const { client, db } = fake();

    const written = await repository.replacePreferences(
      TENANT_ID,
      STUDENT_ID,
      SEMESTER_ID,
      [],
      db
    );

    assert.equal(written, 0);
    assert.equal(client.callsTo("openElectivePreference", "createMany").length, 0);
    assert.equal(client.callsTo("openElectivePreference", "deleteMany").length, 1);
  });

  it("names OPEN as the only status a preference may be written in", () => {
    assert.equal(PREFERENCE_WRITABLE_STATUS, OpenElectiveStatus.OPEN);
  });

  it("does NOT check that status itself — that is the service's rule", async () => {
    // The repository writes what it is told. Asserting the lifecycle here would
    // put a business rule in the wrong layer.
    const { client, db } = fake();

    await repository.replacePreferences(
      TENANT_ID,
      STUDENT_ID,
      SEMESTER_ID,
      [{ offeringId: "a", preferenceRank: 1, submittedAt: NOW }],
      db
    );

    // createMany carries `data` rather than `where`, so the predicate is read
    // defensively — the assertion is about status, not about call shape.
    for (const call of client.calls) {
      const where = (call.args.where ?? {}) as Record<string, unknown>;

      assert.equal(
        "status" in where,
        false,
        `${call.operation} consulted status, which is the service's rule`
      );
    }

    const serialised = JSON.stringify(client.calls);

    assert.equal(serialised.includes("OPEN"), false, "a lifecycle state reached a query");
  });
});

// --- Allocations ------------------------------------------------------------

describe("OpenElectiveRepository — allocation writes", () => {
  it("writes a whole cohort's verdicts in ONE statement", async () => {
    const { client, db } = fake();

    const rows = Array.from({ length: 500 }, (_value, index) => ({
      tenantId: TENANT_ID,
      offeringId: OFFERING_ID,
      studentId: `student_${index}`,
      preferenceRank: 1,
      outcome: ElectiveAllocationOutcome.ALLOCATED,
      courseRegistrationId: null,
      allocatedAt: NOW,
    }));

    const written = await repository.createAllocations(rows, db);

    assert.equal(written, 500);
    assert.equal(client.callCount, 1, "five hundred students, one statement");
  });

  it("writes nothing and issues no statement for an empty run", async () => {
    const { client, db } = fake();

    assert.equal(await repository.createAllocations([], db), 0);
    assert.equal(client.callCount, 0);
  });

  it("can clear an offering's verdicts so a run may be repeated", async () => {
    const { client, db } = fake();

    await repository.deleteAllocations(TENANT_ID, OFFERING_ID, db);

    const where = whereOf(client.onlyCallTo("openElectiveAllocation", "deleteMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.offeringId, OFFERING_ID);
  });

  it("returns REFUSALS as well as awards in the report read", async () => {
    // A report without refusals explains nothing.
    const { client, db } = fake();

    await repository.findAllocations(TENANT_ID, OFFERING_ID, db);

    assert.equal(
      "outcome" in whereOf(client.onlyCallTo("openElectiveAllocation", "findMany").args),
      false,
      "the report filtered out one outcome"
    );
  });

  it("reaches a student's verdicts through the offering's semester", async () => {
    const { client, db } = fake();

    await repository.findStudentAllocations(TENANT_ID, STUDENT_ID, SEMESTER_ID, db);

    const where = whereOf(client.onlyCallTo("openElectiveAllocation", "findMany").args);

    assert.equal(where.studentId, STUDENT_ID);
    assert.deepEqual(where.offering, { semesterId: SEMESTER_ID });
  });
});

// --- Projections ------------------------------------------------------------

describe("OpenElectiveRepository — projections", () => {
  it("carries the course, semester and department a catalogue is unreadable without", () => {
    for (const relation of ["course", "semester", "department", "evaluationScheme"]) {
      assert.ok(relation in OFFERING_SELECT, relation);
    }
  });

  it("projects the evaluation scheme's identity, not its configuration", () => {
    // Enough to see WHICH regulation grades the elective, without loading a
    // regulation's whole component tree.
    assert.deepEqual(Object.keys(OFFERING_SELECT.evaluationScheme.select).sort(), [
      "code",
      "id",
      "version",
    ]);
  });

  it("projects submittedAt on a preference, because FCFS needs it", () => {
    assert.equal(PREFERENCE_SELECT.submittedAt, true);
  });

  it("projects the registration link on an allocation, so an award is traceable", () => {
    assert.equal(ALLOCATION_SELECT.courseRegistrationId, true);
  });

  it("projects every eligibility narrowing column", () => {
    for (const column of ["programmeId", "specialisationId", "semesterNumber"]) {
      assert.equal((ELIGIBILITY_SELECT as Record<string, unknown>)[column], true, column);
    }
  });
});

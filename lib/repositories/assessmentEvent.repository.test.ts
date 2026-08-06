// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify the structural properties of every query this repository
//          issues — tenant isolation, write scoping, calendar ordering, and the
//          two query-shape decisions that matter for scale:
//
//            the sitting number comes from an AGGREGATE, not from loading rows
//            the sequence series is keyed on an EXACT sectionId, null included
//
//          The second is easy to get wrong and invisible at runtime: if the null
//          case were treated as "any section", a cohort-wide sitting would share
//          a numbering series with every section-scoped one.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ASSESSMENT_EVENT_LIST_ORDER_BY,
  AssessmentEventRepository,
  type DbClient,
} from "@/lib/repositories/assessmentEvent.repository";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const EVENT_ID = "event_1";
const COMPONENT_ID = "component_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "semester_1";
const SECTION_ID = "section_1";

const repository = new AssessmentEventRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

describe("AssessmentEventRepository — tenant isolation", () => {
  it("scopes a single read by tenant", async () => {
    const { client, db } = fake();

    await repository.findById(TENANT_ID, EVENT_ID, db);

    const where = whereOf(client.onlyCallTo("assessmentEvent", "findFirst").args);
    assert.equal(where.id, EVENT_ID);
    assert.equal(where.tenantId, TENANT_ID);
  });

  it("carries the tenant into the write itself on update", async () => {
    const { client, db } = fake();

    await repository.update(TENANT_ID, EVENT_ID, { status: "OPEN" }, db);

    assert.deepEqual(
      whereOf(client.onlyCallTo("assessmentEvent", "update").args).tenantId_id,
      { tenantId: TENANT_ID, id: EVENT_ID },
      "the compound selector is what stops a preceding read being the only tenant proof"
    );
  });

  it("scopes EVERY reference lookup by tenant", async () => {
    const { client, db } = fake();

    await repository.findComponent(TENANT_ID, COMPONENT_ID, db);
    await repository.findCourse(TENANT_ID, COURSE_ID, db);
    await repository.findSemester(TENANT_ID, SEMESTER_ID, db);
    await repository.findSection(TENANT_ID, SECTION_ID, db);
    await repository.findFaculty(TENANT_ID, "faculty_1", db);

    for (const call of client.calls) {
      assert.equal(
        whereOf(call.args).tenantId,
        TENANT_ID,
        `${call.model}.${call.operation} resolved a reference without a tenant predicate`
      );
    }
  });

  it("never issues a query without a tenant predicate", async () => {
    const { client, db } = fake();

    await repository.findById(TENANT_ID, EVENT_ID, db);
    await repository.findMaxSequence(TENANT_ID, COMPONENT_ID, COURSE_ID, SEMESTER_ID, null, db);
    await repository.update(TENANT_ID, EVENT_ID, { status: "OPEN" }, db);

    for (const call of client.calls) {
      const serialised = JSON.stringify(call.args);
      assert.ok(
        serialised.includes(TENANT_ID),
        `${call.model}.${call.operation} issued without a tenant predicate`
      );
      assert.ok(
        !serialised.includes(OTHER_TENANT),
        `${call.model}.${call.operation} leaked another tenant`
      );
    }
  });
});

describe("AssessmentEventRepository — sitting numbering", () => {
  it("uses an aggregate rather than loading the sibling rows", async () => {
    const { client, db } = fake();

    await repository.findMaxSequence(TENANT_ID, COMPONENT_ID, COURSE_ID, SEMESTER_ID, null, db);

    const call = client.onlyCallTo("assessmentEvent", "aggregate");
    assert.deepEqual(call.args._max, { sequenceNumber: true });
    assert.equal(
      client.callsTo("assessmentEvent", "findMany").length,
      0,
      "computing a maximum in Node would move work the database does with an index"
    );
  });

  it("keys the series on an EXACT null section, not on any section", async () => {
    const { client, db } = fake();

    await repository.findMaxSequence(TENANT_ID, COMPONENT_ID, COURSE_ID, SEMESTER_ID, null, db);

    const where = whereOf(client.onlyCallTo("assessmentEvent", "aggregate").args);
    assert.ok("sectionId" in where, "the null case must still be a predicate");
    assert.equal(
      where.sectionId,
      null,
      "a cohort-wide sitting numbers separately from a section-scoped one"
    );
  });

  it("keys the series on a named section when one is given", async () => {
    const { client, db } = fake();

    await repository.findMaxSequence(
      TENANT_ID,
      COMPONENT_ID,
      COURSE_ID,
      SEMESTER_ID,
      SECTION_ID,
      db
    );

    assert.equal(
      whereOf(client.onlyCallTo("assessmentEvent", "aggregate").args).sectionId,
      SECTION_ID
    );
  });

  it("returns null when no sitting exists yet", async () => {
    const { db } = fake();

    assert.equal(
      await repository.findMaxSequence(TENANT_ID, COMPONENT_ID, COURSE_ID, SEMESTER_ID, null, db),
      null
    );
  });
});

describe("AssessmentEventRepository — component lookup", () => {
  it("resolves the component by id alone, not scheme-scoped", async () => {
    const { client, db } = fake();

    await repository.findComponent(TENANT_ID, COMPONENT_ID, db);

    const where = whereOf(client.onlyCallTo("evaluationComponent", "findFirst").args);
    assert.equal(where.id, COMPONENT_ID);
    assert.equal(
      "schemeId" in where,
      false,
      "a sitting does not know the regulation yet — the component is what tells it"
    );
  });

  it("selects the scheme and the scale the service needs", async () => {
    const { client, db } = fake();

    await repository.findComponent(TENANT_ID, COMPONENT_ID, db);

    const select = client.onlyCallTo("evaluationComponent", "findFirst").args.select as Record<
      string,
      boolean
    >;
    assert.equal(select.schemeId, true, "needed to check the regulation is ACTIVE");
    assert.equal(select.maxMarks, true, "needed as the sitting's default total");
  });
});

// listWithCount is deliberately absent from this suite. It pairs its page and
// its count inside prisma.$transaction([...]), the ARRAY form, which exists
// only on the module client — a TransactionClient cannot open one. So it takes
// no injectable handle and cannot be exercised against the double; reaching for
// it here silently hit the real database.
//
// What that method must guarantee is still asserted, from the constant it uses.
// The filter construction is covered by the service's pagination test and, at
// the SQL level, belongs to an integration test with a real database.
describe("AssessmentEventRepository — calendar ordering", () => {
  it("orders by scheduled date, then sitting number, then id", () => {
    assert.deepEqual(ASSESSMENT_EVENT_LIST_ORDER_BY, [
      { scheduledAt: "asc" },
      { sequenceNumber: "asc" },
      { id: "asc" },
    ]);
  });

  it("ends on a unique key, so offset pagination is stable", () => {
    const last = ASSESSMENT_EVENT_LIST_ORDER_BY[ASSESSMENT_EVENT_LIST_ORDER_BY.length - 1];

    assert.deepEqual(
      last,
      { id: "asc" },
      "scheduledAt is nullable and a whole term is often created in one batch, so neither can order alone"
    );
  });
});

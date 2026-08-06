// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify the structural properties of every query issued against the
//          largest table in the phase.
//
//          Two of them matter more here than anywhere else:
//
//            every read is SET-BASED — a per-row lookup on this table is the
//              N+1 that would make a thousand-mark upload a thousand round trips
//            the amendment is selected by the NATURAL key — so a mark cannot be
//              moved to another sitting by a stale row id
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MARKS_SHEET_ORDER_BY,
  StudentComponentScoreRepository,
  type DbClient,
} from "@/lib/repositories/studentComponentScore.repository";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const EVENT_ID = "event_1";
const REG_A = "registration_a";
const REG_B = "registration_b";

const repository = new StudentComponentScoreRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

describe("StudentComponentScoreRepository — tenant isolation", () => {
  it("scopes the marks sheet by tenant and sitting", async () => {
    const { client, db } = fake();

    await repository.findByEvent(TENANT_ID, EVENT_ID, db);

    const where = whereOf(client.onlyCallTo("studentComponentScore", "findMany").args);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.assessmentEventId, EVENT_ID);
  });

  it("scopes the amendment by tenant, sitting AND registration", async () => {
    const { client, db } = fake();

    await repository.updateByNaturalKey(
      TENANT_ID,
      EVENT_ID,
      REG_A,
      { marksObtained: 25, status: "RECORDED", remarks: null },
      db
    );

    const where = whereOf(client.onlyCallTo("studentComponentScore", "updateMany").args);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.assessmentEventId, EVENT_ID);
    assert.equal(
      where.courseRegistrationId,
      REG_A,
      "selecting by natural key means a stale row id cannot move a mark to another sitting"
    );
  });

  it("scopes every reference lookup by tenant", async () => {
    const { client, db } = fake();

    await repository.findEvent(TENANT_ID, EVENT_ID, db);
    await repository.findGoverningScheme(TENANT_ID, "component_1", db);
    await repository.findRegistrations(TENANT_ID, [REG_A], db);
    await repository.findFacultyByUserId(TENANT_ID, "user_1", db);

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

    await repository.findByEvent(TENANT_ID, EVENT_ID, db);
    await repository.findExisting(TENANT_ID, EVENT_ID, [REG_A, REG_B], db);
    await repository.findRegistrations(TENANT_ID, [REG_A], db);

    for (const call of client.calls) {
      const serialised = JSON.stringify(call.args);
      assert.ok(serialised.includes(TENANT_ID), `${call.model}.${call.operation} lacked a tenant`);
      assert.ok(
        !serialised.includes(OTHER_TENANT),
        `${call.model}.${call.operation} leaked another tenant`
      );
    }
  });
});

describe("StudentComponentScoreRepository — set-based reads", () => {
  it("resolves existing marks for a whole batch in ONE query", async () => {
    const { client, db } = fake();

    await repository.findExisting(TENANT_ID, EVENT_ID, [REG_A, REG_B], db);

    const where = whereOf(client.onlyCallTo("studentComponentScore", "findMany").args);
    assert.deepEqual(where.courseRegistrationId, { in: [REG_A, REG_B] });
    assert.equal(client.callCount, 1, "a per-row existence check is the N+1 this replaces");
  });

  it("resolves a whole batch of registrations in ONE query", async () => {
    const { client, db } = fake();

    await repository.findRegistrations(TENANT_ID, [REG_A, REG_B], db);

    const where = whereOf(client.onlyCallTo("courseRegistration", "findMany").args);
    assert.deepEqual(where.id, { in: [REG_A, REG_B] });
  });

  it("issues no query at all for an empty batch", async () => {
    const { client, db } = fake();

    assert.deepEqual(await repository.findExisting(TENANT_ID, EVENT_ID, [], db), []);
    assert.deepEqual(await repository.findRegistrations(TENANT_ID, [], db), []);
    assert.equal(await repository.createMany([], db), 0);

    assert.equal(client.callCount, 0, "an `in: []` round trip is a certain empty result");
  });

  it("inserts every new mark in ONE statement", async () => {
    const { client, db } = fake();

    await repository.createMany(
      [REG_A, REG_B].map((courseRegistrationId) => ({
        tenantId: TENANT_ID,
        assessmentEventId: EVENT_ID,
        courseRegistrationId,
        marksObtained: 20,
        status: "RECORDED" as const,
        remarks: null,
      })),
      db
    );

    const call = client.onlyCallTo("studentComponentScore", "createMany");
    assert.equal((call.args.data as unknown[]).length, 2);
    assert.equal(client.callCount, 1);
  });

  it("does not set skipDuplicates, so a real race surfaces as a conflict", async () => {
    const { client, db } = fake();

    await repository.createMany(
      [
        {
          tenantId: TENANT_ID,
          assessmentEventId: EVENT_ID,
          courseRegistrationId: REG_A,
          marksObtained: 20,
          status: "RECORDED" as const,
          remarks: null,
        },
      ],
      db
    );

    assert.equal(
      client.onlyCallTo("studentComponentScore", "createMany").args.skipDuplicates,
      undefined,
      "collisions are resolved from findExisting; a survivor is a concurrent uploader"
    );
  });
});

describe("StudentComponentScoreRepository — governing scheme", () => {
  it("reads the component and its regulation's status in ONE query", async () => {
    const { client, db } = fake();
    client.resultFor("evaluationComponent", "findFirst", {
      id: "component_1",
      schemeId: "scheme_1",
      scheme: { status: "ACTIVE" },
    });

    const result = await repository.findGoverningScheme(TENANT_ID, "component_1", db);

    assert.equal(client.callCount, 1, "the status is reachable through a declared relation");
    assert.deepEqual(result, {
      componentId: "component_1",
      schemeId: "scheme_1",
      schemeStatus: "ACTIVE",
    });
  });

  it("returns null when the component is not in this tenant", async () => {
    const { db } = fake();

    assert.equal(await repository.findGoverningScheme(TENANT_ID, "component_1", db), null);
  });
});

describe("StudentComponentScoreRepository — marks sheet ordering", () => {
  it("orders by registration, then row id", () => {
    assert.deepEqual(MARKS_SHEET_ORDER_BY, [
      { courseRegistrationId: "asc" },
      { id: "asc" },
    ]);
  });

  it("ends on a unique key, so two identical requests render identically", () => {
    const last = MARKS_SHEET_ORDER_BY[MARKS_SHEET_ORDER_BY.length - 1];

    assert.deepEqual(
      last,
      { id: "asc" },
      "a bulk upload writes every row in one statement, so createdAt cannot order them"
    );
  });
});

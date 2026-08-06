// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify the structural properties of every query this repository
//          issues — tenant isolation, regulation isolation, write scoping and
//          ordering. Same rationale as the rule repository suite: a repository
//          holds no logic, so what matters is what it asks of the database.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PassingCriterionRepository,
  type DbClient,
} from "@/lib/repositories/passingCriterion.repository";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const SCHEME_ID = "scheme_1";
const CRITERION_ID = "criterion_1";

const repository = new PassingCriterionRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

describe("PassingCriterionRepository — tenant isolation", () => {
  it("scopes the set read by tenant AND scheme", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);

    const where = whereOf(client.onlyCallTo("passingCriterion", "findMany").args);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.schemeId, SCHEME_ID);
  });

  it("scopes a single read by tenant AND scheme, not by id alone", async () => {
    const { client, db } = fake();

    await repository.findById(TENANT_ID, SCHEME_ID, CRITERION_ID, db);

    const where = whereOf(client.onlyCallTo("passingCriterion", "findFirst").args);
    assert.equal(where.id, CRITERION_ID);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(
      where.schemeId,
      SCHEME_ID,
      "a criterion of another regulation in the same tenant must be unreachable"
    );
  });

  it("carries the tenant into the write itself on update and delete", async () => {
    const { client, db } = fake();

    await repository.update(TENANT_ID, CRITERION_ID, { name: "Renamed" }, db);
    await repository.delete(TENANT_ID, CRITERION_ID, db);

    assert.deepEqual(whereOf(client.onlyCallTo("passingCriterion", "update").args).tenantId_id, {
      tenantId: TENANT_ID,
      id: CRITERION_ID,
    });
    assert.deepEqual(whereOf(client.onlyCallTo("passingCriterion", "delete").args).tenantId_id, {
      tenantId: TENANT_ID,
      id: CRITERION_ID,
    });
  });

  it("never issues a query without a tenant predicate", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);
    await repository.findById(TENANT_ID, SCHEME_ID, CRITERION_ID, db);
    await repository.create(
      {
        tenantId: TENANT_ID,
        schemeId: SCHEME_ID,
        componentId: null,
        code: "ATT75",
        name: "Attendance 75%",
        description: null,
        metric: "ATTENDANCE_PERCENT",
        threshold: 75,
        unit: "PERCENT",
        failureOutcome: "INELIGIBLE",
      },
      db
    );
    await repository.update(TENANT_ID, CRITERION_ID, { name: "x" }, db);
    await repository.delete(TENANT_ID, CRITERION_ID, db);

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

describe("PassingCriterionRepository — ordering", () => {
  it("orders by metric, then code", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);

    assert.deepEqual(client.onlyCallTo("passingCriterion", "findMany").args.orderBy, [
      { metric: "asc" },
      { code: "asc" },
    ]);
  });

  it("ends on a scheme-unique key, so the order is total", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);

    const orderBy = client.onlyCallTo("passingCriterion", "findMany").args
      .orderBy as Record<string, string>[];

    assert.deepEqual(orderBy[orderBy.length - 1], { code: "asc" });
  });
});

describe("PassingCriterionRepository — query count", () => {
  it("issues exactly one statement per operation", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);
    assert.equal(client.callCount, 1, "the set read must not fan out into per-criterion queries");

    await repository.findById(TENANT_ID, SCHEME_ID, CRITERION_ID, db);
    assert.equal(client.callCount, 2);
  });
});

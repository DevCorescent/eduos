// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify the STRUCTURAL properties of every query this repository
//          issues — the ones a service-level test cannot see because it
//          replaces this layer with a fake.
//
//          A repository here contains no logic, so "does it compute the right
//          answer" is not a question worth asking. What matters is what it
//          ASKS OF THE DATABASE, and every property below is a correctness or
//          security invariant:
//
//            tenant isolation      — every query carries tenantId
//            regulation isolation  — scheme-scoped queries carry schemeId
//            write scoping         — writes carry their own tenant predicate
//            pipeline ordering     — the order the engine depends on
//            JSON null handling    — cleared columns become SQL NULL
//
//          Each repository method accepts a client, so the fake is injected the
//          same way a transaction handle is. No database, no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@/app/generated/prisma/client";
import {
  EvaluationRuleRepository,
  type DbClient,
} from "@/lib/repositories/evaluationRule.repository";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const SCHEME_ID = "scheme_1";
const RULE_ID = "rule_1";

const repository = new EvaluationRuleRepository();

/** The fake stands in for a transaction handle, which is how it is injected. */
function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

describe("EvaluationRuleRepository — tenant isolation", () => {
  it("scopes the set read by tenant AND scheme", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);

    const where = whereOf(client.onlyCallTo("evaluationRule", "findMany").args);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.schemeId, SCHEME_ID);
  });

  it("scopes a single read by tenant AND scheme, not by id alone", async () => {
    const { client, db } = fake();

    await repository.findById(TENANT_ID, SCHEME_ID, RULE_ID, db);

    const where = whereOf(client.onlyCallTo("evaluationRule", "findFirst").args);
    assert.equal(where.id, RULE_ID);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(
      where.schemeId,
      SCHEME_ID,
      "a rule of another regulation in the same tenant must be unreachable"
    );
  });

  it("carries the tenant into the write itself on update", async () => {
    const { client, db } = fake();

    await repository.update(TENANT_ID, RULE_ID, { name: "Renamed" }, db);

    const where = whereOf(client.onlyCallTo("evaluationRule", "update").args);
    assert.deepEqual(
      where.tenantId_id,
      { tenantId: TENANT_ID, id: RULE_ID },
      "the compound selector is what stops a preceding read from being the only tenant proof"
    );
  });

  it("carries the tenant into the write itself on delete", async () => {
    const { client, db } = fake();

    await repository.delete(TENANT_ID, RULE_ID, db);

    const where = whereOf(client.onlyCallTo("evaluationRule", "delete").args);
    assert.deepEqual(where.tenantId_id, { tenantId: TENANT_ID, id: RULE_ID });
  });

  it("never issues a query without a tenant predicate", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);
    await repository.findById(TENANT_ID, SCHEME_ID, RULE_ID, db);
    await repository.create(
      {
        tenantId: TENANT_ID,
        schemeId: SCHEME_ID,
        componentId: null,
        code: "CAP",
        name: "Cap",
        description: null,
        phase: "COURSE_ADJUSTMENT",
        operation: "CAP",
        sequence: 1,
        config: { limit: 100 },
        condition: null,
      },
      db
    );
    await repository.update(TENANT_ID, RULE_ID, { name: "x" }, db);
    await repository.delete(TENANT_ID, RULE_ID, db);

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

describe("EvaluationRuleRepository — pipeline ordering", () => {
  it("orders by phase, then sequence, then code", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);

    const { orderBy } = client.onlyCallTo("evaluationRule", "findMany").args;

    assert.deepEqual(orderBy, [{ phase: "asc" }, { sequence: "asc" }, { code: "asc" }]);
  });

  it("orders by code last, which makes the order total despite the nullable componentId", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);

    const orderBy = client.onlyCallTo("evaluationRule", "findMany").args
      .orderBy as Record<string, string>[];

    // The last key must be unique-per-scheme, or two course-level rules sharing
    // a sequence would render in a non-deterministic order between requests.
    assert.deepEqual(orderBy[orderBy.length - 1], { code: "asc" });
  });
});

describe("EvaluationRuleRepository — JSON column handling", () => {
  it("stores a cleared config as SQL NULL, not as the JSON value null", async () => {
    const { client, db } = fake();

    await repository.update(TENANT_ID, RULE_ID, { config: null, condition: null }, db);

    const data = client.onlyCallTo("evaluationRule", "update").args.data as Record<
      string,
      unknown
    >;

    assert.equal(data.config, Prisma.DbNull);
    assert.equal(data.condition, Prisma.DbNull);
  });

  it("omits an untouched JSON column so the stored value survives a PATCH", async () => {
    const { client, db } = fake();

    await repository.update(TENANT_ID, RULE_ID, { name: "Renamed" }, db);

    const data = client.onlyCallTo("evaluationRule", "update").args.data as Record<
      string,
      unknown
    >;

    assert.equal(data.config, undefined);
    assert.equal(data.condition, undefined);
  });

  it("passes a supplied config through unchanged", async () => {
    const { client, db } = fake();
    const config = { limit: 100 };

    await repository.update(TENANT_ID, RULE_ID, { config }, db);

    const data = client.onlyCallTo("evaluationRule", "update").args.data as Record<
      string,
      unknown
    >;

    assert.deepEqual(data.config, config);
  });
});

describe("EvaluationRuleRepository — query count", () => {
  it("issues exactly one statement per operation", async () => {
    const { client, db } = fake();

    await repository.findAllBySchemeId(TENANT_ID, SCHEME_ID, db);
    assert.equal(client.callCount, 1, "the set read must not fan out into per-rule queries");

    await repository.findById(TENANT_ID, SCHEME_ID, RULE_ID, db);
    assert.equal(client.callCount, 2);

    await repository.delete(TENANT_ID, RULE_ID, db);
    assert.equal(client.callCount, 3);
  });
});

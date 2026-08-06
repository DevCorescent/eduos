// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule
// LAYER  : Service — Unit Tests
// PURPOSE: Prove every business rule this service owns — draft-only
//          mutability, phase/component coherence, config-to-operation
//          agreement, variable availability, pipeline position, audit and
//          transactional atomicity.
//
// WHAT IS NOT RETESTED HERE
//   Formula structure (lib/domain/result-engine/formula.test.ts), tenant
//   scoping of the SQL (evaluationRule.repository.test.ts) and request shape
//   (lib/validations/evaluationRule.test.ts) each have their own suite. Testing
//   any of them twice would mean two specifications of one rule.
//
//   No database, no environment: the service takes its four dependencies as
//   constructor ports imported with `import type`, so its runtime graph never
//   reaches lib/db/prisma.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { EvaluationRuleService } from "@/lib/services/evaluationRule.service";
import { HTTP_STATUS } from "@/lib/constants/errors";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type { EvaluationComponentRecord } from "@/lib/repositories/evaluationComponent.repository";
import type {
  EvaluationComponentLookupPort,
  EvaluationSchemeLifecyclePort,
} from "@/lib/repositories/evaluationConfig.ports";
import type { EvaluationSchemeRecord } from "@/lib/repositories/evaluationScheme.repository";
import type {
  CreateEvaluationRuleData,
  DbClient,
  EvaluationRuleRecord,
  EvaluationRuleRepositoryPort,
  UpdateEvaluationRuleData,
} from "@/lib/repositories/evaluationRule.repository";
import type { CreateEvaluationRuleInput } from "@/lib/validations/evaluationRule";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const SCHEME_ID = "scheme_1";
const RULE_ID = "rule_1";
const COMPONENT_ID = "component_1";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

const TX = {} as DbClient;

function decimal(value: string): EvaluationComponentRecord["maxMarks"] {
  return { toString: () => value } as EvaluationComponentRecord["maxMarks"];
}

function buildScheme(status: EvaluationSchemeStatus): EvaluationSchemeRecord {
  return {
    id: SCHEME_ID,
    tenantId: TENANT_ID,
    code: "BTECH-R2023",
    name: "B.Tech Regulation 2023",
    description: null,
    version: 1,
    status,
    gradeScaleId: "scale_1",
    attemptPolicy: "LATEST_ATTEMPT",
    marksRounding: "HALF_UP",
    marksPrecision: 2,
    gpaRounding: "HALF_UP",
    gpaPrecision: 2,
    supersededById: null,
    activatedAt: null,
    activatedById: null,
    archivedAt: null,
    createdById: "user_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function buildComponent(): EvaluationComponentRecord {
  return {
    id: COMPONENT_ID,
    tenantId: TENANT_ID,
    schemeId: SCHEME_ID,
    parentComponentId: null,
    code: "THEORY",
    name: "Theory",
    description: null,
    type: "THEORY",
    sourceType: "MANUAL_ENTRY",
    maxMarks: decimal("70.00"),
    weightage: decimal("100.00"),
    aggregation: "SUM",
    rollup: null,
    ruleConfig: null,
    sequence: 1,
    isMandatory: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function buildRule(overrides: Partial<EvaluationRuleRecord> = {}): EvaluationRuleRecord {
  return {
    id: RULE_ID,
    tenantId: TENANT_ID,
    schemeId: SCHEME_ID,
    componentId: null,
    code: "CAP100",
    name: "Cap at maximum",
    description: null,
    phase: "COURSE_ADJUSTMENT",
    operation: "CAP",
    sequence: 1,
    config: { limit: 100 },
    condition: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  id: string;
  data: UpdateEvaluationRuleData;
}

class FakeRuleRepository implements EvaluationRuleRepositoryPort {
  set: EvaluationRuleRecord[] = [];
  single: EvaluationRuleRecord | null = null;

  created: CreateEvaluationRuleData | null = null;
  updates: UpdateCall[] = [];
  deleted: string[] = [];
  transactionCount = 0;

  async findAllBySchemeId(): Promise<EvaluationRuleRecord[]> {
    return this.set;
  }

  async findById(): Promise<EvaluationRuleRecord | null> {
    return this.single;
  }

  async create(data: CreateEvaluationRuleData): Promise<EvaluationRuleRecord> {
    this.created = data;
    return buildRule({
      id: "rule_new",
      componentId: data.componentId,
      code: data.code,
      phase: data.phase,
      operation: data.operation,
      sequence: data.sequence,
      config: data.config as EvaluationRuleRecord["config"],
      condition: data.condition as EvaluationRuleRecord["condition"],
    });
  }

  async update(
    _tenantId: string,
    ruleId: string,
    data: UpdateEvaluationRuleData
  ): Promise<EvaluationRuleRecord> {
    this.updates.push({ id: ruleId, data });
    const existing = this.set.find((candidate) => candidate.id === ruleId);
    return buildRule({ ...existing, id: ruleId });
  }

  async delete(_tenantId: string, ruleId: string): Promise<void> {
    this.deleted.push(ruleId);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return fn(TX);
  }

  /** Every write this fake recorded — the rollback assertion surface. */
  get writeCount(): number {
    return (this.created === null ? 0 : 1) + this.updates.length + this.deleted.length;
  }
}

class FakeAuditRepository implements AuditLogRepositoryPort {
  entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeSchemeLifecycle implements EvaluationSchemeLifecyclePort {
  scheme: EvaluationSchemeRecord | null = buildScheme(EvaluationSchemeStatus.DRAFT);

  async findById(): Promise<EvaluationSchemeRecord | null> {
    return this.scheme;
  }
}

class FakeComponentLookup implements EvaluationComponentLookupPort {
  component: EvaluationComponentRecord | null = buildComponent();
  lookups = 0;

  async findById(): Promise<EvaluationComponentRecord | null> {
    this.lookups += 1;
    return this.component;
  }
}

function build(): {
  service: EvaluationRuleService;
  rules: FakeRuleRepository;
  audit: FakeAuditRepository;
  schemes: FakeSchemeLifecycle;
  components: FakeComponentLookup;
} {
  const rules = new FakeRuleRepository();
  const audit = new FakeAuditRepository();
  const schemes = new FakeSchemeLifecycle();
  const components = new FakeComponentLookup();

  return {
    service: new EvaluationRuleService(rules, audit, schemes, components),
    rules,
    audit,
    schemes,
    components,
  };
}

function rejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, "expected an AppError");
    assert.equal(err.statusCode, status);
    return true;
  });
}

/** A valid course-level rule body, used wherever the body is not under test. */
const COURSE_RULE: CreateEvaluationRuleInput = {
  code: "CAP100",
  name: "Cap at maximum",
  phase: "COURSE_ADJUSTMENT",
  operation: "CAP",
  sequence: 1,
  config: { limit: 100 },
};

/** A valid component-level rule body. */
const COMPONENT_RULE: CreateEvaluationRuleInput = {
  code: "SCALE2X",
  name: "Normalise onto 30",
  phase: "COMPONENT_ADJUSTMENT",
  operation: "SCALE",
  sequence: 1,
  componentId: COMPONENT_ID,
  config: { factor: 1.5 },
};

describe("EvaluationRuleService.create — scheme lifecycle", () => {
  it("adds a rule to a draft regulation", async () => {
    const { service, rules } = build();

    const result = await service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT);

    assert.equal(rules.created?.schemeId, SCHEME_ID);
    assert.equal(result.code, "CAP100");
    assert.equal(result.isCohortScoped, false);
  });

  it("refuses an ACTIVE scheme with 409 and writes nothing", async () => {
    const { service, rules, schemes, audit } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(rules.writeCount, 0);
    assert.equal(audit.entries.length, 0);
  });

  it("refuses an ARCHIVED scheme with 409", async () => {
    const { service, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ARCHIVED);

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, schemes } = build();
    schemes.scheme = null;

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });
});

describe("EvaluationRuleService.create — coherence", () => {
  it("raises 404 when the named component is not in this scheme", async () => {
    const { service, components } = build();
    components.component = null;

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, COMPONENT_RULE, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses a component-scoped phase with no component", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...COMPONENT_RULE, componentId: undefined },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a course-scoped phase that names a component", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, { ...COURSE_RULE, componentId: COMPONENT_ID }, CONTEXT),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a config that does not match the operation, with field detail", async () => {
    const { service, rules } = build();

    await assert.rejects(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...COURSE_RULE, operation: "MODERATION", config: { limit: 100 } },
        CONTEXT
      ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, HTTP_STATUS.BAD_REQUEST);
        assert.ok((err.details?.length ?? 0) > 0, "must report which field is wrong");
        return true;
      }
    );
    assert.equal(rules.writeCount, 0, "a rejected rule must leave nothing written");
  });

  it("refuses a formula reading COURSE_TOTAL before the course total exists", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        {
          ...COMPONENT_RULE,
          operation: "CUSTOM_FORMULA",
          config: { expression: { kind: "VAR", name: "COURSE_TOTAL" } },
        },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("accepts the same formula at the course-adjustment phase", async () => {
    const { service } = build();

    const result = await service.create(
      TENANT_ID,
      SCHEME_ID,
      {
        ...COURSE_RULE,
        operation: "CUSTOM_FORMULA",
        config: { expression: { kind: "VAR", name: "COURSE_TOTAL" } },
      },
      CONTEXT
    );

    assert.equal(result.operation, "CUSTOM_FORMULA");
  });

  it("refuses a condition reading COURSE_TOTAL before it exists", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        {
          ...COMPONENT_RULE,
          condition: { all: [{ variable: "COURSE_TOTAL", comparator: "LT", value: 40 }] },
        },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });
});

describe("EvaluationRuleService.create — pipeline position", () => {
  it("refuses a position already taken in the same phase and component", async () => {
    const { service, rules } = build();
    rules.set = [buildRule({ phase: "COURSE_ADJUSTMENT", componentId: null, sequence: 1 })];

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, { ...COURSE_RULE, code: "OTHER" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("permits the same sequence in a different phase", async () => {
    const { service, rules } = build();
    rules.set = [buildRule({ phase: "COURSE_ADJUSTMENT", componentId: null, sequence: 1 })];

    const result = await service.create(TENANT_ID, SCHEME_ID, COMPONENT_RULE, CONTEXT);

    assert.equal(result.phase, "COMPONENT_ADJUSTMENT");
  });

  it("permits the same sequence under a different component", async () => {
    const { service, rules } = build();
    rules.set = [
      buildRule({ phase: "COMPONENT_ADJUSTMENT", componentId: "component_other", sequence: 1 }),
    ];

    const result = await service.create(TENANT_ID, SCHEME_ID, COMPONENT_RULE, CONTEXT);

    assert.equal(result.componentId, COMPONENT_ID);
  });
});

describe("EvaluationRuleService.create — audit and transaction", () => {
  it("runs inside a transaction", async () => {
    const { service, rules } = build();

    await service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT);

    assert.equal(rules.transactionCount, 1);
  });

  it("writes a CREATED entry carrying the actor and origin", async () => {
    const { service, audit } = build();

    await service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT);

    assert.equal(audit.entries.length, 1);
    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_RULE_CREATED");
    assert.equal(entry.resource, "EvaluationRule");
    assert.equal(entry.tenantId, TENANT_ID);
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.ipAddress, CONTEXT.ipAddress);
    assert.equal(entry.userAgent, CONTEXT.userAgent);
    assert.equal(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });

  it("writes no audit entry when the operation is rejected", async () => {
    const { service, audit, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);

    await assert.rejects(service.create(TENANT_ID, SCHEME_ID, COURSE_RULE, CONTEXT));

    assert.equal(audit.entries.length, 0, "a rolled-back change must leave no audit trail");
  });
});

describe("EvaluationRuleService.update", () => {
  it("raises 404 for a rule outside the scheme", async () => {
    const { service, rules } = build();
    rules.set = [buildRule()];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, "rule_other", { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses to amend a rule of an active scheme", async () => {
    const { service, rules, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);
    rules.set = [buildRule()];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, RULE_ID, { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("validates a patched config against the STORED operation", async () => {
    const { service, rules } = build();
    rules.set = [buildRule({ operation: "CAP", config: { limit: 100 } })];

    // A MODERATION-shaped config against a stored CAP operation. Only the
    // service can catch this: the body carries no operation to check against.
    await rejectsWithStatus(
      service.update(
        TENANT_ID,
        SCHEME_ID,
        RULE_ID,
        { config: { targetMean: 60, targetStdDev: 10 } },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("accepts a patched operation supplied together with its config", async () => {
    const { service, rules } = build();
    rules.set = [buildRule({ operation: "CAP", config: { limit: 100 } })];

    await service.update(
      TENANT_ID,
      SCHEME_ID,
      RULE_ID,
      { operation: "MODERATION", config: { targetMean: 60, targetStdDev: 10 } },
      CONTEXT
    );

    assert.equal(rules.updates.length, 1);
  });

  it("does not re-read the component when it is unchanged", async () => {
    const { service, rules, components } = build();
    rules.set = [buildRule({ componentId: COMPONENT_ID, phase: "COMPONENT_ADJUSTMENT" })];

    await service.update(TENANT_ID, SCHEME_ID, RULE_ID, { name: "Renamed" }, CONTEXT);

    assert.equal(components.lookups, 0);
  });

  it("re-reads and validates a changed component", async () => {
    const { service, rules, components } = build();
    rules.set = [buildRule({ componentId: COMPONENT_ID, phase: "COMPONENT_ADJUSTMENT" })];
    components.component = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, RULE_ID, { componentId: "component_other" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.equal(components.lookups, 1);
  });

  it("does not treat a rule's own position as a collision", async () => {
    const { service, rules } = build();
    rules.set = [buildRule({ sequence: 3 })];

    await service.update(TENANT_ID, SCHEME_ID, RULE_ID, { sequence: 3 }, CONTEXT);

    assert.equal(rules.updates.length, 1);
  });

  it("refuses a move onto an occupied position", async () => {
    const { service, rules } = build();
    rules.set = [
      buildRule({ id: "rule_1", code: "A", sequence: 1 }),
      buildRule({ id: "rule_2", code: "B", sequence: 2 }),
    ];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, "rule_2", { sequence: 1 }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("records both the before and after snapshots", async () => {
    const { service, rules, audit } = build();
    rules.set = [buildRule({ name: "Original" })];

    await service.update(TENANT_ID, SCHEME_ID, RULE_ID, { name: "Renamed" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_RULE_UPDATED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("EvaluationRuleService.remove", () => {
  it("deletes a rule and audits what it contained", async () => {
    const { service, rules, audit } = build();
    rules.single = buildRule();

    await service.remove(TENANT_ID, SCHEME_ID, RULE_ID, CONTEXT);

    assert.deepEqual(rules.deleted, [RULE_ID]);
    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_RULE_DELETED");
    assert.notEqual(entry.before, undefined);
    assert.equal(entry.after, undefined);
  });

  it("raises 404 for a rule outside the scheme and deletes nothing", async () => {
    const { service, rules } = build();
    rules.single = null;

    await rejectsWithStatus(
      service.remove(TENANT_ID, SCHEME_ID, RULE_ID, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.deepEqual(rules.deleted, []);
  });

  it("refuses to delete from an active scheme", async () => {
    const { service, rules, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);
    rules.single = buildRule();

    await rejectsWithStatus(
      service.remove(TENANT_ID, SCHEME_ID, RULE_ID, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.deepEqual(rules.deleted, []);
  });
});

describe("EvaluationRuleService reads", () => {
  it("derives isCohortScoped from the operation", async () => {
    const { service, rules } = build();
    rules.set = [
      buildRule({ id: "a", code: "A", operation: "CAP", config: { limit: 100 } }),
      buildRule({
        id: "b",
        code: "B",
        sequence: 2,
        operation: "CURVE",
        config: { distribution: [{ grade: "O", topPercent: 10 }] },
      }),
    ];

    const result = await service.getAll(TENANT_ID, SCHEME_ID);

    assert.equal(result.rules[0].isCohortScoped, false);
    assert.equal(result.rules[1].isCohortScoped, true);
    assert.equal(result.requiresCohortComputation, true);
    assert.equal(result.ruleCount, 2);
  });

  it("reports no cohort requirement when every rule is per-student", async () => {
    const { service, rules } = build();
    rules.set = [buildRule()];

    const result = await service.getAll(TENANT_ID, SCHEME_ID);

    assert.equal(result.requiresCohortComputation, false);
  });

  it("marks a draft scheme mutable and an active one frozen", async () => {
    const { service, schemes } = build();

    assert.equal((await service.getAll(TENANT_ID, SCHEME_ID)).isMutable, true);

    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);
    assert.equal((await service.getAll(TENANT_ID, SCHEME_ID)).isMutable, false);
  });

  it("serialises dates as ISO strings", async () => {
    const { service, rules } = build();
    rules.single = buildRule();

    const result = await service.getById(TENANT_ID, SCHEME_ID, RULE_ID);

    assert.equal(result.createdAt, "2026-01-01T00:00:00.000Z");
  });

  it("raises 404 without reading the scheme, so no id is confirmed to exist", async () => {
    const { service, rules, schemes } = build();
    rules.single = null;
    schemes.scheme = null;

    await rejectsWithStatus(
      service.getById(TENANT_ID, SCHEME_ID, RULE_ID),
      HTTP_STATUS.NOT_FOUND
    );
  });
});

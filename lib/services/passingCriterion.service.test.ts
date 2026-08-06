// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion
// LAYER  : Service — Unit Tests
// PURPOSE: Prove every business rule this service owns — draft-only
//          mutability, metric/unit/component coherence on MERGED state, the
//          threshold's relationship to the component it constrains, audit and
//          transactional atomicity.
//
//          Request-shape rules have their own suite in
//          lib/validations/passingCriterion.test.ts, and SQL-level tenant
//          scoping has one in the repository suite. Neither is retested here.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { PassingCriterionService } from "@/lib/services/passingCriterion.service";
import { HTTP_STATUS } from "@/lib/constants/errors";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type { EvaluationComponentRecord } from "@/lib/repositories/evaluationComponent.repository";
import type {
  EvaluationComponentLookupPort,
  EvaluationSchemeLifecyclePort,
} from "@/lib/repositories/evaluationConfig.ports";
import type { EvaluationSchemeRecord } from "@/lib/repositories/evaluationScheme.repository";
import type {
  CreatePassingCriterionData,
  DbClient,
  PassingCriterionRecord,
  PassingCriterionRepositoryPort,
  UpdatePassingCriterionData,
} from "@/lib/repositories/passingCriterion.repository";
import type { CreatePassingCriterionInput } from "@/lib/validations/passingCriterion";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const SCHEME_ID = "scheme_1";
const CRITERION_ID = "criterion_1";
const COMPONENT_ID = "component_1";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

const TX = {} as DbClient;

function decimal(value: string): PassingCriterionRecord["threshold"] {
  return { toString: () => value } as PassingCriterionRecord["threshold"];
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

function buildComponent(maxMarks = "70.00"): EvaluationComponentRecord {
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
    maxMarks: decimal(maxMarks) as EvaluationComponentRecord["maxMarks"],
    weightage: decimal("100.00") as EvaluationComponentRecord["weightage"],
    aggregation: "SUM",
    rollup: null,
    ruleConfig: null,
    sequence: 1,
    isMandatory: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function buildCriterion(
  overrides: Partial<PassingCriterionRecord> = {}
): PassingCriterionRecord {
  return {
    id: CRITERION_ID,
    tenantId: TENANT_ID,
    schemeId: SCHEME_ID,
    componentId: COMPONENT_ID,
    code: "MIN-THEORY",
    name: "Minimum theory",
    description: null,
    metric: "COMPONENT_SCORE",
    threshold: decimal("21.00"),
    unit: "MARKS",
    failureOutcome: "FAIL",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  id: string;
  data: UpdatePassingCriterionData;
}

class FakeCriterionRepository implements PassingCriterionRepositoryPort {
  set: PassingCriterionRecord[] = [];
  single: PassingCriterionRecord | null = null;

  created: CreatePassingCriterionData | null = null;
  updates: UpdateCall[] = [];
  deleted: string[] = [];
  transactionCount = 0;

  async findAllBySchemeId(): Promise<PassingCriterionRecord[]> {
    return this.set;
  }

  async findById(): Promise<PassingCriterionRecord | null> {
    return this.single;
  }

  async create(data: CreatePassingCriterionData): Promise<PassingCriterionRecord> {
    this.created = data;
    return buildCriterion({
      id: "criterion_new",
      componentId: data.componentId,
      code: data.code,
      metric: data.metric,
      threshold: decimal(String(data.threshold)),
      unit: data.unit,
      failureOutcome: data.failureOutcome,
    });
  }

  async update(
    _tenantId: string,
    criterionId: string,
    data: UpdatePassingCriterionData
  ): Promise<PassingCriterionRecord> {
    this.updates.push({ id: criterionId, data });
    return buildCriterion({ ...this.single, id: criterionId });
  }

  async delete(_tenantId: string, criterionId: string): Promise<void> {
    this.deleted.push(criterionId);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return fn(TX);
  }

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
  service: PassingCriterionService;
  criteria: FakeCriterionRepository;
  audit: FakeAuditRepository;
  schemes: FakeSchemeLifecycle;
  components: FakeComponentLookup;
} {
  const criteria = new FakeCriterionRepository();
  const audit = new FakeAuditRepository();
  const schemes = new FakeSchemeLifecycle();
  const components = new FakeComponentLookup();

  return {
    service: new PassingCriterionService(criteria, audit, schemes, components),
    criteria,
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

/** "Theory must reach 21 of 70" — the canonical component minimum. */
const THEORY_MINIMUM: CreatePassingCriterionInput = {
  code: "MIN-THEORY",
  name: "Minimum theory",
  metric: "COMPONENT_SCORE",
  threshold: 21,
  unit: "MARKS",
  failureOutcome: "FAIL",
  componentId: COMPONENT_ID,
};

/** "Attendance must reach 75%" — the canonical eligibility rule. */
const ATTENDANCE_ELIGIBILITY: CreatePassingCriterionInput = {
  code: "ATT75",
  name: "Attendance eligibility",
  metric: "ATTENDANCE_PERCENT",
  threshold: 75,
  unit: "PERCENT",
  failureOutcome: "INELIGIBLE",
};

describe("PassingCriterionService.create — scheme lifecycle", () => {
  it("adds a criterion to a draft regulation", async () => {
    const { service, criteria } = build();

    const result = await service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT);

    assert.equal(criteria.created?.schemeId, SCHEME_ID);
    assert.equal(result.scope, "COURSE");
  });

  it("refuses an ACTIVE scheme with 409 and writes nothing", async () => {
    const { service, criteria, schemes, audit } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(criteria.writeCount, 0);
    assert.equal(audit.entries.length, 0);
  });

  it("refuses an ARCHIVED scheme with 409", async () => {
    const { service, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ARCHIVED);

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, schemes } = build();
    schemes.scheme = null;

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });
});

describe("PassingCriterionService.create — threshold validation", () => {
  it("accepts a marks threshold inside the component maximum", async () => {
    const { service } = build();

    const result = await service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT);

    assert.equal(result.threshold, "21");
  });

  it("accepts a threshold exactly equal to the component maximum", async () => {
    const { service, components } = build();
    components.component = buildComponent("70.00");

    const result = await service.create(
      TENANT_ID,
      SCHEME_ID,
      { ...THEORY_MINIMUM, threshold: 70 },
      CONTEXT
    );

    assert.equal(result.threshold, "70");
  });

  it("refuses a marks threshold above the component maximum", async () => {
    const { service, criteria, components } = build();
    components.component = buildComponent("70.00");

    await assert.rejects(
      service.create(TENANT_ID, SCHEME_ID, { ...THEORY_MINIMUM, threshold: 71 }, CONTEXT),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, HTTP_STATUS.BAD_REQUEST);
        assert.ok((err.details?.length ?? 0) > 0);
        return true;
      }
    );
    assert.equal(criteria.writeCount, 0);
  });

  it("compares exactly, so a two-decimal boundary is not a rounding accident", async () => {
    const { service, components } = build();
    components.component = buildComponent("21.00");

    // 21.00 vs 21.00 must be equal, and 21.01 must exceed. A float comparison
    // reached by different routes cannot be relied on for either.
    await service.create(TENANT_ID, SCHEME_ID, { ...THEORY_MINIMUM, threshold: 21 }, CONTEXT);

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, { ...THEORY_MINIMUM, threshold: 21.01 }, CONTEXT),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("does not check a percentage threshold against the component maximum", async () => {
    const { service, components } = build();
    components.component = buildComponent("70.00");

    // 80% of a 70-mark component is coherent; comparing 80 against 70 would not be.
    const result = await service.create(
      TENANT_ID,
      SCHEME_ID,
      { ...THEORY_MINIMUM, unit: "PERCENT", threshold: 80 },
      CONTEXT
    );

    assert.equal(result.unit, "PERCENT");
  });

  it("raises 404 when the named component is not in this scheme", async () => {
    const { service, components } = build();
    components.component = null;

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("reads no component for a metric that does not constrain one", async () => {
    const { service, components } = build();

    await service.create(TENANT_ID, SCHEME_ID, ATTENDANCE_ELIGIBILITY, CONTEXT);

    assert.equal(components.lookups, 0, "attendance is not a property of a component");
  });
});

describe("PassingCriterionService.create — coherence", () => {
  it("refuses a component-scoped metric with no component", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...THEORY_MINIMUM, componentId: undefined },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a non-component metric that names a component", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...ATTENDANCE_ELIGIBILITY, componentId: COMPONENT_ID },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a unit the metric does not permit", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...ATTENDANCE_ELIGIBILITY, unit: "CREDITS" },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a percentage threshold above 100", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...ATTENDANCE_ELIGIBILITY, threshold: 101 },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });
});

describe("PassingCriterionService.create — audit and transaction", () => {
  it("runs inside a transaction", async () => {
    const { service, criteria } = build();

    await service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT);

    assert.equal(criteria.transactionCount, 1);
  });

  it("writes a CREATED entry carrying the actor and origin", async () => {
    const { service, audit } = build();

    await service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "PASSING_CRITERION_CREATED");
    assert.equal(entry.resource, "PassingCriterion");
    assert.equal(entry.tenantId, TENANT_ID);
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });

  it("writes no audit entry when the operation is rejected", async () => {
    const { service, audit, components } = build();
    components.component = null;

    await assert.rejects(service.create(TENANT_ID, SCHEME_ID, THEORY_MINIMUM, CONTEXT));

    assert.equal(audit.entries.length, 0);
  });
});

describe("PassingCriterionService.update", () => {
  it("raises 404 for a criterion outside the scheme", async () => {
    const { service, criteria } = build();
    criteria.single = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses to amend a criterion of an active scheme", async () => {
    const { service, criteria, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);
    criteria.single = buildCriterion();

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("validates a patched unit against the STORED metric", async () => {
    const { service, criteria } = build();
    criteria.single = buildCriterion({ metric: "ATTENDANCE_PERCENT", componentId: null });

    // CREDITS is not permitted for ATTENDANCE_PERCENT. Only the service can
    // catch this: the body carries no metric to check against.
    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { unit: "CREDITS" }, CONTEXT),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("validates a patched threshold against the STORED component maximum", async () => {
    const { service, criteria, components } = build();
    criteria.single = buildCriterion();
    components.component = buildComponent("70.00");

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { threshold: 90 }, CONTEXT),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("does not re-read the component for a patch that cannot affect the bound", async () => {
    const { service, criteria, components } = build();
    criteria.single = buildCriterion();

    await service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { name: "Renamed" }, CONTEXT);

    assert.equal(components.lookups, 0);
  });

  it("re-reads the component when the threshold changes", async () => {
    const { service, criteria, components } = build();
    criteria.single = buildCriterion();

    await service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { threshold: 30 }, CONTEXT);

    assert.equal(components.lookups, 1);
  });

  it("records both the before and after snapshots", async () => {
    const { service, criteria, audit } = build();
    criteria.single = buildCriterion();

    await service.update(TENANT_ID, SCHEME_ID, CRITERION_ID, { name: "Renamed" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "PASSING_CRITERION_UPDATED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("PassingCriterionService.remove", () => {
  it("deletes a criterion and audits what it required", async () => {
    const { service, criteria, audit } = build();
    criteria.single = buildCriterion();

    await service.remove(TENANT_ID, SCHEME_ID, CRITERION_ID, CONTEXT);

    assert.deepEqual(criteria.deleted, [CRITERION_ID]);
    const [entry] = audit.entries;
    assert.equal(entry.action, "PASSING_CRITERION_DELETED");
    assert.notEqual(
      entry.before,
      undefined,
      "relaxing a requirement must leave evidence of what it was"
    );
    assert.equal(entry.after, undefined);
  });

  it("raises 404 for a criterion outside the scheme and deletes nothing", async () => {
    const { service, criteria } = build();
    criteria.single = null;

    await rejectsWithStatus(
      service.remove(TENANT_ID, SCHEME_ID, CRITERION_ID, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.deepEqual(criteria.deleted, []);
  });

  it("refuses to delete from an active scheme", async () => {
    const { service, criteria, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);
    criteria.single = buildCriterion();

    await rejectsWithStatus(
      service.remove(TENANT_ID, SCHEME_ID, CRITERION_ID, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.deepEqual(criteria.deleted, []);
  });
});

describe("PassingCriterionService reads", () => {
  it("derives scope from the metric and tallies both counts in one pass", async () => {
    const { service, criteria } = build();
    criteria.set = [
      buildCriterion({ id: "a", code: "A", metric: "COMPONENT_SCORE" }),
      buildCriterion({
        id: "b",
        code: "B",
        metric: "ATTENDANCE_PERCENT",
        componentId: null,
        unit: "PERCENT",
      }),
      buildCriterion({
        id: "c",
        code: "C",
        metric: "SEMESTER_CREDITS_EARNED",
        componentId: null,
        unit: "CREDITS",
      }),
    ];

    const result = await service.getAll(TENANT_ID, SCHEME_ID);

    assert.equal(result.criteria[0].scope, "COURSE");
    assert.equal(result.criteria[1].scope, "COURSE");
    assert.equal(result.criteria[2].scope, "SEMESTER");
    assert.equal(result.courseScopedCount, 2);
    assert.equal(result.semesterScopedCount, 1);
  });

  it("marks a draft scheme mutable and an active one frozen", async () => {
    const { service, schemes } = build();

    assert.equal((await service.getAll(TENANT_ID, SCHEME_ID)).isMutable, true);

    schemes.scheme = buildScheme(EvaluationSchemeStatus.ACTIVE);
    assert.equal((await service.getAll(TENANT_ID, SCHEME_ID)).isMutable, false);
  });

  it("serialises the threshold as a lossless string and dates as ISO", async () => {
    const { service, criteria } = build();
    criteria.single = buildCriterion({ threshold: decimal("21.50") });

    const result = await service.getById(TENANT_ID, SCHEME_ID, CRITERION_ID);

    assert.equal(result.threshold, "21.50");
    assert.equal(result.createdAt, "2026-01-01T00:00:00.000Z");
  });

  it("raises 404 without reading the scheme, so no id is confirmed to exist", async () => {
    const { service, criteria, schemes } = build();
    criteria.single = null;
    schemes.scheme = null;

    await rejectsWithStatus(
      service.getById(TENANT_ID, SCHEME_ID, CRITERION_ID),
      HTTP_STATUS.NOT_FOUND
    );
  });
});

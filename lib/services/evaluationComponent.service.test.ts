// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the rules the service owns: draft-only mutability, parentage,
//          cycle prevention, sibling ordering, subtree removal and audit.
//
//          The tree ARITHMETIC and structural rules are not retested here —
//          they live in lib/domain/evaluationComponentTree.ts and are covered
//          exhaustively by its own suite. Testing them twice would mean two
//          specifications of one rule, which is the duplication this module is
//          built to avoid.
//
//          As with the scheme service, no database is involved: the service
//          takes its repositories as constructor ports imported with
//          `import type`, so its runtime graph never reaches lib/db/prisma.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { EvaluationComponentService } from "@/lib/services/evaluationComponent.service";
import { HTTP_STATUS } from "@/lib/constants/errors";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  CreateEvaluationComponentData,
  DbClient,
  EvaluationComponentRecord,
  EvaluationComponentRepositoryPort,
  OwningSchemeRecord,
  UpdateEvaluationComponentData,
} from "@/lib/repositories/evaluationComponent.repository";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const SCHEME_ID = "scheme_1";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

/** A stand-in for an interactive transaction handle. */
const TX = {} as DbClient;

/** A stand-in for Prisma's Decimal — only .toString() is ever called on it. */
function decimal(value: string): EvaluationComponentRecord["maxMarks"] {
  return { toString: () => value } as EvaluationComponentRecord["maxMarks"];
}

function buildComponent(
  overrides: Partial<EvaluationComponentRecord> = {}
): EvaluationComponentRecord {
  return {
    id: "component_1",
    tenantId: TENANT_ID,
    schemeId: SCHEME_ID,
    parentComponentId: null,
    code: "THEORY",
    name: "Theory",
    description: null,
    type: "THEORY",
    sourceType: "MANUAL_ENTRY",
    maxMarks: decimal("100.00"),
    weightage: decimal("100.00"),
    aggregation: "SUM",
    rollup: null,
    ruleConfig: null,
    sequence: 1,
    isMandatory: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  id: string;
  data: UpdateEvaluationComponentData;
}

/**
 * An in-memory stand-in for the repository.
 *
 * Stores nothing and decides nothing: each method returns whatever the test
 * placed on it and records that it was called. Logic in the fake would mean a
 * passing test proved the fake correct rather than the service.
 */
class FakeComponentRepository implements EvaluationComponentRepositoryPort {
  scheme: OwningSchemeRecord | null = { id: SCHEME_ID, status: EvaluationSchemeStatus.DRAFT };
  tree: EvaluationComponentRecord[] = [];

  created: CreateEvaluationComponentData | null = null;
  updates: UpdateCall[] = [];
  deletedIds: string[] = [];

  async findScheme(): Promise<OwningSchemeRecord | null> {
    return this.scheme;
  }

  async findTreeBySchemeId(): Promise<EvaluationComponentRecord[]> {
    return this.tree;
  }

  async findById(): Promise<EvaluationComponentRecord | null> {
    return this.tree[0] ?? null;
  }

  async create(data: CreateEvaluationComponentData): Promise<EvaluationComponentRecord> {
    this.created = data;

    return buildComponent({
      id: "component_new",
      code: data.code,
      name: data.name,
      parentComponentId: data.parentComponentId,
      sequence: data.sequence,
      maxMarks: decimal(String(data.maxMarks)),
      weightage: decimal(String(data.weightage)),
      aggregation: data.aggregation,
      rollup: data.rollup,
    });
  }

  async update(
    _tenantId: string,
    componentId: string,
    data: UpdateEvaluationComponentData
  ): Promise<EvaluationComponentRecord> {
    this.updates.push({ id: componentId, data });

    const existing = this.tree.find((candidate) => candidate.id === componentId);

    return buildComponent({
      ...existing,
      id: componentId,
      parentComponentId:
        data.parentComponentId === undefined
          ? (existing?.parentComponentId ?? null)
          : data.parentComponentId,
      sequence: data.sequence ?? existing?.sequence ?? 1,
    });
  }

  async deleteMany(_tenantId: string, componentIds: readonly string[]): Promise<number> {
    this.deletedIds = [...componentIds];
    return componentIds.length;
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return fn(TX);
  }
}

class FakeAuditRepository implements AuditLogRepositoryPort {
  entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function build(): {
  service: EvaluationComponentService;
  components: FakeComponentRepository;
  audit: FakeAuditRepository;
} {
  const components = new FakeComponentRepository();
  const audit = new FakeAuditRepository();

  return {
    service: new EvaluationComponentService(components, audit),
    components,
    audit,
  };
}

function rejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, "expected an AppError");
    assert.equal(err.statusCode, status);
    return true;
  });
}

/** The create body used wherever the body itself is not what is under test. */
const CREATE_INPUT = {
  code: "THEORY",
  name: "Theory",
  type: "THEORY" as const,
  maxMarks: 100,
  weightage: 100,
  sequence: 1,
};

describe("EvaluationComponentService.create", () => {
  it("adds a top-level component to a draft scheme", async () => {
    const { service, components } = build();

    const result = await service.create(TENANT_ID, SCHEME_ID, CREATE_INPUT, CONTEXT);

    assert.equal(components.created?.schemeId, SCHEME_ID);
    assert.equal(components.created?.parentComponentId, null);
    assert.equal(result.isLeaf, true);
    assert.equal(result.depth, 1);
  });

  it("refuses to add to an active scheme with 409", async () => {
    const { service, components } = build();
    components.scheme = { id: SCHEME_ID, status: EvaluationSchemeStatus.ACTIVE };

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(components.created, null);
  });

  it("refuses to add to an archived scheme with 409", async () => {
    const { service, components } = build();
    components.scheme = { id: SCHEME_ID, status: EvaluationSchemeStatus.ARCHIVED };

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, components } = build();
    components.scheme = null;

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("raises 404 when the named parent is not in this scheme", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        SCHEME_ID,
        { ...CREATE_INPUT, parentComponentId: "missing" },
        CONTEXT
      ),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses a position already taken by a top-level sibling", async () => {
    const { service, components } = build();
    components.tree = [buildComponent({ sequence: 1 })];

    await rejectsWithStatus(
      service.create(TENANT_ID, SCHEME_ID, { ...CREATE_INPUT, code: "OTHER" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("permits the same position under a different parent", async () => {
    const { service, components } = build();
    components.tree = [buildComponent({ id: "parent_1", sequence: 1 })];

    const result = await service.create(
      TENANT_ID,
      SCHEME_ID,
      { ...CREATE_INPUT, code: "ST1", parentComponentId: "parent_1", sequence: 1 },
      CONTEXT
    );

    assert.equal(result.parentComponentId, "parent_1");
  });

  it("writes a CREATED audit entry carrying the actor and origin", async () => {
    const { service, audit } = build();

    await service.create(TENANT_ID, SCHEME_ID, CREATE_INPUT, CONTEXT);

    assert.equal(audit.entries.length, 1);
    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_COMPONENT_CREATED");
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.ipAddress, CONTEXT.ipAddress);
    assert.equal(entry.before, undefined);
  });
});

describe("EvaluationComponentService.update", () => {
  it("refuses to amend a component of an active scheme with 409", async () => {
    const { service, components } = build();
    components.scheme = { id: SCHEME_ID, status: EvaluationSchemeStatus.ACTIVE };
    components.tree = [buildComponent()];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, "component_1", { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("raises 404 for a component outside the scheme", async () => {
    const { service, components } = build();
    components.tree = [buildComponent()];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, "component_other", { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses a move beneath the component's own descendant with 409", async () => {
    const { service, components } = build();
    components.tree = [
      buildComponent({ id: "internal", code: "INTERNAL", rollup: "WEIGHTED_SUM", aggregation: null }),
      buildComponent({ id: "st1", code: "ST1", parentComponentId: "internal" }),
    ];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, "internal", { parentComponentId: "st1" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(components.updates.length, 0);
  });

  it("permits a legitimate move and promotion to the top level", async () => {
    const { service, components } = build();
    components.tree = [
      buildComponent({ id: "internal", code: "INTERNAL", rollup: "WEIGHTED_SUM", aggregation: null }),
      buildComponent({ id: "st1", code: "ST1", parentComponentId: "internal", sequence: 2 }),
    ];

    await service.update(TENANT_ID, SCHEME_ID, "st1", { parentComponentId: null }, CONTEXT);

    assert.equal(components.updates.length, 1);
    assert.equal(components.updates[0].data.parentComponentId, null);
  });

  it("does not treat a component's own position as a collision", async () => {
    const { service, components } = build();
    components.tree = [buildComponent({ sequence: 3 })];

    await service.update(TENANT_ID, SCHEME_ID, "component_1", { sequence: 3 }, CONTEXT);

    assert.equal(components.updates.length, 1);
  });

  it("refuses to move a component onto an occupied sibling position", async () => {
    const { service, components } = build();
    components.tree = [
      buildComponent({ id: "component_1", code: "A", sequence: 1 }),
      buildComponent({ id: "component_2", code: "B", sequence: 2 }),
    ];

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, "component_2", { sequence: 1 }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("records both the before and after snapshots", async () => {
    const { service, components, audit } = build();
    components.tree = [buildComponent()];

    await service.update(TENANT_ID, SCHEME_ID, "component_1", { name: "Renamed" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_COMPONENT_UPDATED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("EvaluationComponentService.remove", () => {
  it("removes a leaf on its own", async () => {
    const { service, components } = build();
    components.tree = [buildComponent()];

    const result = await service.remove(TENANT_ID, SCHEME_ID, "component_1", CONTEXT);

    assert.deepEqual(components.deletedIds, ["component_1"]);
    assert.equal(result.removedCount, 1);
  });

  it("removes a branch together with its whole subtree in one statement", async () => {
    const { service, components } = build();
    components.tree = [
      buildComponent({ id: "internal", code: "INTERNAL", rollup: "WEIGHTED_SUM", aggregation: null }),
      buildComponent({ id: "st1", code: "ST1", parentComponentId: "internal" }),
      buildComponent({ id: "st2", code: "ST2", parentComponentId: "internal", sequence: 2 }),
      buildComponent({ id: "theory", code: "THEORY_2", sequence: 2 }),
    ];

    const result = await service.remove(TENANT_ID, SCHEME_ID, "internal", CONTEXT);

    assert.deepEqual([...components.deletedIds].sort(), ["internal", "st1", "st2"]);
    assert.equal(result.removedCount, 3);
    assert.ok(!components.deletedIds.includes("theory"), "an unrelated root must survive");
  });

  it("audits every node that was removed, not just the one addressed", async () => {
    const { service, components, audit } = build();
    components.tree = [
      buildComponent({ id: "internal", code: "INTERNAL", rollup: "WEIGHTED_SUM", aggregation: null }),
      buildComponent({ id: "st1", code: "ST1", parentComponentId: "internal" }),
    ];

    await service.remove(TENANT_ID, SCHEME_ID, "internal", CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_COMPONENT_DELETED");
    assert.ok(Array.isArray(entry.before));
    assert.equal((entry.before as unknown[]).length, 2);
  });

  it("refuses to remove from an active scheme with 409", async () => {
    const { service, components } = build();
    components.scheme = { id: SCHEME_ID, status: EvaluationSchemeStatus.ACTIVE };
    components.tree = [buildComponent()];

    await rejectsWithStatus(
      service.remove(TENANT_ID, SCHEME_ID, "component_1", CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.deepEqual(components.deletedIds, []);
  });

  it("raises 404 for a component outside the scheme", async () => {
    const { service, components } = build();
    components.tree = [buildComponent()];

    await rejectsWithStatus(
      service.remove(TENANT_ID, SCHEME_ID, "component_other", CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });
});

describe("EvaluationComponentService.getTree", () => {
  it("nests children beneath their parent and derives isLeaf and depth", async () => {
    const { service, components } = build();
    components.tree = [
      buildComponent({
        id: "internal",
        code: "INTERNAL",
        rollup: "WEIGHTED_SUM",
        aggregation: null,
        sourceType: "COMPUTED",
        weightage: decimal("100.00"),
      }),
      buildComponent({
        id: "st1",
        code: "ST1",
        parentComponentId: "internal",
        weightage: decimal("100.00"),
      }),
    ];

    const result = await service.getTree(TENANT_ID, SCHEME_ID);

    assert.equal(result.tree.length, 1);
    assert.equal(result.tree[0].isLeaf, false);
    assert.equal(result.tree[0].depth, 1);
    assert.equal(result.tree[0].children.length, 1);
    assert.equal(result.tree[0].children[0].isLeaf, true);
    assert.equal(result.tree[0].children[0].depth, 2);
    assert.equal(result.componentCount, 2);
  });

  it("reports a valid tree as activatable", async () => {
    const { service, components } = build();
    components.tree = [buildComponent()];

    const result = await service.getTree(TENANT_ID, SCHEME_ID);

    assert.equal(result.validation.isValid, true);
    assert.deepEqual(result.validation.violations, []);
  });

  it("reports why an incomplete tree is not yet activatable", async () => {
    const { service, components } = build();
    components.tree = [buildComponent({ weightage: decimal("40.00") })];

    const result = await service.getTree(TENANT_ID, SCHEME_ID);

    assert.equal(result.validation.isValid, false);
    assert.ok(result.validation.violations.length > 0);
  });

  it("marks a draft scheme mutable and an active one frozen", async () => {
    const { service, components } = build();
    components.tree = [buildComponent()];

    const draft = await service.getTree(TENANT_ID, SCHEME_ID);
    assert.equal(draft.isMutable, true);

    components.scheme = { id: SCHEME_ID, status: EvaluationSchemeStatus.ACTIVE };
    const active = await service.getTree(TENANT_ID, SCHEME_ID);
    assert.equal(active.isMutable, false);
  });

  it("serialises decimals as lossless strings", async () => {
    const { service, components } = build();
    components.tree = [buildComponent({ weightage: decimal("33.33") })];

    const result = await service.getTree(TENANT_ID, SCHEME_ID);

    assert.equal(result.tree[0].weightage, "33.33");
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, components } = build();
    components.scheme = null;

    await rejectsWithStatus(service.getTree(TENANT_ID, SCHEME_ID), HTTP_STATUS.NOT_FOUND);
  });
});

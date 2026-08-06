// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the business rules the service exists to hold, without a
//          database, a network or an environment.
//
// WHY THERE IS NO TEST FRAMEWORK DEPENDENCY
//   The project had no test runner. Rather than add jest or vitest — a
//   dependency, a config file, a transform pipeline and a second module
//   resolver, all of which can break `npm run build` — these tests use Node's
//   built-in runner (node:test) with tsx, which is already a devDependency.
//   Zero new packages. @types/node ships the typings, so `tsc --noEmit` covers
//   this file like any other.
//
// WHY THIS CAN BE A UNIT TEST AT ALL
//   EvaluationSchemeService takes its two repositories as constructor ports and
//   imports them with `import type`, so its runtime module graph never reaches
//   lib/db/prisma. Nothing here opens a connection, reads DATABASE_URL, or
//   needs a running PostgreSQL.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EvaluationSchemeStatus, GradeScaleStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { EvaluationSchemeService } from "@/lib/services/evaluationScheme.service";
import { FIRST_VERSION } from "@/lib/constants/evaluationScheme";
import { HTTP_STATUS } from "@/lib/constants/errors";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  EvaluationComponentRecord,
  EvaluationComponentTreePort,
} from "@/lib/repositories/evaluationComponent.repository";
import type {
  CreateEvaluationSchemeData,
  DbClient,
  EvaluationSchemeDetailRecord,
  EvaluationSchemeRecord,
  EvaluationSchemeRepositoryPort,
  EvaluationSchemeVersionRecord,
  GradeScaleReferenceRecord,
  UpdateEvaluationSchemeData,
} from "@/lib/repositories/evaluationScheme.repository";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const SCHEME_ID = "scheme_1";
const GRADE_SCALE_ID = "scale_1";
const SCHEME_CODE = "BTECH-R2023";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

/**
 * A stand-in for an interactive transaction handle.
 *
 * The service only ever forwards this value to the repository; it never calls a
 * method on it. An empty object is therefore a faithful double, and the cast is
 * confined to this one line.
 */
const TX = {} as DbClient;

/** A stand-in for Prisma's Decimal — the service only calls .toString() on it. */
function decimal(value: string): EvaluationSchemeDetailRecord["gradeScale"]["maxGradePoint"] {
  return {
    toString: () => value,
  } as EvaluationSchemeDetailRecord["gradeScale"]["maxGradePoint"];
}

function buildRecord(overrides: Partial<EvaluationSchemeRecord> = {}): EvaluationSchemeRecord {
  return {
    id: SCHEME_ID,
    tenantId: TENANT_ID,
    code: SCHEME_CODE,
    name: "B.Tech Regulation 2023",
    description: null,
    version: 1,
    status: EvaluationSchemeStatus.DRAFT,
    gradeScaleId: GRADE_SCALE_ID,
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
    ...overrides,
  };
}

function buildDetail(
  overrides: Partial<EvaluationSchemeRecord> = {},
  scaleStatus: GradeScaleStatus = GradeScaleStatus.ACTIVE
): EvaluationSchemeDetailRecord {
  return {
    ...buildRecord(overrides),
    gradeScale: {
      id: GRADE_SCALE_ID,
      code: "UG-10-POINT",
      name: "Undergraduate 10 Point",
      version: 1,
      status: scaleStatus,
      method: "ABSOLUTE",
      maxGradePoint: decimal("10.00"),
    },
  };
}

/** One recorded call to update(), so a test can assert what was written. */
interface UpdateCall {
  id: string;
  data: UpdateEvaluationSchemeData;
}

/**
 * An in-memory stand-in for the repository.
 *
 * It stores nothing and decides nothing — every method returns whatever the
 * test placed on it and records that it was called. That is deliberate: if the
 * fake contained logic, a passing test would prove the fake correct rather than
 * the service.
 */
class FakeSchemeRepository implements EvaluationSchemeRepositoryPort {
  gradeScale: GradeScaleReferenceRecord | null = { id: GRADE_SCALE_ID, status: "ACTIVE" };
  versions: EvaluationSchemeVersionRecord[] = [];
  record: EvaluationSchemeRecord | null = null;
  detail: EvaluationSchemeDetailRecord | null = null;
  active: { id: string } | null = null;
  page: [EvaluationSchemeRecord[], number] = [[], 0];

  gradeScaleLookups = 0;
  updates: UpdateCall[] = [];
  deletes: string[] = [];
  created: CreateEvaluationSchemeData | null = null;
  isolationLevel: string | undefined = undefined;

  // Parameters the fake does not consult are omitted rather than named with a
  // leading underscore: this project's ESLint config carries no
  // argsIgnorePattern, so an unused named parameter is reported. A method with
  // fewer parameters remains assignable to the port's signature.
  async listWithCount(): Promise<[EvaluationSchemeRecord[], number]> {
    return this.page;
  }

  async findById(): Promise<EvaluationSchemeRecord | null> {
    return this.record;
  }

  async findDetailById(): Promise<EvaluationSchemeDetailRecord | null> {
    return this.detail;
  }

  async findVersionsByCode(): Promise<EvaluationSchemeVersionRecord[]> {
    return this.versions;
  }

  async findActiveByCode(): Promise<{ id: string } | null> {
    return this.active;
  }

  async findGradeScale(): Promise<GradeScaleReferenceRecord | null> {
    this.gradeScaleLookups += 1;
    return this.gradeScale;
  }

  async create(data: CreateEvaluationSchemeData): Promise<EvaluationSchemeDetailRecord> {
    this.created = data;
    return buildDetail({
      code: data.code,
      name: data.name,
      description: data.description,
      version: data.version,
      gradeScaleId: data.gradeScaleId,
      createdById: data.createdById,
    });
  }

  async update(
    _tenantId: string,
    id: string,
    data: UpdateEvaluationSchemeData
  ): Promise<EvaluationSchemeDetailRecord> {
    this.updates.push({ id, data });
    return buildDetail({ id, ...data });
  }

  async delete(_tenantId: string, id: string): Promise<void> {
    this.deletes.push(id);
  }

  async transaction<T>(
    fn: (tx: DbClient) => Promise<T>,
    options?: { isolationLevel?: string }
  ): Promise<T> {
    this.isolationLevel = options?.isolationLevel;
    return fn(TX);
  }
}

/** Captures audit entries so a test can assert what was recorded. */
class FakeAuditRepository implements AuditLogRepositoryPort {
  entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/**
 * The smallest component tree that is valid for activation: one top-level leaf
 * carrying the whole 100% weight.
 *
 * Activation validates the tree, so every activation test needs one. Making the
 * default VALID keeps each test about the one thing it is testing; the tests
 * that care about tree validation replace it deliberately.
 */
function buildValidTree(): EvaluationComponentRecord[] {
  return [
    {
      id: "component_1",
      tenantId: TENANT_ID,
      schemeId: SCHEME_ID,
      parentComponentId: null,
      code: "THEORY",
      name: "Theory",
      description: null,
      type: "THEORY",
      sourceType: "MANUAL_ENTRY",
      maxMarks: decimal("100.00") as EvaluationComponentRecord["maxMarks"],
      weightage: decimal("100.00") as EvaluationComponentRecord["weightage"],
      aggregation: "SUM",
      rollup: null,
      ruleConfig: null,
      sequence: 1,
      isMandatory: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];
}

/** Supplies the component tree that scheme activation validates. */
class FakeComponentTreeRepository implements EvaluationComponentTreePort {
  components: EvaluationComponentRecord[] = buildValidTree();

  async findTreeBySchemeId(): Promise<EvaluationComponentRecord[]> {
    return this.components;
  }
}

function build(): {
  service: EvaluationSchemeService;
  schemes: FakeSchemeRepository;
  audit: FakeAuditRepository;
  components: FakeComponentTreeRepository;
} {
  const schemes = new FakeSchemeRepository();
  const audit = new FakeAuditRepository();
  const components = new FakeComponentTreeRepository();

  return {
    service: new EvaluationSchemeService(schemes, audit, components),
    schemes,
    audit,
    components,
  };
}

/** Assert a rejection is an AppError carrying the expected HTTP status. */
function rejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, "expected an AppError");
    assert.equal(err.statusCode, status);
    return true;
  });
}

describe("EvaluationSchemeService.create", () => {
  it("assigns the first version when the code has no revisions", async () => {
    const { service, schemes } = build();
    schemes.versions = [];

    const result = await service.create(
      TENANT_ID,
      { code: SCHEME_CODE, name: "R2023", gradeScaleId: GRADE_SCALE_ID },
      CONTEXT
    );

    assert.equal(schemes.created?.version, FIRST_VERSION);
    assert.equal(result.version, FIRST_VERSION);
  });

  it("assigns one above the highest existing version", async () => {
    const { service, schemes } = build();
    schemes.versions = [
      { id: "s3", version: 3, status: EvaluationSchemeStatus.ARCHIVED },
      { id: "s2", version: 2, status: EvaluationSchemeStatus.ACTIVE },
      { id: "s1", version: 1, status: EvaluationSchemeStatus.ARCHIVED },
    ];

    const result = await service.create(
      TENANT_ID,
      { code: SCHEME_CODE, name: "R2023", gradeScaleId: GRADE_SCALE_ID },
      CONTEXT
    );

    assert.equal(result.version, 4);
  });

  it("rejects a second draft of the same code with 409", async () => {
    const { service, schemes } = build();
    schemes.versions = [{ id: "s1", version: 1, status: EvaluationSchemeStatus.DRAFT }];

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        { code: SCHEME_CODE, name: "R2023", gradeScaleId: GRADE_SCALE_ID },
        CONTEXT
      ),
      HTTP_STATUS.CONFLICT
    );
  });

  it("rejects an unknown grade scale with 404", async () => {
    const { service, schemes } = build();
    schemes.gradeScale = null;

    await rejectsWithStatus(
      service.create(
        TENANT_ID,
        { code: SCHEME_CODE, name: "R2023", gradeScaleId: GRADE_SCALE_ID },
        CONTEXT
      ),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("allows a draft scheme to cite a draft grade scale", async () => {
    const { service, schemes } = build();
    schemes.gradeScale = { id: GRADE_SCALE_ID, status: GradeScaleStatus.DRAFT };

    const result = await service.create(
      TENANT_ID,
      { code: SCHEME_CODE, name: "R2023", gradeScaleId: GRADE_SCALE_ID },
      CONTEXT
    );

    assert.equal(result.status, EvaluationSchemeStatus.DRAFT);
  });

  it("writes a CREATED audit entry carrying the actor and origin", async () => {
    const { service, audit } = build();

    await service.create(
      TENANT_ID,
      { code: SCHEME_CODE, name: "R2023", gradeScaleId: GRADE_SCALE_ID },
      CONTEXT
    );

    assert.equal(audit.entries.length, 1);
    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_SCHEME_CREATED");
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.ipAddress, CONTEXT.ipAddress);
    assert.equal(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("EvaluationSchemeService.update", () => {
  it("refuses to amend an active revision with 409", async () => {
    const { service, schemes } = build();
    schemes.record = buildRecord({ status: EvaluationSchemeStatus.ACTIVE });

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("refuses to amend an archived revision with 409", async () => {
    const { service, schemes } = build();
    schemes.record = buildRecord({ status: EvaluationSchemeStatus.ARCHIVED });

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, { name: "Renamed" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("does not re-read the grade scale when it is unchanged", async () => {
    const { service, schemes } = build();
    schemes.record = buildRecord();

    await service.update(TENANT_ID, SCHEME_ID, { gradeScaleId: GRADE_SCALE_ID }, CONTEXT);

    assert.equal(schemes.gradeScaleLookups, 0);
  });

  it("verifies a changed grade scale and rejects an unknown one with 404", async () => {
    const { service, schemes } = build();
    schemes.record = buildRecord();
    schemes.gradeScale = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, SCHEME_ID, { gradeScaleId: "scale_other" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.equal(schemes.gradeScaleLookups, 1);
  });

  it("records both the before and after snapshots", async () => {
    const { service, schemes, audit } = build();
    schemes.record = buildRecord({ name: "Original" });

    await service.update(TENANT_ID, SCHEME_ID, { name: "Renamed" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_SCHEME_UPDATED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("EvaluationSchemeService.activate", () => {
  it("runs under the serializable isolation level", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail();

    await service.activate(TENANT_ID, SCHEME_ID, CONTEXT);

    assert.equal(schemes.isolationLevel, "Serializable");
  });

  it("refuses a revision that is not a draft with 409", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail({ status: EvaluationSchemeStatus.ACTIVE });

    await rejectsWithStatus(
      service.activate(TENANT_ID, SCHEME_ID, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("refuses when the cited grade scale is not active, with 409", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail({}, GradeScaleStatus.DRAFT);

    await rejectsWithStatus(
      service.activate(TENANT_ID, SCHEME_ID, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("archives the outgoing revision and points it at the incoming one", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail();
    schemes.active = { id: "scheme_previous" };

    await service.activate(TENANT_ID, SCHEME_ID, CONTEXT);

    assert.equal(schemes.updates.length, 2);

    const [supersede, activate] = schemes.updates;
    assert.equal(supersede.id, "scheme_previous");
    assert.equal(supersede.data.status, EvaluationSchemeStatus.ARCHIVED);
    assert.equal(supersede.data.supersededById, SCHEME_ID);
    assert.ok(supersede.data.archivedAt instanceof Date);

    assert.equal(activate.id, SCHEME_ID);
    assert.equal(activate.data.status, EvaluationSchemeStatus.ACTIVE);
    assert.equal(activate.data.activatedById, CONTEXT.actorId);
    assert.ok(activate.data.activatedAt instanceof Date);
  });

  it("performs a single update when no revision is currently active", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail();
    schemes.active = null;

    await service.activate(TENANT_ID, SCHEME_ID, CONTEXT);

    assert.equal(schemes.updates.length, 1);
    assert.equal(schemes.updates[0].id, SCHEME_ID);
  });

  it("stamps both revisions with the same instant", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail();
    schemes.active = { id: "scheme_previous" };

    await service.activate(TENANT_ID, SCHEME_ID, CONTEXT);

    const [supersede, activate] = schemes.updates;
    assert.equal(
      supersede.data.archivedAt?.getTime(),
      activate.data.activatedAt?.getTime(),
      "supersession and activation must share one timestamp"
    );
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, schemes } = build();
    schemes.detail = null;

    await rejectsWithStatus(
      service.activate(TENANT_ID, SCHEME_ID, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses a scheme with no components at all", async () => {
    const { service, schemes, components } = build();
    schemes.detail = buildDetail();
    components.components = [];

    await rejectsWithStatus(
      service.activate(TENANT_ID, SCHEME_ID, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(schemes.updates.length, 0, "nothing may be written when the tree is rejected");
  });

  it("refuses a component tree whose weights do not total 100", async () => {
    const { service, schemes, components } = build();
    schemes.detail = buildDetail();
    components.components = [
      { ...buildValidTree()[0], weightage: decimal("70.00") as EvaluationComponentRecord["weightage"] },
    ];

    await assert.rejects(service.activate(TENANT_ID, SCHEME_ID, CONTEXT), (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, HTTP_STATUS.CONFLICT);
      assert.ok(err.details !== undefined && err.details.length > 0, "violations must be reported");
      return true;
    });
  });

  it("reports every violation at once rather than only the first", async () => {
    const { service, schemes, components } = build();
    schemes.detail = buildDetail();
    components.components = [
      {
        ...buildValidTree()[0],
        weightage: decimal("70.00") as EvaluationComponentRecord["weightage"],
        aggregation: null,
      },
    ];

    await assert.rejects(service.activate(TENANT_ID, SCHEME_ID, CONTEXT), (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.ok((err.details?.length ?? 0) >= 2, "a missing aggregation AND a bad total");
      return true;
    });
  });
});

describe("EvaluationSchemeService.archive", () => {
  it("archives an active revision without recording a successor", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail({ status: EvaluationSchemeStatus.ACTIVE });

    await service.archive(TENANT_ID, SCHEME_ID, CONTEXT);

    const [update] = schemes.updates;
    assert.equal(update.data.status, EvaluationSchemeStatus.ARCHIVED);
    assert.equal(update.data.supersededById, undefined);
  });

  it("refuses a draft with 409", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail({ status: EvaluationSchemeStatus.DRAFT });

    await rejectsWithStatus(service.archive(TENANT_ID, SCHEME_ID, CONTEXT), HTTP_STATUS.CONFLICT);
  });

  it("refuses an already archived revision with 409", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail({ status: EvaluationSchemeStatus.ARCHIVED });

    await rejectsWithStatus(service.archive(TENANT_ID, SCHEME_ID, CONTEXT), HTTP_STATUS.CONFLICT);
  });
});

describe("EvaluationSchemeService.remove", () => {
  it("discards a draft and audits what it contained", async () => {
    const { service, schemes, audit } = build();
    schemes.record = buildRecord();

    await service.remove(TENANT_ID, SCHEME_ID, CONTEXT);

    assert.deepEqual(schemes.deletes, [SCHEME_ID]);
    const [entry] = audit.entries;
    assert.equal(entry.action, "EVALUATION_SCHEME_DELETED");
    assert.notEqual(entry.before, undefined);
    assert.equal(entry.after, undefined);
  });

  it("refuses to delete an active revision with 409", async () => {
    const { service, schemes } = build();
    schemes.record = buildRecord({ status: EvaluationSchemeStatus.ACTIVE });

    await rejectsWithStatus(service.remove(TENANT_ID, SCHEME_ID, CONTEXT), HTTP_STATUS.CONFLICT);
    assert.deepEqual(schemes.deletes, []);
  });

  it("refuses to delete an archived revision with 409", async () => {
    const { service, schemes } = build();
    schemes.record = buildRecord({ status: EvaluationSchemeStatus.ARCHIVED });

    await rejectsWithStatus(service.remove(TENANT_ID, SCHEME_ID, CONTEXT), HTTP_STATUS.CONFLICT);
  });
});

describe("EvaluationSchemeService reads", () => {
  it("computes pagination from the total and the page size", async () => {
    const { service, schemes } = build();
    schemes.page = [[buildRecord()], 45];

    const result = await service.list(TENANT_ID, { page: 2, limit: 20 });

    assert.equal(result.schemes.length, 1);
    assert.deepEqual(result.pagination, { page: 2, limit: 20, total: 45, totalPages: 3 });
  });

  it("serialises dates as ISO strings and decimals as lossless strings", async () => {
    const { service, schemes } = build();
    schemes.detail = buildDetail();

    const result = await service.getById(TENANT_ID, SCHEME_ID);

    assert.equal(result.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(result.activatedAt, null);
    assert.equal(result.gradeScale.maxGradePoint, "10.00");
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, schemes } = build();
    schemes.detail = null;

    await rejectsWithStatus(service.getById(TENANT_ID, SCHEME_ID), HTTP_STATUS.NOT_FOUND);
  });
});

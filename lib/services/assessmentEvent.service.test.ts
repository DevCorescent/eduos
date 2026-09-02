// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event
// LAYER  : Service — Unit Tests
// PURPOSE: Prove every business rule this service owns — reference validation,
//          scheme activation, sitting-number assignment, maxMarks defaulting,
//          the edit window, the lifecycle state machine, audit and
//          transactional atomicity.
//
//          The lifecycle cases carry the most weight, because the state machine
//          IS the locking and publication workflow: OPEN is the only status
//          that accepts marks, OPEN → PUBLISHED is deliberately impossible, and
//          two transitions run backwards so a mistake is correctable.
//
//          No database, no environment: the service takes its three
//          dependencies as constructor ports imported with `import type`.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AssessmentEventStatus, EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { AssessmentEventService } from "@/lib/services/assessmentEvent.service";
import { HTTP_STATUS } from "@/lib/constants/errors";
import { MAX_SEQUENCE } from "@/lib/constants/assessmentEvent";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  AssessmentEventRecord,
  AssessmentEventRepositoryPort,
  CreateAssessmentEventData,
  DbClient,
  UpdateAssessmentEventData,
} from "@/lib/repositories/assessmentEvent.repository";
import type { EvaluationSchemeLifecyclePort } from "@/lib/repositories/evaluationConfig.ports";
import type { EvaluationSchemeRecord } from "@/lib/repositories/evaluationScheme.repository";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const EVENT_ID = "event_1";
const DEPARTMENT_ID = "dept_cse";
const COMPONENT_ID = "component_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "semester_1";
const SECTION_ID = "section_1";
const SCHEME_ID = "scheme_1";
const FACULTY_ID = "faculty_1";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

const TX = {} as DbClient;

function decimal(value: string): AssessmentEventRecord["maxMarks"] {
  return { toString: () => value } as AssessmentEventRecord["maxMarks"];
}

function buildScheme(status: EvaluationSchemeStatus): EvaluationSchemeRecord {
  return {
    id: SCHEME_ID,
    tenantId: TENANT_ID,
    code: "BTECH-R2025",
    name: "B.Tech Regulation 2025",
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

function buildEvent(overrides: Partial<AssessmentEventRecord> = {}): AssessmentEventRecord {
  return {
    id: EVENT_ID,
    tenantId: TENANT_ID,
    evaluationComponentId: COMPONENT_ID,
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    sectionId: SECTION_ID,
    title: "ST1 — March 2026",
    maxMarks: decimal("30.00"),
    sequenceNumber: 1,
    scheduledAt: null,
    conductedById: null,
    status: AssessmentEventStatus.DRAFT,
    statusChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  id: string;
  data: UpdateAssessmentEventData;
}

class FakeEventRepository implements AssessmentEventRepositoryPort {
  component: { id: string; schemeId: string; maxMarks: AssessmentEventRecord["maxMarks"] } | null =
    { id: COMPONENT_ID, schemeId: SCHEME_ID, maxMarks: decimal("30") };
  course: { id: string } | null = { id: COURSE_ID };
  semester: { id: string } | null = { id: SEMESTER_ID };
  section: { id: string } | null = { id: SECTION_ID };
  faculty: { id: string } | null = { id: FACULTY_ID };
  maxSequence: number | null = null;
  single: AssessmentEventRecord | null = null;
  page: [AssessmentEventRecord[], number] = [[], 0];

  created: CreateAssessmentEventData | null = null;
  updates: UpdateCall[] = [];
  transactionCount = 0;
  facultyLookups = 0;

  /** Whether the head's department owns the course. Set per test. */
  departmentOwnsCourse = false;
  departmentChecks = 0;

  async courseBelongsToDepartment(): Promise<boolean> {
    this.departmentChecks += 1;
    return this.departmentOwnsCourse;
  }

  listDepartmentId: string | null | undefined = undefined;

  async listWithCount(
    _tenantId?: unknown,
    _filter?: unknown,
    _skip?: unknown,
    _take?: unknown,
    departmentId: string | null = null
  ): Promise<[AssessmentEventRecord[], number]> {
    this.listDepartmentId = departmentId;
    return this.page;
  }

  async findById(): Promise<AssessmentEventRecord | null> {
    return this.single;
  }

  async findMaxSequence(): Promise<number | null> {
    return this.maxSequence;
  }

  async create(data: CreateAssessmentEventData): Promise<AssessmentEventRecord> {
    this.created = data;
    return buildEvent({
      id: "event_new",
      maxMarks: decimal(data.maxMarks.toFixed(2)),
      sequenceNumber: data.sequenceNumber,
      sectionId: data.sectionId,
      title: data.title,
      scheduledAt: data.scheduledAt,
      conductedById: data.conductedById,
    });
  }

  /**
   * Apply the patch field by field rather than spreading it.
   *
   * The update payload carries maxMarks as a NUMBER, while a record carries a
   * Decimal — a blind spread would hand the service a shape the database never
   * produces, and the test would then be exercising a fiction.
   */
  async update(
    _tenantId: string,
    id: string,
    data: UpdateAssessmentEventData
  ): Promise<AssessmentEventRecord> {
    this.updates.push({ id, data });

    const base = this.single ?? buildEvent();

    return buildEvent({
      ...base,
      id,
      title: data.title ?? base.title,
      maxMarks: data.maxMarks === undefined ? base.maxMarks : decimal(data.maxMarks.toFixed(2)),
      scheduledAt: data.scheduledAt ?? base.scheduledAt,
      conductedById:
        data.conductedById === undefined ? base.conductedById : data.conductedById,
      status: data.status ?? base.status,
      statusChangedAt: data.statusChangedAt ?? base.statusChangedAt,
    });
  }

  async findComponent(): Promise<
    { id: string; schemeId: string; maxMarks: AssessmentEventRecord["maxMarks"] } | null
  > {
    return this.component;
  }

  async findCourse(): Promise<{ id: string } | null> {
    return this.course;
  }

  async findSemester(): Promise<{ id: string } | null> {
    return this.semester;
  }

  async findSection(): Promise<{ id: string } | null> {
    return this.section;
  }

  async findFaculty(): Promise<{ id: string } | null> {
    this.facultyLookups += 1;
    return this.faculty;
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return fn(TX);
  }

  get writeCount(): number {
    return (this.created === null ? 0 : 1) + this.updates.length;
  }
}

class FakeAuditRepository implements AuditLogRepositoryPort {
  entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeSchemeLifecycle implements EvaluationSchemeLifecyclePort {
  scheme: EvaluationSchemeRecord | null = buildScheme(EvaluationSchemeStatus.ACTIVE);

  async findById(): Promise<EvaluationSchemeRecord | null> {
    return this.scheme;
  }
}

function build(): {
  service: AssessmentEventService;
  events: FakeEventRepository;
  audit: FakeAuditRepository;
  schemes: FakeSchemeLifecycle;
} {
  const events = new FakeEventRepository();
  const audit = new FakeAuditRepository();
  const schemes = new FakeSchemeLifecycle();

  return {
    service: new AssessmentEventService(events, audit, schemes),
    events,
    audit,
    schemes,
  };
}

function rejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, "expected an AppError");
    assert.equal(err.statusCode, status);
    return true;
  });
}

const CREATE_INPUT = {
  evaluationComponentId: COMPONENT_ID,
  courseId: COURSE_ID,
  semesterId: SEMESTER_ID,
  title: "ST1 — March 2026",
};

describe("AssessmentEventService.create — references", () => {
  it("schedules a sitting", async () => {
    const { service, events } = build();

    const result = await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    assert.equal(events.created?.evaluationComponentId, COMPONENT_ID);
    assert.equal(result.status, "DRAFT");
    assert.equal(result.acceptsMarks, false, "a draft sitting accepts no marks");
    assert.equal(result.isEditable, true);
  });

  it("raises 404 for a component outside the tenant", async () => {
    const { service, events } = build();
    events.component = null;

    await rejectsWithStatus(
      service.create(TENANT_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.equal(events.writeCount, 0);
  });

  it("raises 404 for a course, semester, section or faculty outside the tenant", async () => {
    for (const missing of ["course", "semester", "section", "faculty"] as const) {
      const { service, events } = build();
      events[missing] = null;

      const input =
        missing === "section"
          ? { ...CREATE_INPUT, sectionId: SECTION_ID }
          : missing === "faculty"
            ? { ...CREATE_INPUT, conductedById: FACULTY_ID }
            : CREATE_INPUT;

      await rejectsWithStatus(
        service.create(TENANT_ID, input, CONTEXT),
        HTTP_STATUS.NOT_FOUND
      );
    }
  });

  it("refuses a DRAFT regulation, whose rules could still change", async () => {
    const { service, schemes, events } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.DRAFT);

    await rejectsWithStatus(
      service.create(TENANT_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(events.writeCount, 0);
  });

  it("refuses an ARCHIVED regulation, which is no longer in force", async () => {
    const { service, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ARCHIVED);

    await rejectsWithStatus(
      service.create(TENANT_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });
});

describe("AssessmentEventService.create — maxMarks and sequence", () => {
  it("defaults maxMarks to the component's own scale", async () => {
    const { service, events } = build();
    events.component = { id: COMPONENT_ID, schemeId: SCHEME_ID, maxMarks: decimal("30") };

    await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    assert.equal(events.created?.maxMarks, 30);
  });

  it("accepts a different total, because a paper may be set out of one", async () => {
    const { service, events } = build();

    await service.create(TENANT_ID, { ...CREATE_INPUT, maxMarks: 25 }, CONTEXT);

    assert.equal(
      events.created?.maxMarks,
      25,
      "a test conducted out of 25 and contributing on 30 is reconciled by a SCALE rule"
    );
  });

  it("assigns the first sitting number when none exists", async () => {
    const { service, events } = build();
    events.maxSequence = null;

    const result = await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    assert.equal(result.sequenceNumber, 1);
  });

  it("assigns the next sitting number, so BEST_N can count them", async () => {
    const { service, events } = build();
    events.maxSequence = 2;

    const result = await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    assert.equal(result.sequenceNumber, 3);
  });

  it("refuses to exceed the sitting ceiling", async () => {
    const { service, events } = build();
    events.maxSequence = MAX_SEQUENCE;

    await rejectsWithStatus(
      service.create(TENANT_ID, CREATE_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("reads no faculty when none is named", async () => {
    const { service, events } = build();

    await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    assert.equal(events.facultyLookups, 0);
  });
});

describe("AssessmentEventService.create — audit and transaction", () => {
  it("runs inside a transaction", async () => {
    const { service, events } = build();

    await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    assert.equal(events.transactionCount, 1);
  });

  it("writes a CREATED entry carrying the actor and origin", async () => {
    const { service, audit } = build();

    await service.create(TENANT_ID, CREATE_INPUT, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "ASSESSMENT_EVENT_CREATED");
    assert.equal(entry.resource, "AssessmentEvent");
    assert.equal(entry.tenantId, TENANT_ID);
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.before, undefined);
  });

  it("writes no audit entry when the sitting is rejected", async () => {
    const { service, audit, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.DRAFT);

    await assert.rejects(service.create(TENANT_ID, CREATE_INPUT, CONTEXT));

    assert.equal(audit.entries.length, 0);
  });
});

describe("AssessmentEventService.update — the edit window", () => {
  it("amends a draft sitting", async () => {
    const { service, events } = build();
    events.single = buildEvent({ status: AssessmentEventStatus.DRAFT });

    await service.update(TENANT_ID, EVENT_ID, { title: "Renamed" }, CONTEXT);

    assert.equal(events.updates[0].data.title, "Renamed");
  });

  it("refuses to amend once entry has opened", async () => {
    for (const status of ["OPEN", "LOCKED", "PUBLISHED"] as const) {
      const { service, events } = build();
      events.single = buildEvent({ status: AssessmentEventStatus[status] });

      await rejectsWithStatus(
        service.update(TENANT_ID, EVENT_ID, { maxMarks: 40 }, CONTEXT),
        HTTP_STATUS.CONFLICT
      );
      assert.equal(events.writeCount, 0, `${status} must reject an amendment`);
    }
  });

  it("raises 404 for a sitting outside the tenant", async () => {
    const { service, events } = build();
    events.single = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, EVENT_ID, { title: "Renamed" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("validates a newly named faculty member", async () => {
    const { service, events } = build();
    events.single = buildEvent({ status: AssessmentEventStatus.DRAFT });
    events.faculty = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, EVENT_ID, { conductedById: FACULTY_ID }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("records both the before and after snapshots", async () => {
    const { service, events, audit } = build();
    events.single = buildEvent({ status: AssessmentEventStatus.DRAFT });

    await service.update(TENANT_ID, EVENT_ID, { title: "Renamed" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "ASSESSMENT_EVENT_UPDATED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("AssessmentEventService.changeStatus — the workflow", () => {
  async function transition(
    from: AssessmentEventStatus,
    to: AssessmentEventStatus
  ): Promise<{ events: FakeEventRepository; error: unknown }> {
    const { service, events } = build();
    events.single = buildEvent({ status: from });

    let error: unknown = null;
    try {
      await service.changeStatus(TENANT_ID, EVENT_ID, { status: to }, CONTEXT);
    } catch (caught) {
      error = caught;
    }

    return { events, error };
  }

  it("permits every transition the workflow defines", async () => {
    const permitted = [
      ["DRAFT", "OPEN"],
      ["OPEN", "LOCKED"],
      ["LOCKED", "PUBLISHED"],
      ["LOCKED", "OPEN"],
      ["PUBLISHED", "LOCKED"],
    ] as const;

    for (const [from, to] of permitted) {
      const { events, error } = await transition(
        AssessmentEventStatus[from],
        AssessmentEventStatus[to]
      );

      assert.equal(error, null, `${from} -> ${to} must be permitted`);
      assert.equal(events.updates[0].data.status, to);
    }
  });

  it("refuses OPEN straight to PUBLISHED — the verification gate", async () => {
    const { events, error } = await transition(
      AssessmentEventStatus.OPEN,
      AssessmentEventStatus.PUBLISHED
    );

    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, HTTP_STATUS.CONFLICT);
    assert.equal(events.writeCount, 0, "nothing reaches a student without entry being closed");
  });

  it("refuses DRAFT straight to LOCKED or PUBLISHED", async () => {
    for (const to of ["LOCKED", "PUBLISHED"] as const) {
      const { error } = await transition(
        AssessmentEventStatus.DRAFT,
        AssessmentEventStatus[to]
      );
      assert.ok(error instanceof AppError, `DRAFT -> ${to} must be refused`);
    }
  });

  it("refuses a self-transition rather than reporting a silent success", async () => {
    for (const status of ["DRAFT", "OPEN", "LOCKED", "PUBLISHED"] as const) {
      const { error } = await transition(
        AssessmentEventStatus[status],
        AssessmentEventStatus[status]
      );
      assert.ok(error instanceof AppError, `${status} -> ${status} must be refused`);
    }
  });

  it("stamps the moment the status moved", async () => {
    const { events } = await transition(AssessmentEventStatus.DRAFT, AssessmentEventStatus.OPEN);

    assert.ok(events.updates[0].data.statusChangedAt instanceof Date);
  });

  it("raises 404 for a sitting outside the tenant", async () => {
    const { service, events } = build();
    events.single = null;

    await rejectsWithStatus(
      service.changeStatus(TENANT_ID, EVENT_ID, { status: "OPEN" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("audits the transition with its before and after status", async () => {
    const { service, events, audit } = build();
    events.single = buildEvent({ status: AssessmentEventStatus.LOCKED });

    await service.changeStatus(TENANT_ID, EVENT_ID, { status: "PUBLISHED" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "ASSESSMENT_EVENT_STATUS_CHANGED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("AssessmentEventService reads", () => {
  it("derives acceptsMarks from the status — OPEN alone accepts marks", async () => {
    for (const [status, expected] of [
      ["DRAFT", false],
      ["OPEN", true],
      ["LOCKED", false],
      ["PUBLISHED", false],
    ] as const) {
      const { service, events } = build();
      events.single = buildEvent({ status: AssessmentEventStatus[status] });

      const result = await service.getById(TENANT_ID, EVENT_ID);
      assert.equal(result.acceptsMarks, expected, `${status} acceptsMarks should be ${expected}`);
    }
  });

  it("derives isPublished from the status", async () => {
    const { service, events } = build();
    events.single = buildEvent({ status: AssessmentEventStatus.PUBLISHED });

    assert.equal((await service.getById(TENANT_ID, EVENT_ID)).isPublished, true);
  });

  it("serialises decimals as lossless strings and dates as ISO", async () => {
    const { service, events } = build();
    events.single = buildEvent({
      maxMarks: decimal("25.50"),
      scheduledAt: new Date("2026-03-15T09:00:00.000Z"),
    });

    const result = await service.getById(TENANT_ID, EVENT_ID);

    assert.equal(result.maxMarks, "25.50");
    assert.equal(result.scheduledAt, "2026-03-15T09:00:00.000Z");
  });

  it("reports a null scheduledAt rather than an epoch", async () => {
    const { service, events } = build();
    events.single = buildEvent({ scheduledAt: null });

    assert.equal((await service.getById(TENANT_ID, EVENT_ID)).scheduledAt, null);
  });

  it("computes pagination from the total and the page size", async () => {
    const { service, events } = build();
    events.page = [[buildEvent()], 45];

    const result = await service.list(TENANT_ID, { page: 2, limit: 20 });

    assert.deepEqual(result.pagination, { page: 2, limit: 20, total: 45, totalPages: 3 });
  });

  it("raises 404 for a sitting outside the tenant", async () => {
    const { service, events } = build();
    events.single = null;

    await rejectsWithStatus(service.getById(TENANT_ID, EVENT_ID), HTTP_STATUS.NOT_FOUND);
  });

  // --- Department confinement ---------------------------------------------
  //
  // ASSESSMENT_EVENT_READ_ROLES admits DEPARTMENT_HOD, and before this
  // narrowing existed that yes was tenant-wide: a head read every sitting in
  // the university.

  it("serves a sitting whose course belongs to the caller's department", async () => {
    const { service, events } = build();
    events.single = buildEvent();
    events.departmentOwnsCourse = true;

    const result = await service.getById(TENANT_ID, EVENT_ID, DEPARTMENT_ID);

    assert.equal(result.id, EVENT_ID);
  });

  it("raises 404 — not 403 — for a sitting outside the caller's department", async () => {
    // The same answer an unknown id gets, deliberately. A 403 would confirm
    // that a sitting with this id exists somewhere in the university, which is
    // more than a head is entitled to learn from an id they guessed.
    const { service, events } = build();
    events.single = buildEvent();
    events.departmentOwnsCourse = false;

    await rejectsWithStatus(
      service.getById(TENANT_ID, EVENT_ID, DEPARTMENT_ID),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("does not ask about the department for an unnarrowed caller", async () => {
    const { service, events } = build();
    events.single = buildEvent();

    await service.getById(TENANT_ID, EVENT_ID);

    assert.equal(events.departmentChecks, 0);
  });

  it("passes the department restriction down to the list query", async () => {
    // Resolving a scope the query never receives protects nothing.
    const { service, events } = build();

    await service.list(TENANT_ID, { page: 1, limit: 20 }, DEPARTMENT_ID);

    assert.equal(events.listDepartmentId, DEPARTMENT_ID);
  });
});

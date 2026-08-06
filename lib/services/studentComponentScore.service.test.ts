// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score
// LAYER  : Service — Unit Tests
// PURPOSE: Prove every rule governing how a mark comes into existence.
//
//          The cases that carry the most weight are the ones no schema can
//          express and no other layer can see:
//
//            a sitting that is not OPEN rejects every write — which is what
//              locking and publication MEAN here
//            a registration governed by a DIFFERENT regulation is refused —
//              the rule that ties C5.5, C6.1 and C6.2 together
//            a lecturer is confined to sittings they conduct — the rule that
//              makes the internal/external split real rather than cosmetic
//            an unchanged re-upload writes NOTHING — which is what makes
//              correcting a spreadsheet cheap
//
//          No database, no environment: the service takes both dependencies as
//          constructor ports imported with `import type`.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AssessmentEventStatus,
  EvaluationSchemeStatus,
  MarkStatus,
} from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { StudentComponentScoreService } from "@/lib/services/studentComponentScore.service";
import { HTTP_STATUS } from "@/lib/constants/errors";
import { MARK_AUDIT_ACTION } from "@/lib/constants/studentComponentScore";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  CreateStudentComponentScoreData,
  DbClient,
  GoverningSchemeRecord,
  MarkableRegistrationRecord,
  MarkingEventRecord,
  StudentComponentScoreRecord,
  StudentComponentScoreRepositoryPort,
  UpdateStudentComponentScoreData,
} from "@/lib/repositories/studentComponentScore.repository";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const EVENT_ID = "event_1";
const COMPONENT_ID = "component_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "semester_1";
const SECTION_ID = "section_1";
const SCHEME_ID = "scheme_1";
const FACULTY_ID = "faculty_1";
const REG_A = "registration_a";
const REG_B = "registration_b";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

const TX = {} as DbClient;

const ADMIN_AUTHORITY = {
  action: MARK_AUDIT_ACTION.EXTERNAL_UPLOADED,
  restrictToConductedEvents: false,
} as const;

const FACULTY_AUTHORITY = {
  action: MARK_AUDIT_ACTION.INTERNAL_UPLOADED,
  restrictToConductedEvents: true,
} as const;

function decimal(value: string): StudentComponentScoreRecord["marksObtained"] {
  return { toString: () => value } as StudentComponentScoreRecord["marksObtained"];
}

function buildEvent(overrides: Partial<MarkingEventRecord> = {}): MarkingEventRecord {
  return {
    id: EVENT_ID,
    evaluationComponentId: COMPONENT_ID,
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    sectionId: null,
    maxMarks: decimal("30.00") as MarkingEventRecord["maxMarks"],
    status: AssessmentEventStatus.OPEN,
    conductedById: null,
    ...overrides,
  };
}

function buildRegistration(
  id: string,
  overrides: Partial<MarkableRegistrationRecord> = {}
): MarkableRegistrationRecord {
  return {
    id,
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    sectionId: SECTION_ID,
    evaluationSchemeId: SCHEME_ID,
    status: "CONFIRMED",
    ...overrides,
  };
}

function buildMark(
  courseRegistrationId: string,
  overrides: Partial<StudentComponentScoreRecord> = {}
): StudentComponentScoreRecord {
  return {
    id: `score_${courseRegistrationId}`,
    tenantId: TENANT_ID,
    assessmentEventId: EVENT_ID,
    courseRegistrationId,
    marksObtained: decimal("20.00"),
    status: MarkStatus.RECORDED,
    remarks: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  courseRegistrationId: string;
  data: UpdateStudentComponentScoreData;
}

class FakeScoreRepository implements StudentComponentScoreRepositoryPort {
  event: MarkingEventRecord | null = buildEvent();
  governing: GoverningSchemeRecord | null = {
    componentId: COMPONENT_ID,
    schemeId: SCHEME_ID,
    schemeStatus: EvaluationSchemeStatus.ACTIVE,
  };
  registrations: MarkableRegistrationRecord[] = [
    buildRegistration(REG_A),
    buildRegistration(REG_B),
  ];
  existing: StudentComponentScoreRecord[] = [];
  sheet: StudentComponentScoreRecord[] = [];
  faculty: { id: string } | null = { id: FACULTY_ID };

  created: CreateStudentComponentScoreData[] = [];
  updates: UpdateCall[] = [];
  transactionCount = 0;
  registrationQueries = 0;
  existingQueries = 0;

  async findByEvent(): Promise<StudentComponentScoreRecord[]> {
    return this.sheet;
  }

  async findExisting(): Promise<StudentComponentScoreRecord[]> {
    this.existingQueries += 1;
    return this.existing;
  }

  async createMany(data: readonly CreateStudentComponentScoreData[]): Promise<number> {
    this.created = [...data];
    return data.length;
  }

  async updateByNaturalKey(
    _tenantId: string,
    _assessmentEventId: string,
    courseRegistrationId: string,
    data: UpdateStudentComponentScoreData
  ): Promise<number> {
    this.updates.push({ courseRegistrationId, data });
    return 1;
  }

  async findEvent(): Promise<MarkingEventRecord | null> {
    return this.event;
  }

  async findGoverningScheme(): Promise<GoverningSchemeRecord | null> {
    return this.governing;
  }

  /**
   * Return only the registrations the batch actually asked for.
   *
   * A fixed list would make every single-mark upload look like a mismatched
   * batch, and — worse — would hide the real behaviour under test: the service
   * decides "one of these does not exist" by comparing what it asked for with
   * what came back. Rest parameters with tuple labels let the id argument be
   * read without leaving an unused named binding for the tenant.
   */
  async findRegistrations(
    ...args: [tenantId: string, courseRegistrationIds: readonly string[]]
  ): Promise<MarkableRegistrationRecord[]> {
    this.registrationQueries += 1;

    const [, requestedIds] = args;
    const known = new Map(this.registrations.map((entry) => [entry.id, entry]));

    return requestedIds
      .map((id) => known.get(id))
      .filter((entry): entry is MarkableRegistrationRecord => entry !== undefined);
  }

  async findFacultyByUserId(): Promise<{ id: string } | null> {
    return this.faculty;
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return fn(TX);
  }

  get writeCount(): number {
    return this.created.length + this.updates.length;
  }
}

class FakeAuditRepository implements AuditLogRepositoryPort {
  entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function build(): {
  service: StudentComponentScoreService;
  scores: FakeScoreRepository;
  audit: FakeAuditRepository;
} {
  const scores = new FakeScoreRepository();
  const audit = new FakeAuditRepository();

  return { service: new StudentComponentScoreService(scores, audit), scores, audit };
}

function rejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, "expected an AppError");
    assert.equal(err.statusCode, status);
    return true;
  });
}

/** One valid mark for registration A. */
const ONE_MARK = {
  assessmentEventId: EVENT_ID,
  marks: [{ courseRegistrationId: REG_A, marksObtained: 25 }],
};

describe("StudentComponentScoreService.upload — the sitting's state", () => {
  it("records a mark against an OPEN sitting", async () => {
    const { service, scores } = build();

    const result = await service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT);

    assert.equal(result.createdCount, 1);
    assert.equal(scores.created[0].courseRegistrationId, REG_A);
    assert.equal(scores.created[0].marksObtained, 25);
  });

  it("refuses every status but OPEN — locking and publication are this one rule", async () => {
    for (const status of ["DRAFT", "LOCKED", "PUBLISHED"] as const) {
      const { service, scores } = build();
      scores.event = buildEvent({ status: AssessmentEventStatus[status] });

      await rejectsWithStatus(
        service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
        HTTP_STATUS.CONFLICT
      );
      assert.equal(scores.writeCount, 0, `${status} must write nothing`);
    }
  });

  it("raises 404 for a sitting outside the tenant", async () => {
    const { service, scores } = build();
    scores.event = null;

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses a regulation that is no longer ACTIVE", async () => {
    for (const status of ["DRAFT", "ARCHIVED"] as const) {
      const { service, scores } = build();
      scores.governing = {
        componentId: COMPONENT_ID,
        schemeId: SCHEME_ID,
        schemeStatus: EvaluationSchemeStatus[status],
      };

      await rejectsWithStatus(
        service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
        HTTP_STATUS.CONFLICT
      );
      assert.equal(scores.writeCount, 0);
    }
  });

  it("raises 404 when the component behind the sitting is gone", async () => {
    const { service, scores } = build();
    scores.governing = null;

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });
});

describe("StudentComponentScoreService.upload — who may write", () => {
  it("confines a lecturer to sittings they conduct", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ conductedById: "faculty_other" });

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, FACULTY_AUTHORITY, CONTEXT),
      HTTP_STATUS.FORBIDDEN
    );
    assert.equal(scores.writeCount, 0);
  });

  it("permits a lecturer on a sitting they do conduct", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ conductedById: FACULTY_ID });

    const result = await service.upload(TENANT_ID, ONE_MARK, FACULTY_AUTHORITY, CONTEXT);

    assert.equal(result.createdCount, 1);
  });

  it("refuses a lecturer on a sitting with no conductor at all", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ conductedById: null });

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, FACULTY_AUTHORITY, CONTEXT),
      HTTP_STATUS.FORBIDDEN
    );
  });

  it("refuses an account with no faculty profile", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ conductedById: FACULTY_ID });
    scores.faculty = null;

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, FACULTY_AUTHORITY, CONTEXT),
      HTTP_STATUS.FORBIDDEN
    );
  });

  it("does not confine an administrator to any sitting", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ conductedById: "faculty_other" });

    const result = await service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT);

    assert.equal(result.createdCount, 1);
  });
});

describe("StudentComponentScoreService.upload — registration eligibility", () => {
  it("raises 404 when a registration is not in this tenant", async () => {
    const { service, scores } = build();
    scores.registrations = [];

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.equal(scores.writeCount, 0);
  });

  it("refuses a registration for a different course or term", async () => {
    for (const wrong of [{ courseId: "course_other" }, { semesterId: "semester_other" }]) {
      const { service, scores } = build();
      scores.registrations = [buildRegistration(REG_A, wrong)];

      await rejectsWithStatus(
        service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
        HTTP_STATUS.CONFLICT
      );
    }
  });

  it("refuses a registration governed by a DIFFERENT regulation", async () => {
    const { service, scores } = build();
    scores.registrations = [buildRegistration(REG_A, { evaluationSchemeId: "scheme_other" })];

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(
      scores.writeCount,
      0,
      "a mark graded by rules that never applied to the student is worse than no mark"
    );
  });

  it("refuses a registration from another teaching group when the sitting names one", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ sectionId: SECTION_ID });
    scores.registrations = [buildRegistration(REG_A, { sectionId: "section_other" })];

    await rejectsWithStatus(
      service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("accepts any teaching group when the sitting is cohort-wide", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ sectionId: null });
    scores.registrations = [buildRegistration(REG_A, { sectionId: "section_other" })];

    const result = await service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT);

    assert.equal(result.createdCount, 1);
  });

  it("refuses an enrolment that has ended", async () => {
    for (const status of ["WITHDRAWN", "DROPPED", "COMPLETED", "CANCELLED"] as const) {
      const { service, scores } = build();
      scores.registrations = [buildRegistration(REG_A, { status })];

      await rejectsWithStatus(
        service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT),
        HTTP_STATUS.CONFLICT
      );
    }
  });
});

describe("StudentComponentScoreService.upload — the mark itself", () => {
  it("refuses a mark above the total the paper was set out of", async () => {
    const { service, scores } = build();
    scores.event = buildEvent({ maxMarks: decimal("30.00") as MarkingEventRecord["maxMarks"] });

    await rejectsWithStatus(
      service.upload(
        TENANT_ID,
        { assessmentEventId: EVENT_ID, marks: [{ courseRegistrationId: REG_A, marksObtained: 31 }] },
        ADMIN_AUTHORITY,
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("accepts a mark exactly equal to the total", async () => {
    const { service } = build();

    const result = await service.upload(
      TENANT_ID,
      { assessmentEventId: EVENT_ID, marks: [{ courseRegistrationId: REG_A, marksObtained: 30 }] },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.createdCount, 1, "30.00 against 30.00 must compare equal");
  });

  it("records an absent student with no mark", async () => {
    const { service, scores } = build();

    await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [{ courseRegistrationId: REG_A, status: "ABSENT", remarks: "Medical" }],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(scores.created[0].marksObtained, null, "absence is not zero");
    assert.equal(scores.created[0].status, "ABSENT");
    assert.equal(scores.created[0].remarks, "Medical");
  });

  it("refuses an absent student carrying a mark", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.upload(
        TENANT_ID,
        {
          assessmentEventId: EVENT_ID,
          marks: [{ courseRegistrationId: REG_A, status: "ABSENT", marksObtained: 10 }],
        },
        ADMIN_AUTHORITY,
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a present student with no mark", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.upload(
        TENANT_ID,
        { assessmentEventId: EVENT_ID, marks: [{ courseRegistrationId: REG_A }] },
        ADMIN_AUTHORITY,
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("requires a mark for a WITHHELD result, which is a mark being withheld", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.upload(
        TENANT_ID,
        {
          assessmentEventId: EVENT_ID,
          marks: [{ courseRegistrationId: REG_A, status: "WITHHELD" }],
        },
        ADMIN_AUTHORITY,
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });
});

describe("StudentComponentScoreService.upload — amendment and change detection", () => {
  it("amends an existing mark rather than duplicating it", async () => {
    const { service, scores } = build();
    scores.existing = [buildMark(REG_A, { marksObtained: decimal("20.00") })];

    const result = await service.upload(
      TENANT_ID,
      { assessmentEventId: EVENT_ID, marks: [{ courseRegistrationId: REG_A, marksObtained: 25 }] },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.createdCount, 0);
    assert.equal(result.updatedCount, 1);
    assert.equal(scores.updates[0].data.marksObtained, 25);
  });

  it("writes NOTHING when a re-upload changes nothing", async () => {
    const { service, scores } = build();
    scores.existing = [buildMark(REG_A, { marksObtained: decimal("25.00") })];

    const result = await service.upload(
      TENANT_ID,
      { assessmentEventId: EVENT_ID, marks: [{ courseRegistrationId: REG_A, marksObtained: 25 }] },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.unchangedCount, 1);
    assert.equal(scores.writeCount, 0, "re-uploading a corrected spreadsheet must be cheap");
  });

  it("treats a stored 17.50 and a submitted 17.5 as the same mark", async () => {
    const { service, scores } = build();
    scores.existing = [buildMark(REG_A, { marksObtained: decimal("17.50") })];

    const result = await service.upload(
      TENANT_ID,
      { assessmentEventId: EVENT_ID, marks: [{ courseRegistrationId: REG_A, marksObtained: 17.5 }] },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.unchangedCount, 1, "a float comparison here would rewrite every row");
  });

  it("detects a change of status alone", async () => {
    const { service, scores } = build();
    scores.existing = [buildMark(REG_A, { marksObtained: decimal("20.00") })];

    const result = await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [{ courseRegistrationId: REG_A, status: "ABSENT" }],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.updatedCount, 1);
    assert.equal(scores.updates[0].data.marksObtained, null);
  });

  it("detects a change of remarks alone — a revaluation note is a change", async () => {
    const { service, scores } = build();
    scores.existing = [buildMark(REG_A, { marksObtained: decimal("25.00"), remarks: null })];

    const result = await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [{ courseRegistrationId: REG_A, marksObtained: 25, remarks: "Revalued on appeal" }],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.updatedCount, 1);
  });

  it("splits a mixed batch into inserts, updates and no-ops in one pass", async () => {
    const { service, scores } = build();
    scores.existing = [buildMark(REG_A, { marksObtained: decimal("20.00") })];

    const result = await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [
          { courseRegistrationId: REG_A, marksObtained: 22 },
          { courseRegistrationId: REG_B, marksObtained: 18 },
        ],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(result.submittedCount, 2);
    assert.equal(result.createdCount, 1);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.unchangedCount, 0);
  });
});

describe("StudentComponentScoreService.upload — batching, audit and rollback", () => {
  it("reads a constant number of times regardless of batch size", async () => {
    const { service, scores } = build();
    scores.registrations = [buildRegistration(REG_A), buildRegistration(REG_B)];

    await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [
          { courseRegistrationId: REG_A, marksObtained: 20 },
          { courseRegistrationId: REG_B, marksObtained: 21 },
        ],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(scores.registrationQueries, 1, "one registration lookup for the whole batch");
    assert.equal(scores.existingQueries, 1, "one existing-marks lookup for the whole batch");
  });

  it("inserts every new mark in ONE createMany", async () => {
    const { service, scores } = build();

    await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [
          { courseRegistrationId: REG_A, marksObtained: 20 },
          { courseRegistrationId: REG_B, marksObtained: 21 },
        ],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(scores.created.length, 2);
  });

  it("runs inside a transaction", async () => {
    const { service, scores } = build();

    await service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT);

    assert.equal(scores.transactionCount, 1);
  });

  it("writes ONE audit entry for the upload, not one per mark", async () => {
    const { service, scores, audit } = build();
    scores.registrations = [buildRegistration(REG_A), buildRegistration(REG_B)];

    await service.upload(
      TENANT_ID,
      {
        assessmentEventId: EVENT_ID,
        marks: [
          { courseRegistrationId: REG_A, marksObtained: 20 },
          { courseRegistrationId: REG_B, marksObtained: 21 },
        ],
      },
      ADMIN_AUTHORITY,
      CONTEXT
    );

    assert.equal(audit.entries.length, 1);
    const [entry] = audit.entries;
    assert.equal(entry.resource, "StudentComponentScore");
    assert.equal(entry.resourceId, EVENT_ID);
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.ipAddress, CONTEXT.ipAddress);
  });

  it("records which endpoint the upload came through", async () => {
    const { service: internalService, audit: internalAudit } = build();
    await internalService.upload(
      TENANT_ID,
      ONE_MARK,
      { action: MARK_AUDIT_ACTION.INTERNAL_UPLOADED, restrictToConductedEvents: false },
      CONTEXT
    );
    assert.equal(internalAudit.entries[0].action, "STUDENT_MARKS_INTERNAL_UPLOADED");

    const { service: externalService, audit: externalAudit } = build();
    await externalService.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT);
    assert.equal(externalAudit.entries[0].action, "STUDENT_MARKS_EXTERNAL_UPLOADED");
  });

  it("writes no audit entry when the batch is rejected", async () => {
    const { service, audit, scores } = build();
    scores.event = buildEvent({ status: AssessmentEventStatus.LOCKED });

    await assert.rejects(service.upload(TENANT_ID, ONE_MARK, ADMIN_AUTHORITY, CONTEXT));

    assert.equal(audit.entries.length, 0);
  });

  it("rejects the WHOLE batch when a single row is ineligible", async () => {
    const { service, scores } = build();
    scores.registrations = [
      buildRegistration(REG_A),
      buildRegistration(REG_B, { evaluationSchemeId: "scheme_other" }),
    ];

    await rejectsWithStatus(
      service.upload(
        TENANT_ID,
        {
          assessmentEventId: EVENT_ID,
          marks: [
            { courseRegistrationId: REG_A, marksObtained: 20 },
            { courseRegistrationId: REG_B, marksObtained: 21 },
          ],
        },
        ADMIN_AUTHORITY,
        CONTEXT
      ),
      HTTP_STATUS.CONFLICT
    );

    assert.equal(
      scores.writeCount,
      0,
      "a partially applied marks sheet is worse than none — nobody can tell which half landed"
    );
  });
});

describe("StudentComponentScoreService.getMarksSheet", () => {
  it("tallies every status in one pass", async () => {
    const { service, scores } = build();
    scores.sheet = [
      buildMark("r1"),
      buildMark("r2", { status: MarkStatus.ABSENT, marksObtained: null }),
      buildMark("r3", { status: MarkStatus.WITHHELD }),
      buildMark("r4"),
    ];

    const sheet = await service.getMarksSheet(TENANT_ID, EVENT_ID);

    assert.equal(sheet.recordedCount, 2);
    assert.equal(sheet.absentCount, 1);
    assert.equal(sheet.withheldCount, 1);
    assert.equal(sheet.entries.length, 4);
  });

  it("reports whether the sheet is editable, so a client needs no rule of its own", async () => {
    for (const [status, expected] of [
      ["DRAFT", false],
      ["OPEN", true],
      ["LOCKED", false],
      ["PUBLISHED", false],
    ] as const) {
      const { service, scores } = build();
      scores.event = buildEvent({ status: AssessmentEventStatus[status] });

      const sheet = await service.getMarksSheet(TENANT_ID, EVENT_ID);
      assert.equal(sheet.acceptsMarks, expected, `${status} acceptsMarks should be ${expected}`);
    }
  });

  it("preserves a null mark rather than reporting zero", async () => {
    const { service, scores } = build();
    scores.sheet = [buildMark("r1", { status: MarkStatus.ABSENT, marksObtained: null })];

    const sheet = await service.getMarksSheet(TENANT_ID, EVENT_ID);

    assert.equal(sheet.entries[0].marksObtained, null);
  });

  it("serialises marks as lossless strings", async () => {
    const { service, scores } = build();
    scores.sheet = [buildMark("r1", { marksObtained: decimal("17.50") })];

    const sheet = await service.getMarksSheet(TENANT_ID, EVENT_ID);

    assert.equal(sheet.entries[0].marksObtained, "17.50");
  });

  it("raises 404 for a sitting outside the tenant", async () => {
    const { service, scores } = build();
    scores.event = null;

    await rejectsWithStatus(service.getMarksSheet(TENANT_ID, EVENT_ID), HTTP_STATUS.NOT_FOUND);
  });
});

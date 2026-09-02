// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration
// LAYER  : Service — Unit Tests
// PURPOSE: Prove every academic rule this service owns — reference validation,
//          scheme activation, snapshot capture, attempt assignment,
//          attempt/type coherence, the lifecycle state machine, bulk
//          behaviour, audit and transactional atomicity.
//
//          The cases that matter most are the ones the schema cannot express:
//          a first attempt declared as a backlog, a re-sit declared as REGULAR,
//          a second concurrent enrolment, a revived terminal status, and a
//          bulk batch that must SKIP rather than fail. None is reachable from
//          the validation layer, because each depends on stored state or on a
//          server-assigned attempt number.
//
//          No database, no environment: the service takes its three
//          dependencies as constructor ports imported with `import type`.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { CourseRegistrationService } from "@/lib/services/courseRegistration.service";
import { HTTP_STATUS } from "@/lib/constants/errors";
import type { AuditLogEntry, AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  AttemptRecord,
  CourseRegistrationRecord,
  CourseRegistrationRepositoryPort,
  CourseReferenceRecord,
  CreateCourseRegistrationData,
  DbClient,
  RosterEntryRecord,
  StudentReferenceRecord,
  UpdateCourseRegistrationData,
} from "@/lib/repositories/courseRegistration.repository";
import type { EvaluationSchemeLifecyclePort } from "@/lib/repositories/evaluationConfig.ports";
import type { EvaluationSchemeRecord } from "@/lib/repositories/evaluationScheme.repository";
import type { RequestContext } from "@/lib/utils/request-context";

const TENANT_ID = "tenant_1";
const STUDENT_ID = "student_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "semester_1";
const SECTION_ID = "section_1";
const SCHEME_ID = "scheme_1";
const PROGRAMME_ID = "programme_1";
const REGISTRATION_ID = "registration_1";
const DEPARTMENT_ID = "dept_cse";

const CONTEXT: RequestContext = {
  actorId: "user_1",
  ipAddress: "203.0.113.7",
  userAgent: "test-agent",
};

const TX = {} as DbClient;

function decimal(value: string): CourseRegistrationRecord["credits"] {
  return { toString: () => value } as CourseRegistrationRecord["credits"];
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

function buildRegistration(
  overrides: Partial<CourseRegistrationRecord> = {}
): CourseRegistrationRecord {
  return {
    id: REGISTRATION_ID,
    tenantId: TENANT_ID,
    studentId: STUDENT_ID,
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    sectionId: SECTION_ID,
    programmeId: PROGRAMME_ID,
    evaluationSchemeId: SCHEME_ID,
    credits: decimal("4.00"),
    registrationType: "REGULAR",
    attemptNumber: 1,
    status: "REGISTERED",
    statusChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface UpdateCall {
  id: string;
  data: UpdateCourseRegistrationData;
}

class FakeRegistrationRepository implements CourseRegistrationRepositoryPort {
  student: StudentReferenceRecord | null = {
    id: STUDENT_ID,
    programmeId: PROGRAMME_ID,
    sectionId: SECTION_ID,
  };
  students: StudentReferenceRecord[] = [];
  course: CourseReferenceRecord | null = { id: COURSE_ID, credits: 4 };
  semester: { id: string } | null = { id: SEMESTER_ID };
  section: { id: string } | null = { id: SECTION_ID };
  attempts: AttemptRecord[] = [];
  single: CourseRegistrationRecord | null = null;
  page: [CourseRegistrationRecord[], number] = [[], 0];
  roster: RosterEntryRecord[] = [];

  created: CreateCourseRegistrationData | null = null;
  createdBatch: CreateCourseRegistrationData[] = [];
  updates: UpdateCall[] = [];
  transactionCount = 0;
  attemptQueries = 0;
  studentQueries = 0;

  /** Whether the head's department owns the course. Set per test. */
  departmentOwnsCourse = false;
  departmentChecks = 0;

  async courseBelongsToDepartment(): Promise<boolean> {
    this.departmentChecks += 1;
    return this.departmentOwnsCourse;
  }

  // Parameters the fake does not consult are omitted rather than named with a
  // leading underscore: this project's ESLint config carries no
  // argsIgnorePattern. A method with fewer parameters stays assignable to the
  // port's signature.
  listDepartmentId: string | null | undefined = undefined;

  async listWithCount(
    _tenantId?: unknown,
    _filter?: unknown,
    _skip?: unknown,
    _take?: unknown,
    departmentId: string | null = null
  ): Promise<[CourseRegistrationRecord[], number]> {
    this.listDepartmentId = departmentId;
    return this.page;
  }

  async findById(): Promise<CourseRegistrationRecord | null> {
    return this.single;
  }

  async findAttempts(): Promise<AttemptRecord[]> {
    this.attemptQueries += 1;
    return this.attempts;
  }

  async findRoster(): Promise<RosterEntryRecord[]> {
    return this.roster;
  }

  async create(data: CreateCourseRegistrationData): Promise<CourseRegistrationRecord> {
    this.created = data;
    return buildRegistration({
      id: "registration_new",
      studentId: data.studentId,
      programmeId: data.programmeId,
      credits: decimal(data.credits.toFixed(2)),
      registrationType: data.registrationType,
      attemptNumber: data.attemptNumber,
      sectionId: data.sectionId,
    });
  }

  async createMany(data: readonly CreateCourseRegistrationData[]): Promise<number> {
    this.createdBatch = [...data];
    return data.length;
  }

  async update(
    _tenantId: string,
    id: string,
    data: UpdateCourseRegistrationData
  ): Promise<CourseRegistrationRecord> {
    this.updates.push({ id, data });
    return buildRegistration({ ...this.single, id, ...data });
  }

  async findStudent(): Promise<StudentReferenceRecord | null> {
    this.studentQueries += 1;
    return this.student;
  }

  async findStudents(): Promise<StudentReferenceRecord[]> {
    this.studentQueries += 1;
    return this.students;
  }

  async findCourse(): Promise<CourseReferenceRecord | null> {
    return this.course;
  }

  async findSemester(): Promise<{ id: string } | null> {
    return this.semester;
  }

  async findSection(): Promise<{ id: string } | null> {
    return this.section;
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return fn(TX);
  }

  /** Every write recorded — the rollback assertion surface. */
  get writeCount(): number {
    return (
      (this.created === null ? 0 : 1) + this.createdBatch.length + this.updates.length
    );
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
  service: CourseRegistrationService;
  registrations: FakeRegistrationRepository;
  audit: FakeAuditRepository;
  schemes: FakeSchemeLifecycle;
} {
  const registrations = new FakeRegistrationRepository();
  const audit = new FakeAuditRepository();
  const schemes = new FakeSchemeLifecycle();

  return {
    service: new CourseRegistrationService(registrations, audit, schemes),
    registrations,
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

const REGISTER_INPUT = {
  studentId: STUDENT_ID,
  courseId: COURSE_ID,
  semesterId: SEMESTER_ID,
  evaluationSchemeId: SCHEME_ID,
};

describe("CourseRegistrationService.register — references", () => {
  it("registers a student for a course", async () => {
    const { service, registrations } = build();

    const result = await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(registrations.created?.studentId, STUDENT_ID);
    assert.equal(result.attemptNumber, 1);
    assert.equal(result.status, "REGISTERED");
    assert.equal(result.isActive, true);
  });

  it("raises 404 for a student outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.student = null;

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.equal(registrations.writeCount, 0);
  });

  it("raises 404 for a course outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.course = null;

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("raises 404 for a semester outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.semester = null;

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("raises 404 for a section outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.section = null;

    await rejectsWithStatus(
      service.register(TENANT_ID, { ...REGISTER_INPUT, sectionId: SECTION_ID }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("raises 404 for a scheme outside the tenant", async () => {
    const { service, schemes } = build();
    schemes.scheme = null;

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("refuses a DRAFT scheme, whose rules could still change", async () => {
    const { service, schemes, registrations } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.DRAFT);

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(registrations.writeCount, 0);
  });

  it("refuses an ARCHIVED scheme, which is no longer in force", async () => {
    const { service, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.ARCHIVED);

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });
});

describe("CourseRegistrationService.register — snapshots", () => {
  it("snapshots credits from the course, never from the caller", async () => {
    const { service, registrations } = build();
    registrations.course = { id: COURSE_ID, credits: 3 };

    const result = await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(registrations.created?.credits, 3);
    assert.equal(result.credits, "3.00");
  });

  it("snapshots the programme from the student, since a transfer overwrites it", async () => {
    const { service, registrations } = build();
    registrations.student = {
      id: STUDENT_ID,
      programmeId: "programme_original",
      sectionId: null,
    };

    const result = await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(result.programmeId, "programme_original");
  });

  it("pins the evaluation scheme supplied by the caller", async () => {
    const { service } = build();

    const result = await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(result.evaluationSchemeId, SCHEME_ID);
  });
});

describe("CourseRegistrationService.register — attempts", () => {
  it("assigns attempt 1 when the student has never taken the course", async () => {
    const { service } = build();

    const result = await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(result.attemptNumber, 1);
  });

  it("assigns the next attempt after a completed one", async () => {
    const { service, registrations } = build();
    registrations.attempts = [
      { id: "r1", studentId: STUDENT_ID, attemptNumber: 1, status: "COMPLETED" },
    ];

    const result = await service.register(
      TENANT_ID,
      { ...REGISTER_INPUT, registrationType: "BACKLOG" },
      CONTEXT
    );

    assert.equal(result.attemptNumber, 2);
  });

  it("numbers attempts across semesters, not within one", async () => {
    const { service, registrations } = build();
    registrations.attempts = [
      { id: "r1", studentId: STUDENT_ID, attemptNumber: 1, status: "COMPLETED" },
      { id: "r2", studentId: STUDENT_ID, attemptNumber: 2, status: "COMPLETED" },
    ];

    const result = await service.register(
      TENANT_ID,
      { ...REGISTER_INPUT, registrationType: "IMPROVEMENT" },
      CONTEXT
    );

    assert.equal(result.attemptNumber, 3, "a backlog cleared later is the third attempt");
  });

  it("refuses a second concurrent enrolment for the same course", async () => {
    const { service, registrations } = build();
    registrations.attempts = [
      { id: "r1", studentId: STUDENT_ID, attemptNumber: 1, status: "CONFIRMED" },
    ];

    await rejectsWithStatus(
      service.register(TENANT_ID, REGISTER_INPUT, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
    assert.equal(registrations.writeCount, 0);
  });

  it("permits a re-sit once the previous attempt is terminal", async () => {
    const { service, registrations } = build();
    registrations.attempts = [
      { id: "r1", studentId: STUDENT_ID, attemptNumber: 1, status: "WITHDRAWN" },
    ];

    const result = await service.register(
      TENANT_ID,
      { ...REGISTER_INPUT, registrationType: "REPEAT" },
      CONTEXT
    );

    assert.equal(result.attemptNumber, 2);
  });
});

describe("CourseRegistrationService.register — attempt/type coherence", () => {
  it("refuses a first attempt declared as a backlog", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.register(TENANT_ID, { ...REGISTER_INPUT, registrationType: "BACKLOG" }, CONTEXT),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a first attempt declared as an improvement", async () => {
    const { service } = build();

    await rejectsWithStatus(
      service.register(
        TENANT_ID,
        { ...REGISTER_INPUT, registrationType: "IMPROVEMENT" },
        CONTEXT
      ),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("refuses a re-sit declared as REGULAR", async () => {
    const { service, registrations } = build();
    registrations.attempts = [
      { id: "r1", studentId: STUDENT_ID, attemptNumber: 1, status: "COMPLETED" },
    ];

    await rejectsWithStatus(
      service.register(TENANT_ID, { ...REGISTER_INPUT, registrationType: "REGULAR" }, CONTEXT),
      HTTP_STATUS.BAD_REQUEST
    );
  });

  it("accepts every first-attempt type", async () => {
    for (const registrationType of ["REGULAR", "ELECTIVE", "OPEN_ELECTIVE", "AUDIT", "CREDIT_TRANSFER"] as const) {
      const { service } = build();

      const result = await service.register(
        TENANT_ID,
        { ...REGISTER_INPUT, registrationType },
        CONTEXT
      );

      assert.equal(result.registrationType, registrationType);
    }
  });

  it("derives countsForCredit from the type rather than a stored flag", async () => {
    const { service } = build();

    const audited = await service.register(
      TENANT_ID,
      { ...REGISTER_INPUT, registrationType: "AUDIT" },
      CONTEXT
    );
    assert.equal(audited.countsForCredit, false);

    const regular = await build().service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);
    assert.equal(regular.countsForCredit, true);
  });
});

describe("CourseRegistrationService.register — audit and transaction", () => {
  it("runs inside a transaction", async () => {
    const { service, registrations } = build();

    await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(registrations.transactionCount, 1);
  });

  it("writes a REGISTERED entry carrying the actor and origin", async () => {
    const { service, audit } = build();

    await service.register(TENANT_ID, REGISTER_INPUT, CONTEXT);

    assert.equal(audit.entries.length, 1);
    const [entry] = audit.entries;
    assert.equal(entry.action, "COURSE_REGISTRATION_REGISTERED");
    assert.equal(entry.resource, "CourseRegistration");
    assert.equal(entry.tenantId, TENANT_ID);
    assert.equal(entry.userId, CONTEXT.actorId);
    assert.equal(entry.ipAddress, CONTEXT.ipAddress);
    assert.equal(entry.before, undefined);
  });

  it("writes no audit entry when the registration is rejected", async () => {
    const { service, audit, schemes } = build();
    schemes.scheme = buildScheme(EvaluationSchemeStatus.DRAFT);

    await assert.rejects(service.register(TENANT_ID, REGISTER_INPUT, CONTEXT));

    assert.equal(audit.entries.length, 0);
  });
});

describe("CourseRegistrationService.registerBulk", () => {
  const BULK_INPUT = {
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    evaluationSchemeId: SCHEME_ID,
    studentIds: ["s1", "s2", "s3"],
  };

  /**
   * The students the repository would return for a batch.
   *
   * The fake returns this list verbatim rather than filtering by the requested
   * ids, so a test must configure exactly the students it asks for — which is
   * also how the "one is missing" case is expressed: configure fewer than the
   * batch names.
   */
  function studentsWithIds(ids: readonly string[]): StudentReferenceRecord[] {
    return ids.map((id) => ({ id, programmeId: PROGRAMME_ID, sectionId: null }));
  }

  function withStudents(count: number): StudentReferenceRecord[] {
    return studentsWithIds(Array.from({ length: count }, (_value, index) => `s${index + 1}`));
  }

  it("registers a whole cohort in one insert", async () => {
    const { service, registrations } = build();
    registrations.students = withStudents(3);

    const result = await service.registerBulk(TENANT_ID, BULK_INPUT, CONTEXT);

    assert.equal(result.requestedCount, 3);
    assert.equal(result.registeredCount, 3);
    assert.deepEqual(result.skipped, []);
    assert.equal(registrations.createdBatch.length, 3);
  });

  it("resolves references ONCE for the batch, not once per student", async () => {
    const { service, registrations } = build();
    registrations.students = withStudents(3);

    await service.registerBulk(TENANT_ID, BULK_INPUT, CONTEXT);

    assert.equal(registrations.studentQueries, 1, "one findStudents for the whole batch");
    assert.equal(registrations.attemptQueries, 1, "one findAttempts for the whole batch");
  });

  it("skips a student who already holds an active enrolment, without failing the batch", async () => {
    const { service, registrations } = build();
    registrations.students = withStudents(3);
    registrations.attempts = [
      { id: "r1", studentId: "s2", attemptNumber: 1, status: "CONFIRMED" },
    ];

    const result = await service.registerBulk(TENANT_ID, BULK_INPUT, CONTEXT);

    assert.equal(result.registeredCount, 2);
    assert.deepEqual(result.skipped, [{ studentId: "s2", reason: "ALREADY_REGISTERED" }]);
    assert.equal(registrations.createdBatch.length, 2);
  });

  it("is idempotent — a re-run registers nothing and reports every skip", async () => {
    const { service, registrations } = build();
    registrations.students = withStudents(3);
    registrations.attempts = [
      { id: "r1", studentId: "s1", attemptNumber: 1, status: "CONFIRMED" },
      { id: "r2", studentId: "s2", attemptNumber: 1, status: "CONFIRMED" },
      { id: "r3", studentId: "s3", attemptNumber: 1, status: "CONFIRMED" },
    ];

    const result = await service.registerBulk(TENANT_ID, BULK_INPUT, CONTEXT);

    assert.equal(result.registeredCount, 0);
    assert.equal(result.skipped.length, 3);
    assert.equal(registrations.createdBatch.length, 0, "no empty insert is issued");
  });

  it("raises 404 for the whole batch when a student is not in the tenant", async () => {
    const { service, registrations } = build();
    registrations.students = withStudents(2);

    await rejectsWithStatus(
      service.registerBulk(TENANT_ID, BULK_INPUT, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
    assert.equal(registrations.writeCount, 0);
  });

  it("assigns each student their own next attempt number", async () => {
    const { service, registrations } = build();
    registrations.students = studentsWithIds(["s2", "s3"]);
    registrations.attempts = [
      { id: "r1", studentId: "s2", attemptNumber: 1, status: "COMPLETED" },
      { id: "r2", studentId: "s3", attemptNumber: 1, status: "COMPLETED" },
      { id: "r3", studentId: "s3", attemptNumber: 2, status: "COMPLETED" },
    ];

    await service.registerBulk(
      TENANT_ID,
      { ...BULK_INPUT, studentIds: ["s2", "s3"], registrationType: "BACKLOG" },
      CONTEXT
    );

    const byStudent = new Map(
      registrations.createdBatch.map((row) => [row.studentId, row.attemptNumber])
    );
    assert.equal(byStudent.get("s2"), 2);
    assert.equal(byStudent.get("s3"), 3);
  });

  it("writes ONE audit entry for the batch, not one per student", async () => {
    const { service, registrations, audit } = build();
    registrations.students = withStudents(3);

    await service.registerBulk(TENANT_ID, BULK_INPUT, CONTEXT);

    assert.equal(audit.entries.length, 1);
    assert.equal(audit.entries[0].action, "COURSE_REGISTRATION_BULK_REGISTERED");
  });
});

describe("CourseRegistrationService.update", () => {
  it("raises 404 for a registration outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.single = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, REGISTRATION_ID, { status: "CONFIRMED" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("permits REGISTERED to CONFIRMED", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration({ status: "REGISTERED" });

    await service.update(TENANT_ID, REGISTRATION_ID, { status: "CONFIRMED" }, CONTEXT);

    assert.equal(registrations.updates[0].data.status, "CONFIRMED");
  });

  it("permits CONFIRMED to WITHDRAWN and stamps the moment", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration({ status: "CONFIRMED" });

    await service.update(TENANT_ID, REGISTRATION_ID, { status: "WITHDRAWN" }, CONTEXT);

    assert.ok(registrations.updates[0].data.statusChangedAt instanceof Date);
  });

  it("refuses to revive a terminal status", async () => {
    for (const status of ["WITHDRAWN", "DROPPED", "COMPLETED", "CANCELLED"] as const) {
      const { service, registrations } = build();
      registrations.single = buildRegistration({ status });

      await rejectsWithStatus(
        service.update(TENANT_ID, REGISTRATION_ID, { status: "REGISTERED" }, CONTEXT),
        HTTP_STATUS.CONFLICT
      );
    }
  });

  it("refuses REGISTERED straight to COMPLETED, skipping confirmation", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration({ status: "REGISTERED" });

    await rejectsWithStatus(
      service.update(TENANT_ID, REGISTRATION_ID, { status: "COMPLETED" }, CONTEXT),
      HTTP_STATUS.CONFLICT
    );
  });

  it("does not stamp statusChangedAt when only the section moves", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration({ status: "CONFIRMED" });

    await service.update(TENANT_ID, REGISTRATION_ID, { sectionId: "section_2" }, CONTEXT);

    assert.equal(
      registrations.updates[0].data.statusChangedAt,
      undefined,
      "reallocating a section must not falsify when the student withdrew"
    );
  });

  it("raises 404 for a section outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration();
    registrations.section = null;

    await rejectsWithStatus(
      service.update(TENANT_ID, REGISTRATION_ID, { sectionId: "section_2" }, CONTEXT),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("records both the before and after snapshots", async () => {
    const { service, registrations, audit } = build();
    registrations.single = buildRegistration({ status: "REGISTERED" });

    await service.update(TENANT_ID, REGISTRATION_ID, { status: "CONFIRMED" }, CONTEXT);

    const [entry] = audit.entries;
    assert.equal(entry.action, "COURSE_REGISTRATION_UPDATED");
    assert.notEqual(entry.before, undefined);
    assert.notEqual(entry.after, undefined);
  });
});

describe("CourseRegistrationService reads", () => {
  it("computes pagination from the total and the page size", async () => {
    const { service, registrations } = build();
    registrations.page = [[buildRegistration()], 45];

    const result = await service.list(TENANT_ID, { page: 2, limit: 20 });

    assert.equal(result.registrations.length, 1);
    assert.deepEqual(result.pagination, { page: 2, limit: 20, total: 45, totalPages: 3 });
  });

  it("serialises credits as a lossless string and dates as ISO", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration({ credits: decimal("1.50") });

    const result = await service.getById(TENANT_ID, REGISTRATION_ID);

    assert.equal(result.credits, "1.50");
    assert.equal(result.createdAt, "2026-01-01T00:00:00.000Z");
  });

  it("derives isActive from the status", async () => {
    for (const [status, expected] of [
      ["REGISTERED", true],
      ["CONFIRMED", true],
      ["WITHDRAWN", false],
      ["DROPPED", false],
      ["COMPLETED", false],
      ["CANCELLED", false],
    ] as const) {
      const { service, registrations } = build();
      registrations.single = buildRegistration({ status });

      const result = await service.getById(TENANT_ID, REGISTRATION_ID);
      assert.equal(result.isActive, expected, `${status} should be isActive=${expected}`);
    }
  });

  it("raises 404 for a registration outside the tenant", async () => {
    const { service, registrations } = build();
    registrations.single = null;

    await rejectsWithStatus(
      service.getById(TENANT_ID, REGISTRATION_ID),
      HTTP_STATUS.NOT_FOUND
    );
  });

  // --- Department confinement ---------------------------------------------
  //
  // REGISTRATION_READ_ROLES admits DEPARTMENT_HOD. Unnarrowed, a head read
  // every enrolment in the university.

  it("serves an enrolment against a course in the caller's department", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration();
    registrations.departmentOwnsCourse = true;

    const result = await service.getById(TENANT_ID, REGISTRATION_ID, DEPARTMENT_ID);

    assert.equal(result.id, REGISTRATION_ID);
  });

  it("raises 404 — not 403 — for an enrolment outside the caller's department", async () => {
    // The shape of the error must not confirm that an enrolment with this id
    // exists elsewhere in the tenant.
    const { service, registrations } = build();
    registrations.single = buildRegistration();
    registrations.departmentOwnsCourse = false;

    await rejectsWithStatus(
      service.getById(TENANT_ID, REGISTRATION_ID, DEPARTMENT_ID),
      HTTP_STATUS.NOT_FOUND
    );
  });

  it("does not ask about the department for an unnarrowed caller", async () => {
    const { service, registrations } = build();
    registrations.single = buildRegistration();

    await service.getById(TENANT_ID, REGISTRATION_ID);

    assert.equal(registrations.departmentChecks, 0);
  });

  it("passes the department restriction down to the list query", async () => {
    const { service, registrations } = build();

    await service.list(TENANT_ID, { page: 1, limit: 20 }, DEPARTMENT_ID);

    assert.equal(registrations.listDepartmentId, DEPARTMENT_ID);
  });

  it("returns the roster as registration ids, not student ids", async () => {
    const { service, registrations } = build();
    registrations.roster = [
      { id: "reg_1", studentId: "s1", attemptNumber: 1, evaluationSchemeId: SCHEME_ID },
    ];

    const roster = await service.getRoster(TENANT_ID, COURSE_ID, SEMESTER_ID);

    assert.equal(roster[0].id, "reg_1", "a mark must cite the enrolment, not the student");
    assert.equal(roster[0].attemptNumber, 1);
    assert.equal(roster[0].evaluationSchemeId, SCHEME_ID);
  });
});

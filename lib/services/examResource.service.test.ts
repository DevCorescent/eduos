// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the three properties that keep an unpublished answer key out
//          of a student's hands:
//
//            1. A faculty member cannot write a colleague's resource, and the
//               refusal is a 404 rather than a 403.
//            2. A student is confined to their registered courses, and an
//               invisible resource is a 404 — never a 403.
//            3. Every transition that changes student visibility is audited
//               inside the same transaction as the change.
//
//          The service depends on a repository TYPE and one port, so all of
//          this runs with no database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { ExamResourceStatus, ExamResourceType } from "@/app/generated/prisma/enums";
import { EXAM_RESOURCE_ACTION } from "@/lib/constants/examResource";
import {
  ExamResourceService,
  type ExamResourceAccess,
} from "@/lib/services/examResource.service";
import type { ExamResourceRepositoryPort } from "@/lib/repositories/examResource.repository";
import type { AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const OTHER_USER_ID = "user_2";
const RESOURCE_ID = "res_1";
const NOW = new Date("2026-05-10T09:00:00.000Z");

const DEPARTMENT_ID = "dept_cse";
const OTHER_DEPARTMENT_ID = "dept_mech";

const ADMIN: ExamResourceAccess = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  scope: "ANY",
  departmentId: null,
  ipAddress: null,
  userAgent: null,
};

const FACULTY: ExamResourceAccess = { ...ADMIN, scope: "OWN" };

/** A head of department, narrowed to DEPARTMENT_ID by the guard. */
const HEAD: ExamResourceAccess = {
  ...ADMIN,
  scope: "DEPARTMENT",
  departmentId: DEPARTMENT_ID,
};

function resourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESOURCE_ID,
    tenantId: TENANT_ID,
    courseId: "course_1",
    semesterId: "semester_1",
    departmentId: "dept_1",
    examinationId: null,
    type: ExamResourceType.QUESTION_PAPER,
    title: "Mid-semester paper",
    description: null,
    academicYear: "2025-26",
    fileName: "midsem.pdf",
    fileUrl: "https://files.example.edu/midsem.pdf",
    fileSize: 1024,
    mimeType: "application/pdf",
    status: ExamResourceStatus.DRAFT,
    scheduledPublishAt: null,
    publishedAt: null,
    archivedAt: null,
    isVerified: false,
    verifiedAt: null,
    uploadedById: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    course: { code: "CS301", name: "Algorithms" },
    semester: { name: "Sem 5" },
    department: { code: "CSE", name: "Computer Science" },
    uploadedBy: {
      id: USER_ID,
      firstName: "Priya",
      lastName: "Nair",
      displayName: null,
      email: "priya@example.edu",
    },
    ...overrides,
  };
}

interface HarnessOptions {
  resource?: ReturnType<typeof resourceRow> | null;
  course?: { id: string; departmentId: string | null } | null;
  semesterExists?: boolean;
  student?: { id: string } | null;
  registeredCourseIds?: string[];
  studentResource?: Record<string, unknown> | null;
  deleteCount?: number;
}

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    creates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
    audits: [] as Array<{ action: string; before: unknown; after: unknown }>,
    transactions: 0,
    studentPageArgs: [] as Array<readonly string[]>,
    deletes: 0,
  };

  let insideTransaction = false;

  const repository = {
    async findById() {
      return options.resource === undefined ? resourceRow() : options.resource;
    },
    async findStaffPage() {
      return { rows: [resourceRow()], total: 1 };
    },
    async findStudentPage(_tenantId: string, courseIds: readonly string[]) {
      calls.studentPageArgs.push(courseIds);
      return { rows: [], total: 0 };
    },
    async findStudentResource() {
      return options.studentResource === undefined
        ? {
            id: RESOURCE_ID,
            courseId: "course_1",
            semesterId: "semester_1",
            examinationId: null,
            type: ExamResourceType.QUESTION_PAPER,
            title: "Mid-semester paper",
            description: null,
            academicYear: "2025-26",
            fileName: "midsem.pdf",
            fileUrl: "https://files.example.edu/midsem.pdf",
            fileSize: 1024,
            mimeType: "application/pdf",
            status: ExamResourceStatus.PUBLISHED,
            scheduledPublishAt: null,
            publishedAt: NOW,
            isVerified: true,
            course: { code: "CS301", name: "Algorithms" },
            semester: { name: "Sem 5" },
          }
        : options.studentResource;
    },
    async findRegisteredCourseIds() {
      return options.registeredCourseIds ?? ["course_1", "course_2"];
    },
    async create(data: Record<string, unknown>) {
      calls.creates.push(data);
      return resourceRow(data);
    },
    async update(_tenantId: string, _id: string, data: Record<string, unknown>) {
      calls.updates.push(data);
      return resourceRow({ ...data, scheduledPublishAt: data.scheduledPublishAt ?? null });
    },
    async delete() {
      calls.deletes += 1;
      return options.deleteCount ?? 1;
    },
    async findCourse() {
      return options.course === undefined ? { id: "course_1", departmentId: "dept_1" } : options.course;
    },
    async semesterExists() {
      return options.semesterExists ?? true;
    },
    async findStudentByUserId() {
      return options.student === undefined ? { id: "student_1" } : options.student;
    },
    async transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      calls.transactions += 1;
      insideTransaction = true;
      try {
        return await fn(undefined as never);
      } finally {
        insideTransaction = false;
      }
    },
  } as unknown as ExamResourceRepositoryPort;

  const auditLog: AuditLogRepositoryPort = {
    async record(entry) {
      assert.equal(insideTransaction, true, "audit written outside the transaction");
      calls.audits.push({ action: entry.action, before: entry.before, after: entry.after });
    },
  };

  return { service: new ExamResourceService(repository, auditLog), calls };
}

// --- create -----------------------------------------------------------------

describe("ExamResourceService.create", () => {
  const input = {
    courseId: "course_1",
    semesterId: "semester_1",
    type: ExamResourceType.QUESTION_PAPER,
    title: "Mid-semester paper",
    fileName: "midsem.pdf",
    fileUrl: "https://files.example.edu/midsem.pdf",
  };

  it("creates a resource as DRAFT, never published", async () => {
    // "Publish Immediately" is the publish endpoint, so the visibility
    // transition stays on one audited path.
    const { service, calls } = makeHarness();

    await service.create(ADMIN, input, NOW);

    assert.equal(calls.creates[0].status, ExamResourceStatus.DRAFT);
  });

  it("DENORMALISES the department from the course, not from the client", async () => {
    const { service, calls } = makeHarness();

    await service.create(ADMIN, input, NOW);

    assert.equal(calls.creates[0].departmentId, "dept_1");
  });

  it("lets a head upload against a course in their OWN department", async () => {
    const { service, calls } = makeHarness({
      course: { id: "course_1", departmentId: DEPARTMENT_ID },
    });

    await service.create(HEAD, input, NOW);

    assert.equal(calls.creates.length, 1);
    assert.equal(calls.creates[0].departmentId, DEPARTMENT_ID);
  });

  it("REFUSES a head submitting ANOTHER department's courseId", async () => {
    // The manipulated-id case. The check is against the course as RESOLVED
    // from the database, and the departmentId written to the row comes from
    // that same record, so the two can never disagree.
    const { service, calls } = makeHarness({
      course: { id: "course_1", departmentId: OTHER_DEPARTMENT_ID },
    });

    await assert.rejects(
      () => service.create(HEAD, input, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404, "must not disclose that the course exists");
        return true;
      }
    );

    assert.equal(calls.creates.length, 0);
  });

  it("REFUSES a head uploading against a course with NO department", async () => {
    const { service, calls } = makeHarness({
      course: { id: "course_1", departmentId: null },
    });

    await assert.rejects(
      () => service.create(HEAD, input, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    assert.equal(calls.creates.length, 0);
  });

  it("attributes the upload to the authenticated caller", async () => {
    const { service, calls } = makeHarness();

    await service.create(ADMIN, input, NOW);

    assert.equal(calls.creates[0].uploadedById, USER_ID);
  });

  it("404s on an unknown course", async () => {
    const { service } = makeHarness({ course: null });

    await assert.rejects(
      () => service.create(ADMIN, input, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /Course/);
        return true;
      }
    );
  });

  it("404s on an unknown semester, naming which reference was wrong", async () => {
    const { service } = makeHarness({ semesterExists: false });

    await assert.rejects(
      () => service.create(ADMIN, input, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.match(err.message, /Semester/);
        return true;
      }
    );
  });
});

// --- write authority --------------------------------------------------------

describe("ExamResourceService write authority", () => {
  it("lets a faculty member edit their OWN upload", async () => {
    const { service, calls } = makeHarness({ resource: resourceRow({ uploadedById: USER_ID }) });

    await service.update(FACULTY, RESOURCE_ID, { title: "Revised" }, NOW);

    assert.equal(calls.updates[0].title, "Revised");
  });

  it("REFUSES a faculty member editing a colleague's upload, with a 404", async () => {
    // A 403 would confirm the resource exists and is merely withheld.
    const { service, calls } = makeHarness({
      resource: resourceRow({ uploadedById: OTHER_USER_ID }),
    });

    await assert.rejects(
      () => service.update(FACULTY, RESOURCE_ID, { title: "Revised" }, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    assert.equal(calls.updates.length, 0);
  });

  it("lets an administrative caller edit anyone's upload", async () => {
    const { service, calls } = makeHarness({
      resource: resourceRow({ uploadedById: OTHER_USER_ID }),
    });

    await service.update(ADMIN, RESOURCE_ID, { title: "Revised" }, NOW);

    assert.equal(calls.updates.length, 1);
  });

  // --- Head of department ---------------------------------------------------
  //
  // EXAM_RESOURCE_ADMIN_ROLES admits both spellings of head of department
  // alongside UNIVERSITY_ADMIN, and the guard handed all three "ANY" — which
  // this service defines as publishing, archiving and deleting ANYTHING in the
  // tenant. A head could publish another department's answer key.

  it("lets a head edit a resource in their OWN department", async () => {
    const { service, calls } = makeHarness({
      resource: resourceRow({
        uploadedById: OTHER_USER_ID,
        departmentId: DEPARTMENT_ID,
      }),
    });

    await service.update(HEAD, RESOURCE_ID, { title: "Revised" }, NOW);

    assert.equal(calls.updates.length, 1);
  });

  it("REFUSES a head editing ANOTHER department's resource, with a 404", async () => {
    const { service, calls } = makeHarness({
      resource: resourceRow({
        uploadedById: OTHER_USER_ID,
        departmentId: OTHER_DEPARTMENT_ID,
      }),
    });

    await assert.rejects(
      () => service.update(HEAD, RESOURCE_ID, { title: "Revised" }, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    assert.equal(calls.updates.length, 0);
  });

  it("REFUSES a head writing a resource with NO department", async () => {
    // The column is nullable and denormalised from the course at creation, so
    // an absent value means unowned — and unowned must not read as anyone's.
    const { service, calls } = makeHarness({
      resource: resourceRow({ uploadedById: USER_ID, departmentId: null }),
    });

    await assert.rejects(
      () => service.update(HEAD, RESOURCE_ID, { title: "Revised" }, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    assert.equal(calls.updates.length, 0);
  });

  it("REFUSES a head whose own department id is null", async () => {
    // Belt and braces behind the guard's fail-closed refusal: even if a
    // DEPARTMENT authority ever arrived without an id, it must not match a row
    // whose departmentId is also null.
    const { service } = makeHarness({
      resource: resourceRow({ uploadedById: USER_ID, departmentId: null }),
    });

    await assert.rejects(
      () =>
        service.update(
          { ...HEAD, departmentId: null },
          RESOURCE_ID,
          { title: "Revised" },
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("confines a head's PUBLISH, ARCHIVE and DELETE the same way", async () => {
    // All four write paths go through requireWritable. A narrowing applied to
    // update and forgotten in publish would still let a head make another
    // department's answer key visible to students.
    for (const run of [
      (svc: ExamResourceService) => svc.publish(HEAD, RESOURCE_ID, {}, NOW),
      (svc: ExamResourceService) => svc.archive(HEAD, RESOURCE_ID, {}, NOW),
      (svc: ExamResourceService) => svc.remove(HEAD, RESOURCE_ID),
    ]) {
      const { service } = makeHarness({
        resource: resourceRow({
          uploadedById: USER_ID,
          departmentId: OTHER_DEPARTMENT_ID,
          status: ExamResourceStatus.DRAFT,
        }),
      });

      await assert.rejects(
        () => run(service),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          return true;
        }
      );
    }
  });

  it("REFUSES editing an ARCHIVED resource", async () => {
    // It is the historical record students relied on; rewriting it silently
    // would leave no trace that the document changed.
    const { service } = makeHarness({
      resource: resourceRow({ status: ExamResourceStatus.ARCHIVED }),
    });

    await assert.rejects(
      () => service.update(ADMIN, RESOURCE_ID, { title: "Revised" }, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });
});

// --- publish / archive ------------------------------------------------------

describe("ExamResourceService.publish", () => {
  it("publishes a draft and audits it inside the transaction", async () => {
    const { service, calls } = makeHarness();

    await service.publish(ADMIN, RESOURCE_ID, {}, NOW);

    assert.equal(calls.transactions, 1);
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0].action, EXAM_RESOURCE_ACTION.PUBLISH);
    assert.equal(calls.updates[0].status, ExamResourceStatus.PUBLISHED);
  });

  it("REFUSES an already-published resource, preserving the original release date", async () => {
    const { service } = makeHarness({
      resource: resourceRow({ status: ExamResourceStatus.PUBLISHED }),
    });

    await assert.rejects(
      () => service.publish(ADMIN, RESOURCE_ID, {}, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it("CLEARS archivedAt, so publishing restores withdrawn material", async () => {
    const { service, calls } = makeHarness({
      resource: resourceRow({ status: ExamResourceStatus.ARCHIVED, archivedAt: NOW }),
    });

    await service.publish(ADMIN, RESOURCE_ID, {}, NOW);

    assert.equal(calls.updates[0].archivedAt, null);
  });

  it("records the verifier when isVerified is set", async () => {
    const { service, calls } = makeHarness();

    await service.publish(ADMIN, RESOURCE_ID, { isVerified: true }, NOW);

    assert.equal(calls.updates[0].isVerified, true);
    assert.equal(calls.updates[0].verifiedById, USER_ID);
  });

  it("publishes WITHOUT verifying when isVerified is omitted", async () => {
    // Verification is a separate HOD capability and does not gate visibility.
    const { service, calls } = makeHarness();

    await service.publish(ADMIN, RESOURCE_ID, {}, NOW);

    assert.equal("isVerified" in calls.updates[0], false);
  });
});

describe("ExamResourceService.archive", () => {
  it("archives a published resource and audits it in the transaction", async () => {
    const { service, calls } = makeHarness({
      resource: resourceRow({ status: ExamResourceStatus.PUBLISHED }),
    });

    await service.archive(ADMIN, RESOURCE_ID, {}, NOW);

    assert.equal(calls.transactions, 1);
    assert.equal(calls.audits[0].action, EXAM_RESOURCE_ACTION.ARCHIVE);
    assert.equal(calls.updates[0].status, ExamResourceStatus.ARCHIVED);
  });

  it("REFUSES an already-archived resource", async () => {
    const { service } = makeHarness({
      resource: resourceRow({ status: ExamResourceStatus.ARCHIVED }),
    });

    await assert.rejects(() => service.archive(ADMIN, RESOURCE_ID, {}, NOW));
  });
});

describe("ExamResourceService.remove", () => {
  it("audits the deletion with the details that will not survive it", async () => {
    const { service, calls } = makeHarness();

    await service.remove(ADMIN, RESOURCE_ID);

    assert.equal(calls.deletes, 1);
    assert.equal(calls.audits[0].action, EXAM_RESOURCE_ACTION.DELETE);

    const before = calls.audits[0].before as Record<string, unknown>;
    assert.equal(before.title, "Mid-semester paper");
    assert.equal(before.fileUrl, "https://files.example.edu/midsem.pdf");
  });

  it("404s when the row vanished between the lookup and the delete", async () => {
    const { service } = makeHarness({ deleteCount: 0 });

    await assert.rejects(
      () => service.remove(ADMIN, RESOURCE_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});

// --- student surface --------------------------------------------------------

describe("ExamResourceService student surface", () => {
  it("CONFINES the listing to the student's registered courses", async () => {
    const { service, calls } = makeHarness({ registeredCourseIds: ["course_1", "course_9"] });

    await service.listForStudent(TENANT_ID, USER_ID, { page: 1, limit: 20 }, NOW);

    assert.deepEqual(calls.studentPageArgs[0], ["course_1", "course_9"]);
  });

  it("passes an EMPTY course set for a student registered for nothing", async () => {
    const { service, calls } = makeHarness({ registeredCourseIds: [] });

    const result = await service.listForStudent(TENANT_ID, USER_ID, { page: 1, limit: 20 }, NOW);

    assert.deepEqual(calls.studentPageArgs[0], []);
    assert.equal(result.resources.length, 0);
  });

  it("FORBIDS a caller holding STUDENT who owns no Student row", async () => {
    const { service } = makeHarness({ student: null });

    await assert.rejects(
      () => service.listForStudent(TENANT_ID, USER_ID, { page: 1, limit: 20 }, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it("404s — never 403 — for a resource the student may not see", async () => {
    // A 403 would confirm an unpublished answer key exists to ask about.
    const { service } = makeHarness({ studentResource: null });

    await assert.rejects(
      () => service.getForStudent(TENANT_ID, USER_ID, RESOURCE_ID, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("OMITS fileUrl from the view response", async () => {
    // The location is served only by the download endpoint, so a list cannot be
    // scraped for every paper's URL.
    const { service } = makeHarness();

    const resource = await service.getForStudent(TENANT_ID, USER_ID, RESOURCE_ID, NOW);

    assert.equal("fileUrl" in resource, false);
  });

  it("INCLUDES fileUrl in the download response", async () => {
    const { service } = makeHarness();

    const download = await service.downloadForStudent(TENANT_ID, USER_ID, RESOURCE_ID, NOW);

    assert.equal(download.fileUrl, "https://files.example.edu/midsem.pdf");
  });

  it("re-checks entitlement on download rather than trusting an earlier list", async () => {
    const { service } = makeHarness({ studentResource: null });

    await assert.rejects(() =>
      service.downloadForStudent(TENANT_ID, USER_ID, RESOURCE_ID, NOW)
    );
  });
});

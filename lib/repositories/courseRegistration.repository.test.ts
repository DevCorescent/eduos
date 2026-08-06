// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify the structural properties of every query this repository
//          issues. Same rationale as the C4 and C5 suites — a repository holds
//          no logic, so what matters is what it ASKS OF THE DATABASE — with one
//          addition specific to this module:
//
//            the reference lookups must be tenant-scoped too.
//
//          A registration created against another tenant's student would be a
//          cross-tenant academic record, and the ONLY thing preventing it is
//          that findStudent resolves the student with a tenant predicate. That
//          is asserted here rather than assumed.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CourseRegistrationRepository,
  type DbClient,
} from "@/lib/repositories/courseRegistration.repository";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const STUDENT_ID = "student_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "semester_1";
const SECTION_ID = "section_1";
const REGISTRATION_ID = "registration_1";

const repository = new CourseRegistrationRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

describe("CourseRegistrationRepository — tenant isolation", () => {
  it("scopes a single read by tenant", async () => {
    const { client, db } = fake();

    await repository.findById(TENANT_ID, REGISTRATION_ID, db);

    const where = whereOf(client.onlyCallTo("courseRegistration", "findFirst").args);
    assert.equal(where.id, REGISTRATION_ID);
    assert.equal(where.tenantId, TENANT_ID);
  });

  it("carries the tenant into the write itself on update", async () => {
    const { client, db } = fake();

    await repository.update(TENANT_ID, REGISTRATION_ID, { status: "CONFIRMED" }, db);

    assert.deepEqual(
      whereOf(client.onlyCallTo("courseRegistration", "update").args).tenantId_id,
      { tenantId: TENANT_ID, id: REGISTRATION_ID },
      "the compound selector is what stops a preceding read being the only tenant proof"
    );
  });

  it("scopes EVERY reference lookup by tenant", async () => {
    const { client, db } = fake();

    await repository.findStudent(TENANT_ID, STUDENT_ID, db);
    await repository.findStudents(TENANT_ID, ["a", "b"], db);
    await repository.findCourse(TENANT_ID, COURSE_ID, db);
    await repository.findSemester(TENANT_ID, SEMESTER_ID, db);
    await repository.findSection(TENANT_ID, SECTION_ID, db);

    for (const model of ["student", "course", "semester", "section"]) {
      for (const call of client.calls.filter((entry) => entry.model === model)) {
        assert.equal(
          whereOf(call.args).tenantId,
          TENANT_ID,
          `${model}.${call.operation} resolved a reference without a tenant predicate`
        );
      }
    }
  });

  it("never issues a query without a tenant predicate", async () => {
    const { client, db } = fake();

    await repository.findById(TENANT_ID, REGISTRATION_ID, db);
    await repository.findAttempts(TENANT_ID, COURSE_ID, [STUDENT_ID], db);
    await repository.findRoster(TENANT_ID, COURSE_ID, SEMESTER_ID, ["CONFIRMED"], undefined, db);
    await repository.update(TENANT_ID, REGISTRATION_ID, { status: "CONFIRMED" }, db);

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

describe("CourseRegistrationRepository — batch reads avoid N+1", () => {
  it("resolves a whole batch of students in ONE query", async () => {
    const { client, db } = fake();

    await repository.findStudents(TENANT_ID, ["a", "b", "c"], db);

    const where = whereOf(client.onlyCallTo("student", "findMany").args);
    assert.deepEqual(where.id, { in: ["a", "b", "c"] });
  });

  it("resolves every prior attempt across a batch in ONE query", async () => {
    const { client, db } = fake();

    await repository.findAttempts(TENANT_ID, COURSE_ID, ["a", "b", "c"], db);

    const where = whereOf(client.onlyCallTo("courseRegistration", "findMany").args);
    assert.equal(where.courseId, COURSE_ID);
    assert.deepEqual(where.studentId, { in: ["a", "b", "c"] });
  });

  it("issues no query at all for an empty batch", async () => {
    const { client, db } = fake();

    assert.deepEqual(await repository.findStudents(TENANT_ID, [], db), []);
    assert.deepEqual(await repository.findAttempts(TENANT_ID, COURSE_ID, [], db), []);

    assert.equal(client.callCount, 0, "an `in: []` round trip is a certain empty result");
  });

  it("inserts a whole cohort in ONE statement", async () => {
    const { client, db } = fake();

    await repository.createMany(
      [1, 2, 3].map((index) => ({
        tenantId: TENANT_ID,
        studentId: `s${index}`,
        courseId: COURSE_ID,
        semesterId: SEMESTER_ID,
        sectionId: null,
        programmeId: null,
        evaluationSchemeId: "scheme_1",
        credits: 4,
        registrationType: "REGULAR" as const,
        attemptNumber: 1,
      })),
      db
    );

    const call = client.onlyCallTo("courseRegistration", "createMany");
    assert.equal((call.args.data as unknown[]).length, 3);
    assert.equal(client.callCount, 1, "a cohort must not fan out into one insert per student");
  });

  it("does not set skipDuplicates, so a real race surfaces as a conflict", async () => {
    const { client, db } = fake();

    await repository.createMany(
      [
        {
          tenantId: TENANT_ID,
          studentId: "s1",
          courseId: COURSE_ID,
          semesterId: SEMESTER_ID,
          sectionId: null,
          programmeId: null,
          evaluationSchemeId: "scheme_1",
          credits: 4,
          registrationType: "REGULAR" as const,
          attemptNumber: 1,
        },
      ],
      db
    );

    const call = client.onlyCallTo("courseRegistration", "createMany");
    assert.equal(
      call.args.skipDuplicates,
      undefined,
      "collisions are resolved in memory; a surviving one is a concurrent writer, not an overlap"
    );
  });
});

describe("CourseRegistrationRepository — roster", () => {
  it("returns only the requested statuses", async () => {
    const { client, db } = fake();

    await repository.findRoster(
      TENANT_ID,
      COURSE_ID,
      SEMESTER_ID,
      ["REGISTERED", "CONFIRMED"],
      undefined,
      db
    );

    const where = whereOf(client.onlyCallTo("courseRegistration", "findMany").args);
    assert.deepEqual(where.status, { in: ["REGISTERED", "CONFIRMED"] });
    assert.equal(where.courseId, COURSE_ID);
    assert.equal(where.semesterId, SEMESTER_ID);
  });

  it("omits the section predicate entirely when no section is named", async () => {
    const { client, db } = fake();

    await repository.findRoster(TENANT_ID, COURSE_ID, SEMESTER_ID, ["CONFIRMED"], undefined, db);

    const where = whereOf(client.onlyCallTo("courseRegistration", "findMany").args);
    assert.equal(
      "sectionId" in where,
      false,
      "an undefined filter must not become a sectionId: undefined predicate"
    );
  });

  it("narrows to a section when one is named", async () => {
    const { client, db } = fake();

    await repository.findRoster(TENANT_ID, COURSE_ID, SEMESTER_ID, ["CONFIRMED"], SECTION_ID, db);

    assert.equal(
      whereOf(client.onlyCallTo("courseRegistration", "findMany").args).sectionId,
      SECTION_ID
    );
  });

  it("selects the registration id, because a mark cites the enrolment", async () => {
    const { client, db } = fake();

    await repository.findRoster(TENANT_ID, COURSE_ID, SEMESTER_ID, ["CONFIRMED"], undefined, db);

    const select = client.onlyCallTo("courseRegistration", "findMany").args.select as Record<
      string,
      boolean
    >;
    assert.equal(select.id, true);
    assert.equal(select.attemptNumber, true);
    assert.equal(select.evaluationSchemeId, true);
  });
});

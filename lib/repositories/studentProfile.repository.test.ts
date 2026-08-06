// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify what every query ASKS OF THE DATABASE.
//
//          A repository holds no logic, so the meaningful questions are
//          structural — and in a SELF-SERVICE module each is a security
//          property:
//
//            • is the student resolved from userId, never from a client id?
//            • is every query scoped by tenant, or by an id that was itself
//              resolved tenant-scoped?
//            • are the orderings total, so a list cannot reshuffle?
//            • do the dashboard counts avoid reading the rows they count?
//            • does a whole profile stay inside its query budget?
//
//          Every method takes an injectable client, so all of it is verifiable
//          with no database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AchievementCategory, DocumentType } from "@/app/generated/prisma/enums";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";
import {
  ACHIEVEMENT_ORDER_BY,
  ACHIEVEMENT_SELECT,
  CERTIFICATE_ORDER_BY,
  CERTIFICATE_SELECT,
  DOCUMENT_ORDER_BY,
  PARENT_ORDER_BY,
  STUDENT_PROFILE_SELECT,
  StudentProfileRepository,
  type DbClient,
} from "@/lib/repositories/studentProfile.repository";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const NOW = new Date("2026-08-07T00:00:00.000Z");

const repository = new StudentProfileRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

// --- Self-service resolution ------------------------------------------------

describe("StudentProfileRepository — the caller is resolved, never supplied", () => {
  it("resolves a student from userId AND tenantId", async () => {
    const { client, db } = fake();

    await repository.findStudentByUserId(TENANT_ID, USER_ID, db);

    const where = whereOf(client.onlyCallTo("student", "findFirst").args);

    assert.equal(where.userId, USER_ID);
    assert.equal(where.tenantId, TENANT_ID);
  });

  it("returns null when the user is no student in this tenant", async () => {
    // A permitted role with no Student row. The service turns this into
    // FORBIDDEN rather than an empty profile.
    const { db } = fake();

    assert.equal(await repository.findStudentByUserId(TENANT_ID, "ghost", db), null);
  });

  it("scopes resolution by tenant, so a session in the wrong tenant resolves to nothing", async () => {
    const { client, db } = fake();

    await repository.findStudentByUserId(OTHER_TENANT, USER_ID, db);

    assert.equal(whereOf(client.onlyCallTo("student", "findFirst").args).tenantId, OTHER_TENANT);
  });

  it("projects only the id — resolution needs nothing else", async () => {
    const { client, db } = fake();

    await repository.findStudentByUserId(TENANT_ID, USER_ID, db);

    assert.deepEqual(client.onlyCallTo("student", "findFirst").args.select, { id: true });
  });
});

// --- Tenant isolation -------------------------------------------------------

describe("StudentProfileRepository — tenant isolation", () => {
  it("re-asserts the tenant on the profile read even though the id was resolved", async () => {
    // Belt and braces: the cost is one predicate on an indexed column, and it
    // prevents a resolved id being reused across a tenant boundary later.
    const { client, db } = fake();

    await repository.findProfile(TENANT_ID, STUDENT_ID, db);

    const where = whereOf(client.onlyCallTo("student", "findFirst").args);

    assert.equal(where.id, STUDENT_ID);
    assert.equal(where.tenantId, TENANT_ID);
  });

  it("scopes certificates by tenant AND student", async () => {
    // Certificate carries its own tenantId, and nothing constrains a
    // certificate to join a student of the same tenant.
    const { client, db } = fake();

    await repository.findCertificates(TENANT_ID, STUDENT_ID, db);

    const where = whereOf(client.onlyCallTo("certificate", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes achievements by tenant AND student", async () => {
    // Achievement has no composite tenant-proving foreign key — see the model's
    // own documentation — so this predicate IS the enforcement.
    const { client, db } = fake();

    await repository.findAchievements(TENANT_ID, STUDENT_ID, undefined, db);

    const where = whereOf(client.onlyCallTo("achievement", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes notifications by tenant AND user", async () => {
    const { client, db } = fake();

    await repository.findRecentNotifications(TENANT_ID, USER_ID, 5, db);

    const where = whereOf(client.onlyCallTo("notification", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.userId, USER_ID);
  });

  it("reaches student-owned records through the RESOLVED id", async () => {
    // StudentPersonal, StudentDocument and StudentParent carry no tenant column.
    // Ownership travels through a studentId that was itself produced by a
    // tenant-scoped read, so a row cannot be reached without proving the tenant.
    const { client, db } = fake();

    await repository.findParents(STUDENT_ID, db);
    await repository.findDocuments(STUDENT_ID, undefined, db);

    assert.equal(whereOf(client.onlyCallTo("studentParent", "findMany").args).studentId, STUDENT_ID);
    assert.equal(
      whereOf(client.onlyCallTo("studentDocument", "findMany").args).studentId,
      STUDENT_ID
    );
  });

  it("never issues a query without a student or user predicate", async () => {
    const { client, db } = fake();

    await repository.findProfile(TENANT_ID, STUDENT_ID, db);
    await repository.findParents(STUDENT_ID, db);
    await repository.findDocuments(STUDENT_ID, undefined, db);
    await repository.findCertificates(TENANT_ID, STUDENT_ID, db);
    await repository.findAchievements(TENANT_ID, STUDENT_ID, undefined, db);
    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);
    await repository.findRecentNotifications(TENANT_ID, USER_ID, 5, db);

    assert.ok(client.calls.length > 0);

    for (const call of client.calls) {
      const where = whereOf(call.args);
      const anchored =
        where.studentId === STUDENT_ID || where.userId === USER_ID || where.id === STUDENT_ID;

      assert.ok(anchored, `${call.model}.${call.operation} is not anchored to the caller`);
    }
  });
});

// --- The query budget -------------------------------------------------------

describe("StudentProfileRepository — the query budget", () => {
  it("reads the whole identity, personal and academic record in ONE statement", async () => {
    // User, personal, batch, section and specialisation are nested rather than
    // read separately: five reads for data always wanted together would be five
    // round trips for one page.
    const { client, db } = fake();

    await repository.findProfile(TENANT_ID, STUDENT_ID, db);

    assert.equal(client.callCount, 1);

    const select = client.onlyCallTo("student", "findFirst").args.select as Record<string, unknown>;

    for (const relation of ["user", "personal", "batch", "section", "specialisation"]) {
      assert.ok(relation in select, `${relation} is not nested`);
    }
  });

  it("costs ONE statement per collection, never one per row", async () => {
    const { client, db } = fake();

    client.resultFor(
      "achievement",
      "findMany",
      Array.from({ length: 50 }, (_value, index) => ({ id: `a${index}` }))
    );

    await repository.findAchievements(TENANT_ID, STUDENT_ID, undefined, db);

    assert.equal(client.callCount, 1, "fifty achievements still cost one read");
  });

  it("assembles a whole profile in SIX statements", async () => {
    const { client, db } = fake();

    await repository.findProfile(TENANT_ID, STUDENT_ID, db);
    await repository.findParents(STUDENT_ID, db);
    await repository.findDocuments(STUDENT_ID, undefined, db);
    await repository.findCertificates(TENANT_ID, STUDENT_ID, db);
    await repository.findAchievements(TENANT_ID, STUDENT_ID, undefined, db);

    assert.equal(client.callCount, 5, "five collections; counts are the sixth");
  });

  it("COUNTS without reading the rows it counts", async () => {
    // A dashboard needs four numbers, not four collections.
    const { client, db } = fake();

    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    assert.equal(client.callsTo("studentDocument", "findMany").length, 0);
    assert.equal(client.callsTo("certificate", "findMany").length, 0);
    assert.equal(client.callsTo("studentDocument", "count").length, 2);
    assert.equal(client.callsTo("certificate", "count").length, 2);
  });

  it("issues a FIXED four counts that do not grow with the data", async () => {
    const { client, db } = fake();

    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    assert.equal(client.callCount, 4);
  });
});

// --- Ordering ---------------------------------------------------------------

describe("StudentProfileRepository — orderings are total", () => {
  it("orders achievements by when they were ACHIEVED, not entered", async () => {
    // A student entering a 2023 prize in 2026 expects it filed under 2023.
    assert.deepEqual([...ACHIEVEMENT_ORDER_BY], [{ achievedOn: "desc" }, { id: "desc" }]);
  });

  it("appends id to every ordering, so a list cannot reshuffle between requests", () => {
    for (const ordering of [ACHIEVEMENT_ORDER_BY, DOCUMENT_ORDER_BY, CERTIFICATE_ORDER_BY]) {
      const last = ordering[ordering.length - 1] as Record<string, string>;

      assert.ok("id" in last, `${JSON.stringify(ordering)} has no unique tiebreaker`);
    }
  });

  it("puts the PRIMARY parent first", async () => {
    // The one a portal shows when it has room for only one.
    assert.deepEqual([...PARENT_ORDER_BY], [{ isPrimary: "desc" }, { parentId: "asc" }]);
  });

  it("applies the achievement ordering to the query", async () => {
    const { client, db } = fake();

    await repository.findAchievements(TENANT_ID, STUDENT_ID, undefined, db);

    assert.deepEqual(client.onlyCallTo("achievement", "findMany").args.orderBy, [
      ...ACHIEVEMENT_ORDER_BY,
    ]);
  });

  it("orders notifications newest sent first", async () => {
    const { client, db } = fake();

    await repository.findRecentNotifications(TENANT_ID, USER_ID, 5, db);

    const orderBy = client.onlyCallTo("notification", "findMany").args.orderBy as Record<
      string,
      string
    >[];

    assert.equal(orderBy[0].sentAt, "desc");
    assert.equal(orderBy[1].id, "desc");
  });
});

// --- Filters ----------------------------------------------------------------

describe("StudentProfileRepository — filters", () => {
  it("omits a filter entirely when it was not supplied", async () => {
    const { client, db } = fake();

    await repository.findAchievements(TENANT_ID, STUDENT_ID, undefined, db);

    assert.equal("category" in whereOf(client.onlyCallTo("achievement", "findMany").args), false);
  });

  it("narrows achievements by category", async () => {
    const { client, db } = fake();

    await repository.findAchievements(TENANT_ID, STUDENT_ID, AchievementCategory.SPORTS, db);

    assert.equal(
      whereOf(client.onlyCallTo("achievement", "findMany").args).category,
      AchievementCategory.SPORTS
    );
  });

  it("finds the photograph fallback by filtering documents to PHOTO", async () => {
    // The Phase 18 fallback is a StudentDocument of type PHOTO — a filter,
    // not a second method.
    const { client, db } = fake();

    await repository.findDocuments(STUDENT_ID, DocumentType.PHOTO, db);

    const where = whereOf(client.onlyCallTo("studentDocument", "findMany").args);

    assert.equal(where.type, DocumentType.PHOTO);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("bounds notifications by take rather than paginating", async () => {
    const { client, db } = fake();

    await repository.findRecentNotifications(TENANT_ID, USER_ID, 5, db);

    const args = client.onlyCallTo("notification", "findMany").args;

    assert.equal(args.take, 5);
    assert.equal(args.skip, undefined);
  });

  it("excludes notifications the system has not sent", async () => {
    // A queued message is not something a student should learn about from a
    // dashboard.
    const { client, db } = fake();

    await repository.findRecentNotifications(TENANT_ID, USER_ID, 5, db);

    assert.deepEqual(whereOf(client.onlyCallTo("notification", "findMany").args).sentAt, {
      not: null,
    });
  });
});

// --- Counts -----------------------------------------------------------------

describe("StudentProfileRepository — dashboard counts", () => {
  it("counts UNVERIFIED documents as pending", async () => {
    const { client, db } = fake();

    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    const pending = client
      .callsTo("studentDocument", "count")
      .map((call) => whereOf(call.args))
      .find((where) => where.isVerified === false);

    assert.ok(pending, "no unverified-document count was issued");
    assert.equal(pending?.studentId, STUDENT_ID);
  });

  it("counts a certificate as ACTIVE when it is neither revoked nor expired", async () => {
    const { client, db } = fake();

    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    const active = client
      .callsTo("certificate", "count")
      .map((call) => whereOf(call.args))
      .find((where) => where.isRevoked === false);

    assert.ok(active);
    assert.deepEqual(active?.OR, [{ expiresAt: null }, { expiresAt: { gt: NOW } }]);
  });

  it("treats a certificate with NO expiry as never expiring", async () => {
    const { client, db } = fake();

    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    const active = client
      .callsTo("certificate", "count")
      .map((call) => whereOf(call.args))
      .find((where) => where.isRevoked === false);

    const or = active?.OR as Record<string, unknown>[];

    assert.deepEqual(or[0], { expiresAt: null });
  });

  it("evaluates every count against ONE instant", async () => {
    // `now` is a parameter, not a clock read per query, so two certificates
    // expiring in the same millisecond cannot disagree.
    const { client, db } = fake();

    await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    const active = client
      .callsTo("certificate", "count")
      .map((call) => whereOf(call.args))
      .find((where) => where.isRevoked === false);

    const or = active?.OR as Record<string, Record<string, Date>>[];

    assert.equal(or[1].expiresAt.gt, NOW);
  });

  it("returns zeroes for a student holding nothing", async () => {
    const { db } = fake();

    const counts = await repository.findProfileCounts(TENANT_ID, STUDENT_ID, NOW, db);

    assert.deepEqual(counts, {
      documentCount: 0,
      pendingDocuments: 0,
      certificateCount: 0,
      activeCertificates: 0,
    });
  });
});

// --- Projections ------------------------------------------------------------

describe("StudentProfileRepository — projections withhold what they must", () => {
  it("NEVER projects a credential from the user relation", async () => {
    const user = STUDENT_PROFILE_SELECT.user.select as Record<string, unknown>;

    assert.equal("passwordHash" in user, false);
    assert.equal("sessions" in user, false);
  });

  it("carries avatarUrl, the primary photograph source", () => {
    assert.equal(STUDENT_PROFILE_SELECT.user.select.avatarUrl, true);
  });

  it("does NOT project the certificate's unbounded data blob", () => {
    // Nobody can enumerate its contents, and projecting one is how unintended
    // fields reach a browser.
    assert.equal("data" in CERTIFICATE_SELECT, false);
  });

  it("DOES project isRevoked — a student must know a certificate no longer stands", () => {
    assert.equal(CERTIFICATE_SELECT.isRevoked, true);
  });

  it("carries the emergency contact a profile renders", () => {
    assert.equal(STUDENT_PROFILE_SELECT.personal.select.emergencyContact, true);
  });

  it("projects every achievement column — the model holds nothing private", () => {
    for (const column of [
      "title",
      "category",
      "description",
      "issuer",
      "achievedOn",
      "certificateUrl",
      "evidenceUrl",
    ]) {
      assert.equal(
        (ACHIEVEMENT_SELECT as Record<string, boolean>)[column],
        true,
        `${column} is not projected`
      );
    }
  });

  it("does not project tenantId or studentId back to the client on an achievement", () => {
    // The caller already knows both; echoing them is surface with no purpose.
    assert.equal("tenantId" in ACHIEVEMENT_SELECT, false);
    assert.equal("studentId" in ACHIEVEMENT_SELECT, false);
  });
});

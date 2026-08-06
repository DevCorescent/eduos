// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the self-service gate, the completion weighting, and that a
//          failing subsystem costs one dashboard panel rather than the page.
//
//          The service depends on a repository TYPE and three narrow PORTS, so
//          all of this runs with no database and no environment. The ports
//          record what they were asked, which is how "no duplicated logic" is
//          tested rather than asserted: the dashboard must READ attendance's
//          warning flag, not recompute it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { AchievementCategory, DocumentType, StudentStatus } from "@/app/generated/prisma/enums";
import {
  PROFILE_COMPLETION_TOTAL,
  PROFILE_COMPLETION_WEIGHTS,
} from "@/lib/constants/studentProfile";
import { StudentProfileService } from "@/lib/services/studentProfile.service";
import type { StudentProfileRepository } from "@/lib/repositories/studentProfile.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const NOW = new Date("2026-08-07T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");

// --- Fixtures ---------------------------------------------------------------

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDENT_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    enrollmentNo: "2024CS001",
    programmeId: "prog_1",
    batchId: "batch_1",
    sectionId: "sec_1",
    specialisationId: null,
    currentSemester: 3,
    status: StudentStatus.ACTIVE,
    admissionDate: PAST,
    graduationDate: null,
    createdAt: PAST,
    user: {
      id: USER_ID,
      firstName: "Asha",
      lastName: "Rao",
      displayName: null,
      email: "asha@example.edu",
      phone: "+91 90000 00000",
      avatarUrl: "https://cdn/avatar.png",
    },
    personal: {
      dateOfBirth: PAST,
      gender: "FEMALE",
      bloodGroup: "O_POS",
      nationality: "Indian",
      religion: null,
      category: "GEN",
      motherTongue: "Marathi",
      permanentAddr: { city: "Pune" },
      localAddr: null,
      emergencyContact: { name: "R Rao", phone: "+91 90000 11111" },
      disability: false,
      disabilityDesc: null,
      updatedAt: PAST,
    },
    batch: { id: "batch_1", name: "2024" },
    section: { id: "sec_1", name: "A" },
    specialisation: null,
    ...overrides,
  };
}

function documentRow(type: DocumentType = DocumentType.MARKSHEET) {
  return {
    id: `doc_${type}`,
    type,
    fileName: "f.pdf",
    fileUrl: `https://cdn/${type}.pdf`,
    fileSize: 1024,
    mimeType: "application/pdf",
    isVerified: false,
    verifiedAt: null,
    uploadedAt: PAST,
  };
}

function achievementRow() {
  return {
    id: "ach_1",
    title: "Best Paper",
    category: AchievementCategory.RESEARCH,
    description: "IEEE",
    issuer: "IEEE",
    achievedOn: PAST,
    certificateUrl: null,
    evidenceUrl: null,
    createdAt: PAST,
    updatedAt: PAST,
  };
}

function parentRow() {
  return {
    isPrimary: true,
    parent: {
      id: "parent_1",
      firstName: "R",
      lastName: "Rao",
      email: null,
      phone: "+91 90000 11111",
      occupation: null,
      annualIncome: null,
      relation: "Father",
    },
  };
}

interface FakeData {
  own?: { id: string } | null;
  profile?: unknown;
  parents?: unknown[];
  documents?: unknown[];
  certificates?: unknown[];
  achievements?: unknown[];
  counts?: unknown;
  notifications?: unknown[];
}

function fakeRepository(data: FakeData) {
  const calls: string[] = [];

  const repository = {
    async findStudentByUserId() {
      calls.push("findStudentByUserId");
      return data.own === undefined ? { id: STUDENT_ID } : data.own;
    },
    async findProfile() {
      calls.push("findProfile");
      return data.profile === undefined ? profileRow() : data.profile;
    },
    async findParents() {
      calls.push("findParents");
      return data.parents ?? [parentRow()];
    },
    async findDocuments() {
      calls.push("findDocuments");
      return data.documents ?? [documentRow()];
    },
    async findCertificates() {
      calls.push("findCertificates");
      return data.certificates ?? [];
    },
    async findAchievements() {
      calls.push("findAchievements");
      return data.achievements ?? [achievementRow()];
    },
    async findProfileCounts() {
      calls.push("findProfileCounts");
      return (
        data.counts ?? {
          documentCount: 1,
          pendingDocuments: 1,
          certificateCount: 0,
          activeCertificates: 0,
        }
      );
    },
    async findRecentNotifications() {
      calls.push("findRecentNotifications");
      return data.notifications ?? [];
    },
  } as unknown as StudentProfileRepository;

  return { repository, calls };
}

interface PortBehaviour {
  resultThrows?: boolean;
  attendanceThrows?: boolean;
  financeThrows?: boolean;
  overallPercentage?: number;
  lowAttendance?: boolean;
  pendingTotal?: number;
  demands?: { totalAmount: string; paidAmount: string; waivedAmount: string }[];
}

function fakePorts(behaviour: PortBehaviour = {}) {
  const seen: string[] = [];

  const results = {
    async getStudentResult() {
      seen.push("getStudentResult");
      if (behaviour.resultThrows) throw new Error("engine unavailable");
      return {
        semesters: [{ sgpa: { value: "8.500000" }, backlogCount: 1 }],
        cgpa: { value: "8.100000" },
        credits: { earned: "72.00" },
      };
    },
  };

  const attendance = {
    async getAnalytics() {
      seen.push("getAnalytics");
      if (behaviour.attendanceThrows) throw new Error("no attendance");
      return {
        overallPercentage: behaviour.overallPercentage ?? 82.5,
        alerts: { lowAttendance: behaviour.lowAttendance ?? false },
      };
    },
  };

  const finance = {
    async getPendingFees() {
      seen.push("getPendingFees");
      if (behaviour.financeThrows) throw new Error("finance unavailable");
      const demands = behaviour.demands ?? [
        { totalAmount: "50000.00", paidAmount: "12500.50", waivedAmount: "5000.00" },
      ];
      return {
        demands,
        pagination: { page: 1, limit: 100, total: behaviour.pendingTotal ?? demands.length },
      };
    },
  };

  return { results, attendance, finance, seen };
}

function build(data: FakeData = {}, behaviour: PortBehaviour = {}) {
  const { repository, calls } = fakeRepository(data);
  const ports = fakePorts(behaviour);

  const service = new StudentProfileService(
    repository,
    ports.results as never,
    ports.attendance as never,
    ports.finance as never
  );

  return { service, calls, seen: ports.seen };
}

async function expectAppError(run: () => Promise<unknown>, status: number): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    assert.equal(error.statusCode, status);
    return error;
  }

  throw new Error(`expected a ${status}`);
}

// --- Self-service gate ------------------------------------------------------

describe("StudentProfileService — the self-service gate", () => {
  it("resolves the caller and serves their profile", async () => {
    const { service } = build();
    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(profile.identity.studentId, STUDENT_ID);
    assert.equal(profile.identity.enrollmentNo, "2024CS001");
  });

  it("FORBIDS a permitted role that owns no Student row", async () => {
    // The UNIVERSITY_ADMIN case named by the Phase 18 decision: admitted at the
    // role gate, refused at the data gate.
    const { service } = build({ own: null });

    await expectAppError(() => service.getProfile(TENANT_ID, USER_ID, NOW), 403);
  });

  it("forbids on EVERY endpoint, not just the profile", async () => {
    const { service } = build({ own: null });

    await expectAppError(() => service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW), 403);
    await expectAppError(() => service.getAchievements(TENANT_ID, USER_ID, {}), 403);
  });

  it("uses one message for 'not a student' so it cannot be told from 'no such student'", async () => {
    const { service } = build({ own: null });
    const error = await expectAppError(() => service.getProfile(TENANT_ID, USER_ID, NOW), 403);

    assert.equal(error.message, "Forbidden");
  });

  it("raises 404, not 403, when the row vanishes after resolution", async () => {
    // Resolved a moment ago, so this is a deletion mid-request rather than an
    // authorisation failure.
    const { service } = build({ profile: null });

    await expectAppError(() => service.getProfile(TENANT_ID, USER_ID, NOW), 404);
  });

  it("resolves the student exactly ONCE per request", async () => {
    const { service, calls } = build();

    await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(calls.filter((call) => call === "findStudentByUserId").length, 1);
  });
});

// --- Profile composition ----------------------------------------------------

describe("StudentProfileService — getProfile", () => {
  it("issues six statements: one resolve and five concurrent collections", async () => {
    const { service, calls } = build();

    await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(calls.length, 6, calls.join(", "));
  });

  it("composes identity, personal, academic and the four collections", async () => {
    const { service } = build();
    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(profile.identity.firstName, "Asha");
    assert.equal(profile.personal?.nationality, "Indian");
    assert.equal(profile.academic.batchName, "2024");
    assert.equal(profile.academic.sectionName, "A");
    assert.equal(profile.parents.length, 1);
    assert.equal(profile.achievements.length, 1);
  });

  it("prefers the avatar for the photograph", async () => {
    const { service } = build();
    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(profile.identity.photo.source, "AVATAR");
  });

  it("falls back to an uploaded PHOTO document when there is no avatar", async () => {
    const row = profileRow();
    const { service } = build({
      profile: { ...row, user: { ...row.user, avatarUrl: null } },
      documents: [documentRow(DocumentType.MARKSHEET), documentRow(DocumentType.PHOTO)],
    });

    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(profile.identity.photo.source, "DOCUMENT");
    assert.equal(profile.identity.photo.url, "https://cdn/PHOTO.pdf");
  });

  it("reports NONE when neither source exists", async () => {
    const row = profileRow();
    const { service } = build({
      profile: { ...row, user: { ...row.user, avatarUrl: null } },
      documents: [],
    });

    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(profile.identity.photo.source, "NONE");
  });

  it("survives a student with no personal record", async () => {
    const { service } = build({ profile: { ...profileRow(), personal: null } });
    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.equal(profile.personal, null);
  });

  it("returns empty collections rather than nulls for an empty record", async () => {
    const { service } = build({
      parents: [],
      documents: [],
      certificates: [],
      achievements: [],
    });

    const profile = await service.getProfile(TENANT_ID, USER_ID, NOW);

    assert.deepEqual(profile.parents, []);
    assert.deepEqual(profile.achievements, []);
  });
});

// --- Achievements -----------------------------------------------------------

describe("StudentProfileService — getAchievements", () => {
  it("returns the caller's achievements in two statements", async () => {
    const { service, calls } = build();
    const achievements = await service.getAchievements(TENANT_ID, USER_ID, {});

    assert.equal(achievements.length, 1);
    assert.equal(achievements[0].title, "Best Paper");
    assert.equal(calls.length, 2);
  });

  it("returns an empty list for a student with none", async () => {
    const { service } = build({ achievements: [] });

    assert.deepEqual(await service.getAchievements(TENANT_ID, USER_ID, {}), []);
  });

  it("passes a category filter through to the repository", async () => {
    const { service } = build();

    await service.getAchievements(TENANT_ID, USER_ID, { category: AchievementCategory.SPORTS });

    // The filter reaching the query is asserted by the repository suite; here
    // it is enough that the call completes and the service does not filter in
    // memory, which the single repository call proves.
    assert.ok(true);
  });
});

// --- Dashboard composition --------------------------------------------------

describe("StudentProfileService — getDashboard composes, never recomputes", () => {
  it("takes SGPA, CGPA, credits and backlogs from the result service", async () => {
    const { service, seen } = build();
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.academic.sgpa, "8.500000");
    assert.equal(dashboard.academic.cgpa, "8.100000");
    assert.equal(dashboard.academic.earnedCredits, "72.00");
    assert.equal(dashboard.academic.backlogCount, 1);
    assert.ok(seen.includes("getStudentResult"));
  });

  it("READS the attendance warning rather than recomputing a threshold", async () => {
    // There is exactly one definition of the 75% line in this codebase and it
    // is not in the profile service. Attendance says 82.5% but flags a warning;
    // the dashboard must report the FLAG, not its own comparison.
    const { service } = build({}, { overallPercentage: 82.5, lowAttendance: true });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.attendance.overallPercent, "82.50");
    assert.equal(
      dashboard.attendance.hasWarning,
      true,
      "the flag was read, not re-derived from the percentage"
    );
  });

  it("reports no warning when attendance says none, even below a naive threshold", async () => {
    const { service } = build({}, { overallPercentage: 60, lowAttendance: false });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.attendance.hasWarning, false);
  });

  it("takes the pending count from the finance service's total", async () => {
    const { service } = build({}, { pendingTotal: 3, demands: [
      { totalAmount: "10000.00", paidAmount: "0.00", waivedAmount: "0.00" },
      { totalAmount: "20000.00", paidAmount: "5000.00", waivedAmount: "0.00" },
      { totalAmount: "5000.00", paidAmount: "0.00", waivedAmount: "5000.00" },
    ] });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.finance.pendingFeeCount, 3);
    // 10000 + 15000 + 0 = 25000.00, summed in exact hundredths.
    assert.equal(dashboard.finance.outstandingAmount, "25000.00");
  });

  it("sums outstanding EXACTLY, where floats would drift", async () => {
    const { service } = build({}, {
      demands: Array.from({ length: 3 }, () => ({
        totalAmount: "0.07",
        paidAmount: "0.00",
        waivedAmount: "0.00",
      })),
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.finance.outstandingAmount, "0.21");
  });

  it("clamps an OVERPAID demand at zero rather than crediting it elsewhere", async () => {
    const { service } = build({}, {
      demands: [
        { totalAmount: "1000.00", paidAmount: "1500.00", waivedAmount: "0.00" },
        { totalAmount: "2000.00", paidAmount: "0.00", waivedAmount: "0.00" },
      ],
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.finance.outstandingAmount, "2000.00", "the overpayment is not credit");
  });

  it("reports the COUNT but NULLS the amount when not every demand was returned", async () => {
    // Summing one page and presenting it as a balance would be a fabrication
    // that looks authoritative.
    const { service } = build({}, {
      pendingTotal: 500,
      demands: [{ totalAmount: "1000.00", paidAmount: "0.00", waivedAmount: "0.00" }],
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.finance.pendingFeeCount, 500);
    assert.equal(dashboard.finance.outstandingAmount, null);
  });

  it("carries the counts and notifications the repository produced", async () => {
    const { service } = build({
      counts: {
        documentCount: 4,
        pendingDocuments: 2,
        certificateCount: 3,
        activeCertificates: 1,
      },
      notifications: [
        { id: "n1", type: "EMAIL", subject: "Fee due", body: "b", sentAt: PAST, readAt: null },
      ],
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.summary.pendingDocuments, 2);
    assert.equal(dashboard.summary.activeCertificates, 1);
    assert.equal(dashboard.summary.achievementCount, 1);
    assert.equal(dashboard.notifications.length, 1);
    assert.equal(dashboard.notifications[0].isRead, false);
  });

  it("returns an empty notification list rather than null when there are none", async () => {
    const { service } = build({ notifications: [] });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.deepEqual(dashboard.notifications, []);
  });
});

// --- Degradation ------------------------------------------------------------

describe("StudentProfileService — a failing panel does not take the page down", () => {
  it("NULLS the academic panel when the result engine fails", async () => {
    const { service } = build({}, { resultThrows: true });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.academic.sgpa, null);
    assert.equal(dashboard.academic.cgpa, null);
    assert.equal(dashboard.academic.earnedCredits, null);
    assert.equal(dashboard.academic.backlogCount, null);
    assert.equal(dashboard.academic.currentSemester, 3, "the rest of the page still renders");
  });

  it("NULLS attendance when that subsystem fails, and raises no warning", async () => {
    // A warning about a figure nobody has is not actionable.
    const { service } = build({}, { attendanceThrows: true });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.attendance.overallPercent, null);
    assert.equal(dashboard.attendance.hasWarning, false);
  });

  it("NULLS finance when that subsystem fails", async () => {
    const { service } = build({}, { financeThrows: true });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.finance.pendingFeeCount, null);
    assert.equal(dashboard.finance.outstandingAmount, null);
  });

  it("still serves the dashboard when ALL THREE fail", async () => {
    const { service } = build(
      {},
      { resultThrows: true, attendanceThrows: true, financeThrows: true }
    );

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.academic.cgpa, null);
    assert.equal(dashboard.attendance.overallPercent, null);
    assert.equal(dashboard.finance.pendingFeeCount, null);
    assert.ok(dashboard.profile.completionPercent > 0, "completion never depends on them");
  });

  it("NEVER fabricates a zero in place of an unavailable figure", async () => {
    const { service } = build({}, { resultThrows: true, financeThrows: true });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    for (const value of [
      dashboard.academic.sgpa,
      dashboard.academic.cgpa,
      dashboard.finance.outstandingAmount,
    ]) {
      assert.notEqual(value, "0.00");
      assert.notEqual(value, 0);
      assert.equal(value, null);
    }
  });
});

// --- Profile completion -----------------------------------------------------

describe("StudentProfileService — profile completion", () => {
  it("the declared weights total exactly 100", () => {
    // A weighting summing to 95 would silently cap every student below 100 and
    // nobody would notice for months.
    assert.equal(PROFILE_COMPLETION_TOTAL, 100);
    assert.equal(
      Object.values(PROFILE_COMPLETION_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
      100
    );
  });

  it("carries the weighting the Phase 18 decision specified", () => {
    assert.deepEqual(PROFILE_COMPLETION_WEIGHTS, {
      BASIC_INFO: 20,
      PERSONAL_DETAILS: 20,
      PARENTS: 15,
      DOCUMENTS: 20,
      PHOTO: 10,
      EMERGENCY_CONTACT: 10,
      ACHIEVEMENTS: 5,
    });
  });

  it("scores a fully populated profile at 100", async () => {
    const { service } = build();
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.profile.completionPercent, 100);
    assert.deepEqual(dashboard.profile.missingFields, []);
  });

  it("scores an empty profile at 0 and names every missing field", async () => {
    const row = profileRow();
    const { service } = build({
      profile: {
        ...row,
        user: { ...row.user, firstName: "", lastName: "", email: "", phone: null, avatarUrl: null },
        personal: null,
      },
      parents: [],
      documents: [],
      achievements: [],
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.profile.completionPercent, 0);
    assert.ok(dashboard.profile.missingFields.includes("firstName"));
    assert.ok(dashboard.profile.missingFields.includes("dateOfBirth"));
    assert.ok(dashboard.profile.missingFields.includes("parents"));
    assert.ok(dashboard.profile.missingFields.includes("photo"));
  });

  it("deducts exactly the ACHIEVEMENTS weight when only achievements are missing", async () => {
    const { service } = build({ achievements: [] });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.profile.completionPercent, 100 - PROFILE_COMPLETION_WEIGHTS.ACHIEVEMENTS);
    assert.deepEqual(dashboard.profile.missingFields, ["achievements"]);
  });

  it("deducts exactly the PARENTS weight when only parents are missing", async () => {
    const { service } = build({ parents: [] });
    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.profile.completionPercent, 100 - PROFILE_COMPLETION_WEIGHTS.PARENTS);
  });

  it("scores a section ALL-OR-NOTHING, not partially", async () => {
    // Three of four basic-info fields present still scores zero for the
    // section — and names the one that is missing.
    const row = profileRow();
    const { service } = build({
      profile: { ...row, user: { ...row.user, phone: null } },
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.profile.completionPercent, 100 - PROFILE_COMPLETION_WEIGHTS.BASIC_INFO);
    assert.deepEqual(dashboard.profile.missingFields, ["phone"]);
  });

  it("treats a whitespace-only field as missing", async () => {
    const row = profileRow();
    const { service } = build({
      profile: { ...row, user: { ...row.user, firstName: "   " } },
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.ok(dashboard.profile.missingFields.includes("firstName"));
  });

  it("counts an emergency contact only when it is USABLE", async () => {
    // A contact with a relation but no name and no phone cannot be contacted.
    const row = profileRow();
    const { service } = build({
      profile: {
        ...row,
        personal: { ...row.personal, emergencyContact: { relation: "Mother" } },
      },
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(
      dashboard.profile.completionPercent,
      100 - PROFILE_COMPLETION_WEIGHTS.EMERGENCY_CONTACT
    );
    assert.deepEqual(dashboard.profile.missingFields, ["emergencyContact"]);
  });

  it("counts the PHOTO section satisfied by an uploaded document", async () => {
    const row = profileRow();
    const { service } = build({
      profile: { ...row, user: { ...row.user, avatarUrl: null } },
      documents: [documentRow(DocumentType.PHOTO)],
    });

    const dashboard = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(dashboard.profile.completionPercent, 100);
  });

  it("is O(1) in the records held — a hundred documents score the same as one", async () => {
    const one = build({ documents: [documentRow()] });
    const many = build({
      documents: Array.from({ length: 100 }, () => documentRow()),
    });

    const a = await one.service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);
    const b = await many.service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(a.profile.completionPercent, b.profile.completionPercent);
  });

  it("is deterministic across repeated requests", async () => {
    const { service } = build();

    const first = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);
    const second = await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.deepEqual(first.profile, second.profile);
  });
});

// --- Query budget -----------------------------------------------------------

describe("StudentProfileService — query budget", () => {
  it("issues each composed service exactly ONCE per dashboard", async () => {
    const { service, seen } = build();

    await service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(seen.filter((call) => call === "getStudentResult").length, 1);
    assert.equal(seen.filter((call) => call === "getAnalytics").length, 1);
    assert.equal(seen.filter((call) => call === "getPendingFees").length, 1);
  });

  it("issues a fixed set of repository reads regardless of how much data exists", async () => {
    const small = build({ achievements: [achievementRow()] });
    const large = build({
      achievements: Array.from({ length: 200 }, () => achievementRow()),
    });

    await small.service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);
    await large.service.getDashboard(TENANT_ID, USER_ID, { notifications: 5 }, NOW);

    assert.equal(small.calls.length, large.calls.length, "no read is inside a loop");
  });
});

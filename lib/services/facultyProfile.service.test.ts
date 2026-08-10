// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the access rule (a lecturer cannot read or edit a colleague),
//          prove the collection-replacement contract (omitted means untouched,
//          empty means cleared), and prove that one failing subsystem costs one
//          panel rather than the whole dashboard.
//
//          The service depends on a repository TYPE and one narrow PORT, so all
//          of this runs with no database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { EmployeeStatus } from "@/app/generated/prisma/enums";
import {
  FacultyProfileService,
  type FacultyAccessContext,
  type FacultyFeedbackPort,
} from "@/lib/services/facultyProfile.service";
import type { FacultyProfileRepositoryPort } from "@/lib/repositories/facultyProfile.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const FACULTY_ID = "faculty_1";
const OTHER_FACULTY_ID = "faculty_2";

const ADMIN: FacultyAccessContext = { tenantId: TENANT_ID, userId: USER_ID, scope: "ANY" };
const SELF: FacultyAccessContext = { tenantId: TENANT_ID, userId: USER_ID, scope: "OWN" };

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FACULTY_ID,
    tenantId: TENANT_ID,
    employeeId: "FAC001",
    designation: "Assistant Professor",
    qualification: "PhD",
    specialization: "Algorithms",
    experience: 8,
    photoUrl: null,
    status: EmployeeStatus.ACTIVE,
    joinDate: new Date("2019-07-01T00:00:00.000Z"),
    user: {
      firstName: "Priya",
      lastName: "Nair",
      displayName: null,
      email: "priya@example.edu",
      phone: null,
    },
    department: { id: "dept_1", code: "CSE", name: "Computer Science" },
    publications: [],
    certifications: [],
    education: [],
    ...overrides,
  };
}

interface HarnessOptions {
  own?: { id: string; departmentId: string | null } | null;
  profile?: ReturnType<typeof profileRow> | null;
  feedbackThrows?: boolean;
  assignments?: Array<Record<string, unknown>>;
}

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    replaceProfile: [] as Array<Record<string, unknown>>,
    transactions: 0,
    feedback: 0,
  };

  const repository = {
    async findByUserId() {
      return options.own === undefined ? { id: FACULTY_ID, departmentId: "dept_1" } : options.own;
    },
    async findProfile() {
      return options.profile === undefined ? profileRow() : options.profile;
    },
    async findAssignments() {
      return (
        options.assignments ?? [
          {
            courseId: "course_1",
            sectionId: "section_1",
            semesterId: "sem_1",
            isActive: true,
            course: { code: "CS301", name: "Algorithms", credits: 4 },
          },
        ]
      );
    },
    async findTimetable() {
      return [];
    },
    async findAttendanceForFaculty() {
      return { rows: [], truncated: false };
    },
    async findResultsForCourses() {
      return { rows: [], truncated: false };
    },
    async countTaughtStudents() {
      return 42;
    },
    async replaceProfile(input: Record<string, unknown>) {
      calls.replaceProfile.push(input);
      return profileRow();
    },
    async transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      calls.transactions += 1;
      return fn(undefined as never);
    },
  } as unknown as FacultyProfileRepositoryPort;

  const feedback: FacultyFeedbackPort = {
    async findAverageRating() {
      calls.feedback += 1;
      if (options.feedbackThrows) throw new Error("feedback subsystem unavailable");
      return { averageRating: 4.25, responseCount: 17 };
    },
  };

  return { service: new FacultyProfileService(repository, feedback), calls };
}

// --- Access -----------------------------------------------------------------

describe("FacultyProfileService access", () => {
  it("lets an administrative caller read any member", async () => {
    const { service } = makeHarness();

    const profile = await service.getProfile(ADMIN, OTHER_FACULTY_ID);

    assert.equal(profile.employeeId, "FAC001");
  });

  it("lets a faculty member read their OWN record", async () => {
    const { service } = makeHarness({ own: { id: FACULTY_ID, departmentId: "dept_1" } });

    const profile = await service.getProfile(SELF, FACULTY_ID);

    assert.equal(profile.id, FACULTY_ID);
  });

  it("REFUSES a faculty member reading a colleague", async () => {
    const { service } = makeHarness({ own: { id: FACULTY_ID, departmentId: "dept_1" } });

    await assert.rejects(
      () => service.getProfile(SELF, OTHER_FACULTY_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        // 404, not 403 — distinguishing them would confirm the existence of a
        // record the caller may not read.
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("REFUSES a caller who holds the role but owns no FacultyMember row", async () => {
    const { service } = makeHarness({ own: null });

    await assert.rejects(
      () => service.getProfile(SELF, FACULTY_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("gives the SAME 404 for an unknown member as for someone else's record", async () => {
    const { service } = makeHarness({ profile: null });

    await assert.rejects(
      () => service.getProfile(ADMIN, "nope"),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.message, "Faculty member not found");
        return true;
      }
    );
  });

  it("REFUSES a faculty member EDITING a colleague", async () => {
    const { service, calls } = makeHarness({ own: { id: FACULTY_ID, departmentId: null } });

    await assert.rejects(() => service.updateProfile(SELF, OTHER_FACULTY_ID, {}));
    // Nothing was written.
    assert.equal(calls.replaceProfile.length, 0);
  });
});

// --- Update contract --------------------------------------------------------

describe("FacultyProfileService.updateProfile", () => {
  it("leaves a collection UNTOUCHED when it is omitted", async () => {
    // `undefined` means "leave alone". Passing it through as an empty array
    // would silently delete a member's entire publication history.
    const { service, calls } = makeHarness();

    await service.updateProfile(ADMIN, FACULTY_ID, { designation: "Professor" });

    const input = calls.replaceProfile[0];
    assert.equal("publications" in input, false);
    assert.equal("certifications" in input, false);
    assert.equal("education" in input, false);
  });

  it("CLEARS a collection when an empty array is supplied", async () => {
    // `[]` means "empty it" — a different request from omission, honoured
    // differently.
    const { service, calls } = makeHarness();

    await service.updateProfile(ADMIN, FACULTY_ID, { publications: [] });

    const input = calls.replaceProfile[0];
    assert.deepEqual(input.publications, []);
  });

  it("does not write a field the caller omitted", async () => {
    const { service, calls } = makeHarness();

    await service.updateProfile(ADMIN, FACULTY_ID, { designation: "Professor" });

    const profile = calls.replaceProfile[0].profile as Record<string, unknown>;
    assert.equal(profile.designation, "Professor");
    assert.equal("photoUrl" in profile, false);
    assert.equal("experience" in profile, false);
  });

  it("writes an EXPLICIT null, which clears the value", async () => {
    // nullish() in the schema means null is a deliberate clear, distinct from
    // omission, and must survive to the update.
    const { service, calls } = makeHarness();

    await service.updateProfile(ADMIN, FACULTY_ID, { photoUrl: null });

    const profile = calls.replaceProfile[0].profile as Record<string, unknown>;
    assert.equal(profile.photoUrl, null);
  });

  it("performs the whole update inside ONE transaction", async () => {
    // A profile whose publications were deleted but not recreated is data loss
    // with no error.
    const { service, calls } = makeHarness();

    await service.updateProfile(ADMIN, FACULTY_ID, {
      publications: [{ title: "A paper" }],
      education: [{ degree: "PhD", institution: "IIT" }],
    });

    assert.equal(calls.transactions, 1);
    assert.equal(calls.replaceProfile.length, 1);
  });

  it("accepts an empty body as a no-op rather than a 400", async () => {
    const { service } = makeHarness();

    const result = await service.updateProfile(ADMIN, FACULTY_ID, {});

    assert.equal(result.id, FACULTY_ID);
  });
});

// --- Analytics --------------------------------------------------------------

describe("FacultyProfileService analytics", () => {
  it("reports the feedback rating read from Phase 20", async () => {
    const { service } = makeHarness();

    const performance = await service.getPerformance(ADMIN, FACULTY_ID, {});

    assert.equal(performance.feedback.averageRating, 4.25);
    assert.equal(performance.feedback.responseCount, 17);
  });

  it("DEGRADES to a null rating when the feedback subsystem fails", async () => {
    // One unavailable panel must not take the dashboard down.
    const { service } = makeHarness({ feedbackThrows: true });

    const performance = await service.getPerformance(ADMIN, FACULTY_ID, {});

    assert.equal(performance.feedback.averageRating, null);
    assert.equal(performance.feedback.responseCount, 0);
    // Everything else still resolved.
    assert.equal(performance.teaching.studentCount, 42);
  });

  it("exposes NO composite performance score", async () => {
    // The README names "Teaching Performance" but defines no formula. A number
    // appearing here would be one nobody decided.
    const { service } = makeHarness();

    const performance = await service.getPerformance(ADMIN, FACULTY_ID, {});
    const keys = Object.keys(performance);

    assert.equal(keys.includes("score"), false);
    assert.equal(keys.includes("performanceScore"), false);
    assert.equal(keys.includes("rating"), false);
  });

  it("reports null rates for a member with no attendance or results", async () => {
    const { service } = makeHarness();

    const performance = await service.getPerformance(ADMIN, FACULTY_ID, {});

    assert.equal(performance.attendance.presentRate, null);
    assert.equal(performance.results.passRate, null);
    assert.equal(performance.results.averagePercentage, null);
  });

  it("analytics adds the chart breakdowns without a second set of reads", async () => {
    const { service, calls } = makeHarness();

    const analytics = await service.getAnalytics(ADMIN, FACULTY_ID, {});

    assert.ok("slotsBySessionType" in analytics);
    assert.ok("courses" in analytics);
    // One gather, so the feedback port was consulted exactly once.
    assert.equal(calls.feedback, 1);
  });

  it("counts only ACTIVE assignments towards the teaching summary", async () => {
    const { service } = makeHarness({
      assignments: [
        {
          courseId: "course_1",
          sectionId: "section_1",
          semesterId: "sem_1",
          isActive: true,
          course: { code: "CS301", name: "Algorithms", credits: 4 },
        },
        {
          courseId: "course_2",
          sectionId: "section_2",
          semesterId: "sem_1",
          isActive: false,
          course: { code: "CS302", name: "Databases", credits: 4 },
        },
      ],
    });

    const performance = await service.getPerformance(ADMIN, FACULTY_ID, {});

    assert.equal(performance.teaching.courseCount, 1);
  });
});

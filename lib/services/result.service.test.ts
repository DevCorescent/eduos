// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the authorisation confinement, the query budget, and that the
//          DTOs carry the numbers the Result Engine actually produced.
//
//          The service depends on a REPOSITORY TYPE, not on Prisma, so these
//          run with no database and no environment. The fake records every call
//          it receives, which is how the "no N+1" claim is tested rather than
//          asserted: a student with twelve courses across three semesters must
//          still cost EIGHT statements — one subject lookup plus seven reads.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ResultService, type ResultAccess } from "@/lib/services/result.service";
import type { ResultRepository } from "@/lib/repositories/result.repository";
import { AppError } from "@/lib/errors/AppError";
import { COURSE_OUTCOME } from "@/lib/domain/result-engine/enums";

// --- The fake repository ----------------------------------------------------

interface FakeData {
  student?: { id: string; userId: string; enrollmentNo: string } | null;
  studentByUser?: { id: string } | null;
  semester?: { id: string; name: string; startDate: Date; endDate: Date } | null;
  registrations?: unknown[];
  schemes?: unknown[];
  bands?: unknown[];
  components?: unknown[];
  rules?: unknown[];
  criteria?: unknown[];
  marks?: unknown[];
}

/** Records every call so the query budget can be asserted, not assumed. */
function fakeRepository(data: FakeData) {
  const calls: string[] = [];

  const repository = {
    async findStudent() {
      calls.push("findStudent");
      return data.student ?? null;
    },
    async findStudentByUserId() {
      calls.push("findStudentByUserId");
      return data.studentByUser ?? null;
    },
    async findSemester() {
      calls.push("findSemester");
      return data.semester ?? null;
    },
    async findRegistrationsForStudent() {
      calls.push("findRegistrationsForStudent");
      return data.registrations ?? [];
    },
    async findRegistrationsForSemester() {
      calls.push("findRegistrationsForSemester");
      return data.registrations ?? [];
    },
    async findSchemes() {
      calls.push("findSchemes");
      return data.schemes ?? [];
    },
    async findGradeBands() {
      calls.push("findGradeBands");
      return data.bands ?? [];
    },
    async findComponents() {
      calls.push("findComponents");
      return data.components ?? [];
    },
    async findRules() {
      calls.push("findRules");
      return data.rules ?? [];
    },
    async findCriteria() {
      calls.push("findCriteria");
      return data.criteria ?? [];
    },
    async findMarks() {
      calls.push("findMarks");
      return data.marks ?? [];
    },
  } as unknown as ResultRepository;

  return { repository, calls };
}

// --- Fixtures ---------------------------------------------------------------

const STUDENT = { id: "student_1", userId: "user_1", enrollmentNo: "2024CS001" };
const ANY_ACCESS: ResultAccess = { scope: "ANY" };

const SCHEME = {
  id: "scheme_1",
  code: "REG2024",
  version: 1,
  gradeScaleId: "scale_1",
  attemptPolicy: "BEST_ATTEMPT",
  marksRounding: "HALF_UP",
  marksPrecision: 2,
  gpaRounding: "HALF_UP",
  gpaPrecision: 2,
  gradeScale: {
    id: "scale_1",
    method: "ABSOLUTE",
    methodConfig: null,
    maxGradePoint: "10.00",
  },
};

const BANDS = [
  {
    gradeScaleId: "scale_1",
    grade: "F",
    label: "Fail",
    minPercent: "0.00",
    maxPercent: "39.99",
    gradePoint: "0.00",
    isPass: false,
    countsForGpa: false,
    sequence: 3,
  },
  {
    gradeScaleId: "scale_1",
    grade: "B",
    label: "First Class",
    minPercent: "40.00",
    maxPercent: "79.99",
    gradePoint: "8.00",
    isPass: true,
    countsForGpa: true,
    sequence: 2,
  },
  {
    gradeScaleId: "scale_1",
    grade: "A",
    label: "Distinction",
    minPercent: "80.00",
    maxPercent: "100.00",
    gradePoint: "10.00",
    isPass: true,
    countsForGpa: true,
    sequence: 1,
  },
];

const COMPONENTS = [
  {
    id: "component_1",
    schemeId: "scheme_1",
    parentComponentId: null,
    code: "TOT",
    sequence: 1,
    maxMarks: "100.00",
    weightage: "100.00",
    aggregation: "SUM",
    rollup: null,
    sourceType: "MANUAL_ENTRY",
    isMandatory: true,
    ruleConfig: null,
  },
];

function registration(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    studentId: STUDENT.id,
    courseId: `course_${id}`,
    semesterId: "sem_1",
    sectionId: null,
    programmeId: null,
    evaluationSchemeId: "scheme_1",
    credits: "4.00",
    registrationType: "REGULAR",
    attemptNumber: 1,
    status: "COMPLETED",
    course: { id: `course_${id}`, code: `CS${id}`, name: `Course ${id}` },
    semester: { id: "sem_1", name: "Semester 1", startDate: new Date("2024-07-01") },
    ...overrides,
  };
}

function mark(
  registrationId: string,
  marks: string,
  status = "PUBLISHED"
): Record<string, unknown> {
  return {
    courseRegistrationId: registrationId,
    marksObtained: marks,
    status: "RECORDED",
    assessmentEvent: {
      id: `event_${registrationId}`,
      evaluationComponentId: "component_1",
      maxMarks: "100.00",
      sequenceNumber: 1,
      status,
    },
  };
}

function baseData(overrides: FakeData = {}): FakeData {
  return {
    student: STUDENT,
    schemes: [SCHEME],
    bands: BANDS,
    components: COMPONENTS,
    rules: [],
    criteria: [],
    registrations: [registration("r1")],
    marks: [mark("r1", "85.00")],
    ...overrides,
  };
}

function serviceFor(data: FakeData) {
  const { repository, calls } = fakeRepository(data);
  return { service: new ResultService(repository), calls };
}

async function expectAppError(
  run: () => Promise<unknown>,
  status: number
): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    assert.equal(error.statusCode, status);
    return error;
  }

  throw new Error(`expected a ${status}`);
}

// --- Authorisation ----------------------------------------------------------

describe("ResultService — authorisation", () => {
  it("an elevated caller reads any student", async () => {
    const { service } = serviceFor(baseData());
    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(result.studentId, "student_1");
  });

  it("a STUDENT reads their own record", async () => {
    const { service } = serviceFor(baseData({ studentByUser: { id: "student_1" } }));

    const result = await service.getStudentResult("tenant_1", "student_1", {
      scope: "OWN",
      userId: "user_1",
    });

    assert.equal(result.studentId, "student_1");
  });

  it("a STUDENT asking for ANOTHER student receives 403, not 404", async () => {
    // 403 strictly precedes 404, which is what stops the endpoint disclosing
    // whether the other id exists.
    const { service, calls } = serviceFor(baseData({ studentByUser: { id: "student_1" } }));

    await expectAppError(
      () => service.getStudentResult("tenant_1", "student_OTHER", { scope: "OWN", userId: "user_1" }),
      403
    );

    assert.ok(
      !calls.includes("findStudent"),
      "the requested id was never used to look anything up"
    );
  });

  it("a STUDENT with no student row in this tenant is FORBIDDEN, not served empty", async () => {
    const { service } = serviceFor(baseData({ studentByUser: null }));

    await expectAppError(
      () => service.getStudentResult("tenant_1", "student_1", { scope: "OWN", userId: "ghost" }),
      403
    );
  });

  it("applies the same confinement to the transcript", async () => {
    const { service } = serviceFor(baseData({ studentByUser: { id: "student_1" } }));

    await expectAppError(
      () => service.getTranscript("tenant_1", "other", { scope: "OWN", userId: "user_1" }),
      403
    );
  });

  it("applies the same confinement to analytics", async () => {
    const { service } = serviceFor(baseData({ studentByUser: { id: "student_1" } }));

    await expectAppError(
      () => service.getAnalytics("tenant_1", "other", { scope: "OWN", userId: "user_1" }),
      403
    );
  });

  it("raises 404 for a student outside the tenant", async () => {
    // The repository is tenant-scoped, so an other-tenant student reads as
    // absent — an unknown id and a mis-tenanted one are indistinguishable.
    const { service } = serviceFor(baseData({ student: null }));

    await expectAppError(
      () => service.getStudentResult("tenant_1", "student_1", ANY_ACCESS),
      404
    );
  });

  it("raises 404 for a semester outside the tenant", async () => {
    const { service } = serviceFor(baseData({ semester: null }));

    await expectAppError(() => service.getSemesterResult("tenant_1", "sem_x"), 404);
  });
});

// --- The query budget -------------------------------------------------------

describe("ResultService — the query budget is fixed", () => {
  it("costs EIGHT statements for one course — one subject lookup plus seven reads", async () => {
    const { service, calls } = serviceFor(baseData());
    await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(calls.length, 8, calls.join(", "));
  });

  it("costs the SAME eight for twelve courses across three semesters", async () => {
    const registrations = Array.from({ length: 12 }, (_value, index) =>
      registration(`r${index}`, {
        semesterId: `sem_${index % 3}`,
        semester: {
          id: `sem_${index % 3}`,
          name: `Semester ${index % 3}`,
          startDate: new Date(2024, index % 3, 1),
        },
      })
    );

    const { service, calls } = serviceFor(
      baseData({
        registrations,
        marks: registrations.map((row) => mark(row.id as string, "70.00")),
      })
    );

    await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(calls.length, 8, "not eight per course — eight total");
    assert.equal(calls.filter((call) => call === "findComponents").length, 1);
    assert.equal(calls.filter((call) => call === "findMarks").length, 1);
  });

  it("costs eight for a whole cohort, not eight per student", async () => {
    const registrations = Array.from({ length: 200 }, (_value, index) =>
      registration(`r${index}`, { studentId: `student_${index}` })
    );

    const { service, calls } = serviceFor(
      baseData({
        semester: {
          id: "sem_1",
          name: "Semester 1",
          startDate: new Date("2024-07-01"),
          endDate: new Date("2024-12-01"),
        },
        registrations,
        marks: registrations.map((row) => mark(row.id as string, "75.00")),
      })
    );

    await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(calls.length, 8, calls.join(", "));
  });
});

// --- Student result ---------------------------------------------------------

describe("ResultService — getStudentResult", () => {
  it("reports the grade, classification and credits the engine produced", async () => {
    const { service } = serviceFor(baseData());
    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    const course = result.semesters[0].courses[0];

    assert.equal(course.percentage, "85.00");
    assert.equal(course.grade, "A");
    assert.equal(course.classification, "Distinction");
    assert.equal(course.gradePoint, "10.00");
    assert.equal(course.outcome, COURSE_OUTCOME.PASS);
    assert.equal(course.isPass, true);
    assert.equal(course.creditsEarned, "4.00");
  });

  it("reports every decimal as a LOSSLESS STRING, never a JSON number", async () => {
    const { service } = serviceFor(baseData());
    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(typeof result.semesters[0].sgpa.value, "string");
    assert.equal(typeof result.semesters[0].courses[0].percentage, "string");
    assert.equal(typeof result.cgpa.creditsEarned, "string");
  });

  it("computes the SGPA at the regulation's own precision", async () => {
    const { service } = serviceFor(baseData());
    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(result.semesters[0].sgpa.value, "10.000000");
  });

  it("reports a FAILING course without credit and as a backlog", async () => {
    const { service } = serviceFor(baseData({ marks: [mark("r1", "20.00")] }));
    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    const course = result.semesters[0].courses[0];

    assert.equal(course.grade, "F");
    assert.equal(course.outcome, COURSE_OUTCOME.FAIL);
    assert.equal(course.creditsEarned, "0.00");
    assert.equal(result.semesters[0].backlogCount, 1);
    assert.equal(result.semesters[0].isPromoted, false);
  });

  it("returns NULL, not zero, for a student with nothing credit-bearing", async () => {
    const { service } = serviceFor(baseData({ registrations: [], marks: [] }));
    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(result.cgpa.value, null);
    assert.deepEqual(result.semesters, []);
  });

  it("separates PENDING credits from FAILED ones", async () => {
    const { service } = serviceFor(
      baseData({
        registrations: [registration("r1"), registration("r2")],
        marks: [mark("r1", "20.00"), { ...mark("r2", "90.00"), status: "WITHHELD" }],
      })
    );

    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(result.credits.failed, "4.00");
    assert.equal(result.credits.pending, "4.00");
    assert.equal(result.credits.earned, "0.00");
  });

  it("reports a result as PUBLISHED only when every sitting is", async () => {
    const published = serviceFor(baseData());
    const locked = serviceFor(baseData({ marks: [mark("r1", "85.00", "LOCKED")] }));

    const a = await published.service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);
    const b = await locked.service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(a.semesters[0].isPublished, true);
    assert.equal(b.semesters[0].isPublished, false, "LOCKED is settled but not released");
  });

  it("WARNS rather than throws when a regulation cannot be prepared", async () => {
    // A gapped band table. Every other regulation in the request still
    // computes, and the students it governs still get their results.
    const { service } = serviceFor(
      baseData({ bands: [{ ...BANDS[0], maxPercent: "30.00" }, BANDS[2]] })
    );

    const result = await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS);

    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].includes("REG2024"));
  });

  it("gives the identical answer when the same request is repeated", async () => {
    const { service } = serviceFor(baseData());

    assert.deepEqual(
      await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS),
      await service.getStudentResult("tenant_1", "student_1", ANY_ACCESS)
    );
  });
});

// --- Transcript -------------------------------------------------------------

describe("ResultService — getTranscript", () => {
  it("builds one line per semester with a running CGPA", async () => {
    const registrations = [
      registration("r1", {
        semesterId: "sem_1",
        semester: { id: "sem_1", name: "Semester 1", startDate: new Date("2024-07-01") },
      }),
      registration("r2", {
        semesterId: "sem_2",
        semester: { id: "sem_2", name: "Semester 2", startDate: new Date("2025-01-01") },
      }),
    ];

    const { service } = serviceFor(
      baseData({
        registrations,
        marks: [mark("r1", "85.00"), mark("r2", "50.00")],
      })
    );

    const transcript = await service.getTranscript("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(transcript.lines.length, 2);
    assert.equal(transcript.lines[0].semesterName, "Semester 1");
    assert.equal(transcript.lines[0].sgpa, "10.000000");
    assert.equal(transcript.lines[1].sgpa, "8.000000");
    assert.equal(transcript.lines[1].cgpa, "9.000000", "cumulative, not the semester's own");
  });

  it("carries the degree summary and a classification from the tenant's bands", async () => {
    const { service } = serviceFor(baseData());
    const transcript = await service.getTranscript("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(transcript.degreeSummary.creditsEarned, "4.00");
    assert.equal(transcript.degreeSummary.cgpa, "10.000000");
    assert.equal(transcript.standing.classification, "Distinction");
    assert.equal(transcript.standing.isClear, true);
  });

  it("prints every course with its grade, points and attempt", async () => {
    const { service } = serviceFor(baseData());
    const transcript = await service.getTranscript("tenant_1", "student_1", ANY_ACCESS);

    const course = transcript.lines[0].courses[0];

    assert.equal(course.courseCode, "CSr1");
    assert.equal(course.grade, "A");
    assert.equal(course.gradePoint, "10.00");
    assert.equal(course.attemptNumber, 1);
  });

  it("is not provisional when nothing is outstanding", async () => {
    const { service } = serviceFor(baseData());
    const transcript = await service.getTranscript("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(transcript.isProvisional, false);
  });
});

// --- Analytics --------------------------------------------------------------

describe("ResultService — getAnalytics", () => {
  it("builds a performance trend from the transcript, not from a second sum", async () => {
    const registrations = [
      registration("r1", {
        semesterId: "sem_1",
        semester: { id: "sem_1", name: "Semester 1", startDate: new Date("2024-07-01") },
      }),
      registration("r2", {
        semesterId: "sem_2",
        semester: { id: "sem_2", name: "Semester 2", startDate: new Date("2025-01-01") },
      }),
    ];

    const { service } = serviceFor(
      baseData({ registrations, marks: [mark("r1", "50.00"), mark("r2", "90.00")] })
    );

    const analytics = await service.getAnalytics("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(analytics.performanceTrend.length, 2);
    assert.equal(analytics.performanceTrend[0].sgpa, "8.000000");
    assert.equal(analytics.performanceTrend[1].sgpa, "10.000000");
    assert.equal(analytics.trendDelta, "2.000000");
  });

  it("has NO trend delta for a single semester", async () => {
    const { service } = serviceFor(baseData());
    const analytics = await service.getAnalytics("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(analytics.trendDelta, null);
  });

  it("breaks down components by the codes CONFIGURATION supplies", async () => {
    const { service } = serviceFor(baseData());
    const analytics = await service.getAnalytics("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(analytics.componentBreakdown.length, 1);
    assert.equal(analytics.componentBreakdown[0].code, "TOT");
    assert.equal(analytics.componentBreakdown[0].percent, "85.00");
  });

  it("lists a backlog and marks it cleared once a later attempt passes", async () => {
    const failed = registration("r1", { attemptNumber: 1, courseId: "course_math" });
    const cleared = registration("r2", {
      attemptNumber: 2,
      courseId: "course_math",
      registrationType: "BACKLOG",
    });

    const { service } = serviceFor(
      baseData({
        registrations: [failed, cleared],
        marks: [mark("r1", "20.00"), mark("r2", "60.00")],
      })
    );

    const analytics = await service.getAnalytics("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(analytics.backlogs.length, 1);
    assert.equal(analytics.backlogs[0].isCleared, true);
  });

  it("records every attempt beyond the first as improvement history", async () => {
    const { service } = serviceFor(
      baseData({
        registrations: [
          registration("r1"),
          registration("r2", { attemptNumber: 2, registrationType: "IMPROVEMENT" }),
        ],
        marks: [mark("r1", "45.00"), mark("r2", "90.00")],
      })
    );

    const analytics = await service.getAnalytics("tenant_1", "student_1", ANY_ACCESS);

    assert.equal(analytics.improvementHistory.length, 1);
    assert.equal(analytics.improvementHistory[0].attemptNumber, 2);
    assert.equal(analytics.improvementHistory[0].registrationType, "IMPROVEMENT");
  });

  it("returns rankHistory EMPTY — a rank of one is not a rank", async () => {
    const { service } = serviceFor(baseData());
    const analytics = await service.getAnalytics("tenant_1", "student_1", ANY_ACCESS);

    assert.deepEqual(analytics.rankHistory, []);
  });
});

// --- Semester cohort --------------------------------------------------------

describe("ResultService — getSemesterResult", () => {
  const SEMESTER = {
    id: "sem_1",
    name: "Semester 1",
    startDate: new Date("2024-07-01"),
    endDate: new Date("2024-12-01"),
  };

  function cohortOf(marksByStudent: readonly string[]) {
    const registrations = marksByStudent.map((_value, index) =>
      registration(`r${index}`, { studentId: `student_${index}` })
    );

    return serviceFor(
      baseData({
        semester: SEMESTER,
        registrations,
        marks: marksByStudent.map((value, index) => mark(`r${index}`, value)),
      })
    );
  }

  it("summarises pass and fail percentages over the cohort", async () => {
    const { service } = cohortOf(["90.00", "70.00", "50.00", "20.00"]);
    const result = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(result.statistics.total, 4);
    assert.equal(result.statistics.passed, 3);
    assert.equal(result.statistics.failed, 1);
    assert.equal(result.statistics.passPercent, "75.00");
    assert.equal(result.statistics.failPercent, "25.00");
  });

  it("computes the average, median and extremes exactly", async () => {
    const { service } = cohortOf(["90.00", "70.00", "50.00", "20.00"]);
    const result = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(result.statistics.average, "57.50");
    assert.equal(result.statistics.median, "60.00");
    assert.equal(result.statistics.highest, "90.00");
    assert.equal(result.statistics.lowest, "20.00");
  });

  it("builds a grade distribution", async () => {
    const { service } = cohortOf(["90.00", "85.00", "50.00", "20.00"]);
    const result = await service.getSemesterResult("tenant_1", "sem_1");

    const total = result.gradeDistribution.reduce((sum, row) => sum + row.count, 0);

    assert.equal(total, 4);
  });

  it("builds a merit list ordered best first", async () => {
    const { service } = cohortOf(["50.00", "90.00", "70.00"]);
    const result = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(result.meritList[0].rank, 1);
    assert.ok(result.meritList.length >= 1);
    assert.equal(result.meritList[0].outOf, result.meritList.length);
  });

  it("gives every student a rank, or null when they were excluded", async () => {
    const { service } = cohortOf(["90.00", "70.00"]);
    const result = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(result.students.length, 2);
    for (const student of result.students) {
      assert.ok(student.rank === null || student.rank >= 1);
    }
  });

  it("EXCLUDES a withheld student from the averages but keeps them in the total", async () => {
    const registrations = [
      registration("r0", { studentId: "student_0" }),
      registration("r1", { studentId: "student_1" }),
    ];

    const { service } = serviceFor(
      baseData({
        semester: SEMESTER,
        registrations,
        marks: [mark("r0", "80.00"), { ...mark("r1", "90.00"), status: "WITHHELD" }],
      })
    );

    const result = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(result.statistics.total, 2);
    assert.equal(result.statistics.evaluated, 1);
    assert.equal(result.statistics.pending, 1);
    assert.equal(result.statistics.average, "80.00", "the sealed result did not drag it down");
  });

  it("handles a semester nobody registered for", async () => {
    const { service } = serviceFor(
      baseData({ semester: SEMESTER, registrations: [], marks: [] })
    );

    const result = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(result.statistics.total, 0);
    assert.equal(result.statistics.average, null);
    assert.deepEqual(result.meritList, []);
  });

  it("refuses a cohort beyond the bound rather than summarising a slice", async () => {
    const registrations = Array.from({ length: 5001 }, (_value, index) =>
      registration(`r${index}`, { studentId: `student_${index}` })
    );

    const { service } = serviceFor(
      baseData({ semester: SEMESTER, registrations, marks: [] })
    );

    await expectAppError(() => service.getSemesterResult("tenant_1", "sem_1"), 422);
  });

  it("processes a 500-student cohort deterministically", async () => {
    const { service } = cohortOf(
      Array.from({ length: 500 }, (_value, index) => `${30 + (index % 60)}.00`)
    );

    const first = await service.getSemesterResult("tenant_1", "sem_1");
    const second = await service.getSemesterResult("tenant_1", "sem_1");

    assert.equal(first.students.length, 500);
    assert.deepEqual(first.statistics, second.statistics);
    assert.deepEqual(first.meritList, second.meritList);
  });
});

// --- Bounds -----------------------------------------------------------------

describe("ResultService — bounds", () => {
  it("refuses a student with more registrations than it will process", async () => {
    const registrations = Array.from({ length: 501 }, (_value, index) =>
      registration(`r${index}`)
    );

    const { service } = serviceFor(baseData({ registrations, marks: [] }));

    await expectAppError(
      () => service.getStudentResult("tenant_1", "student_1", ANY_ACCESS),
      422
    );
  });
});

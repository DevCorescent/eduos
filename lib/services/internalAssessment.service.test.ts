// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the three properties that decide whether this feature is safe
//          to put in front of a faculty member:
//
//            1. The numeric suggestion NEVER depends on the AI provider.
//            2. A student with no evidence gets a NULL suggestion, not a zero.
//            3. Departing from a suggestion REQUIRES a recorded reason.
//
//          The service depends on a repository TYPE and two narrow PORTS, so
//          all of this runs with no database, no network and no API key.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { EvaluationComponentType, EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { INTERNAL_ASSESSMENT_ACTION } from "@/lib/constants/internalAssessment";
import {
  InternalAssessmentService,
  type RationalePort,
} from "@/lib/services/internalAssessment.service";
import type { InternalAssessmentRepositoryPort } from "@/lib/repositories/internalAssessment.repository";
import type { AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "semester_1";
const TARGET_ID = "component_internal";
const NOW = new Date("2026-04-01T09:00:00.000Z");

const DEPARTMENT_ID = "dept_cse";

/** An unnarrowed caller — UNIVERSITY_ADMIN or FACULTY. */
const CONTEXT = {
  userId: USER_ID,
  departmentId: null,
  ipAddress: null,
  userAgent: null,
};

/** A head of department, narrowed by the guard to DEPARTMENT_ID. */
const HEAD_CONTEXT = { ...CONTEXT, departmentId: DEPARTMENT_ID };

function component(overrides: Record<string, unknown> = {}) {
  return {
    id: "component_x",
    code: "CX",
    name: "Component",
    type: EvaluationComponentType.ASSIGNMENT,
    sourceType: "MANUAL_ENTRY",
    maxMarks: 40,
    weightage: 50,
    parentComponentId: null,
    isMandatory: true,
    ...overrides,
  };
}

const DEFAULT_SCHEME = {
  id: "scheme_1",
  code: "BTECH-R2023",
  name: "B.Tech Regulation 2023",
  version: 1,
  status: EvaluationSchemeStatus.ACTIVE,
  marksPrecision: 2,
  components: [
    component({ id: TARGET_ID, code: "IA", type: EvaluationComponentType.INTERNAL, maxMarks: 40 }),
    component({ id: "c_assign", code: "ASSN", type: EvaluationComponentType.ASSIGNMENT, weightage: 50 }),
    component({ id: "c_quiz", code: "QUIZ", type: EvaluationComponentType.QUIZ, weightage: 30 }),
    component({ id: "c_att", code: "ATT", type: EvaluationComponentType.ATTENDANCE, weightage: 20 }),
  ],
};

interface HarnessOptions {
  scheme?: typeof DEFAULT_SCHEME | null;
  cohortSize?: number;
  attendance?: Array<{ studentId: string; held: number; attended: number }>;
  assignments?: Array<{ studentId: string; graded: number; obtained: number; available: number }>;
  componentScores?: Array<{ studentId: string; graded: number; obtained: number; available: number }>;
  prior?: Array<{ studentId: string; graded: number; obtained: number; available: number }>;
  existingSuggestion?: Record<string, unknown> | null;
  rationaleFails?: boolean;
  /** Whether a narrowed caller's department owns the named course/student. */
  departmentOwnsCourse?: boolean;
  departmentOwnsStudent?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    upserts: [] as Array<Record<string, unknown>>,
    audits: [] as Array<{ action: string; after: unknown }>,
    rationale: 0,
    transactions: 0,
    departmentChecks: 0,
  };

  const cohortSize = options.cohortSize ?? 1;

  const repository = {
    async findActiveSchemeComponents() {
      return options.scheme === undefined ? DEFAULT_SCHEME : options.scheme;
    },
    async findRegisteredStudents() {
      return Array.from({ length: cohortSize }, (_, index) => ({
        studentId: index === 0 ? STUDENT_ID : `student_${index + 1}`,
        student: { id: index === 0 ? STUDENT_ID : `student_${index + 1}`, enrollmentNo: `E${index}` },
      }));
    },
    async findAttendanceTotals() {
      return options.attendance ?? [{ studentId: STUDENT_ID, held: 10, attended: 9 }];
    },
    async findAssignmentTotals() {
      return (
        options.assignments ?? [
          { studentId: STUDENT_ID, graded: 2, obtained: 40, available: 50 },
        ]
      );
    },
    async findComponentScoreTotals() {
      return options.componentScores ?? [];
    },
    async findPriorPerformance() {
      return options.prior ?? [];
    },
    async upsertSuggestion(input: Record<string, unknown>) {
      calls.upserts.push(input);
      return {
        id: `sug_${calls.upserts.length}`,
        studentId: input.studentId,
        courseId: input.courseId,
        semesterId: input.semesterId,
        componentId: input.componentId,
        suggestedMarks: input.suggestedMarks,
        confidence: input.confidence,
        factors: input.factors,
        rationale: input.rationale,
        aiModel: input.aiModel,
        generatedAt: NOW,
        finalMarks: null,
        overrideReason: null,
        decidedAt: null,
        student: { id: input.studentId, enrollmentNo: "E0" },
      };
    },
    async findSuggestions() {
      return [];
    },
    async findSuggestion() {
      return options.existingSuggestion === undefined
        ? {
            id: "sug_1",
            studentId: STUDENT_ID,
            courseId: COURSE_ID,
            semesterId: SEMESTER_ID,
            componentId: TARGET_ID,
            suggestedMarks: 30,
            confidence: 1,
            factors: null,
            rationale: null,
            aiModel: null,
            generatedAt: NOW,
            finalMarks: null,
            overrideReason: null,
            decidedAt: null,
            student: { id: STUDENT_ID, enrollmentNo: "E0" },
          }
        : options.existingSuggestion;
    },
    async recordDecision(input: Record<string, unknown>) {
      return {
        id: input.id,
        studentId: STUDENT_ID,
        courseId: COURSE_ID,
        semesterId: SEMESTER_ID,
        componentId: TARGET_ID,
        suggestedMarks: 30,
        confidence: 1,
        factors: null,
        rationale: null,
        aiModel: null,
        generatedAt: NOW,
        finalMarks: input.finalMarks,
        overrideReason: input.overrideReason,
        decidedAt: input.decidedAt,
        student: { id: STUDENT_ID, enrollmentNo: "E0" },
      };
    },
    async findAudit() {
      return [];
    },
    async courseBelongsToDepartment() {
      calls.departmentChecks += 1;
      return options.departmentOwnsCourse ?? false;
    },
    async studentBelongsToDepartment() {
      calls.departmentChecks += 1;
      return options.departmentOwnsStudent ?? false;
    },
    async transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      calls.transactions += 1;
      return fn(undefined as never);
    },
  } as unknown as InternalAssessmentRepositoryPort;

  const auditLog: AuditLogRepositoryPort = {
    async record(entry) {
      calls.audits.push({ action: entry.action, after: entry.after });
    },
  };

  const rationale: RationalePort = {
    async explain() {
      calls.rationale += 1;
      if (options.rationaleFails) return null;
      return { text: "Check attendance before accepting.", model: "test-model" };
    },
  };

  return {
    service: new InternalAssessmentService(repository, auditLog, rationale),
    calls,
  };
}

// --- generate ---------------------------------------------------------------

describe("InternalAssessmentService.generate", () => {
  const input = {
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    componentId: TARGET_ID,
    withRationale: false,
  };

  it("produces a suggestion from the university's own configured weights", async () => {
    const { service, calls } = makeHarness();

    const result = await service.generate(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(result.generated, 1);
    assert.ok(calls.upserts[0].suggestedMarks !== null);
  });

  it("NEVER contacts the provider unless a rationale was requested", async () => {
    const { service, calls } = makeHarness();

    await service.generate(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(calls.rationale, 0);
  });

  it("keeps the suggestion INTACT when the provider fails", async () => {
    // A mark that vanished because a remote model was briefly unavailable would
    // be unreproducible and unfair.
    const withProvider = makeHarness({ rationaleFails: true });
    const withoutProvider = makeHarness();

    const a = await withProvider.service.generate(
      TENANT_ID,
      { ...input, withRationale: true },
      CONTEXT,
      NOW
    );
    const b = await withoutProvider.service.generate(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(withProvider.calls.rationale, 1);
    assert.equal(a.aiModel, null);
    // The numeric outcome is identical either way.
    assert.equal(
      withProvider.calls.upserts[0].suggestedMarks,
      withoutProvider.calls.upserts[0].suggestedMarks
    );
    assert.equal(a.generated, b.generated);
  });

  it("contacts the provider ONCE for the whole run, not once per student", async () => {
    const { service, calls } = makeHarness({
      cohortSize: 25,
      attendance: [],
      assignments: [],
    });

    await service.generate(TENANT_ID, { ...input, withRationale: true }, CONTEXT, NOW);

    assert.equal(calls.rationale, 1);
    assert.equal(calls.upserts.length, 25);
  });

  it("gives a student with NO evidence a null suggestion, never a zero", async () => {
    // Recommending zero marks for someone the system knows nothing about is the
    // single most damaging thing this feature could do.
    const { service, calls } = makeHarness({
      attendance: [],
      assignments: [],
      componentScores: [],
      prior: [],
    });

    const result = await service.generate(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(calls.upserts[0].suggestedMarks, null);
    assert.equal(calls.upserts[0].confidence, 0);
    assert.equal(result.withoutEvidence, 1);
  });

  it("EXCLUDES the target component from its own evidence", async () => {
    // Including it would let the thing being suggested contribute to its own
    // suggestion.
    const { service, calls } = makeHarness();

    await service.generate(TENANT_ID, input, CONTEXT, NOW);

    const factors = calls.upserts[0].factors as Record<string, unknown>;
    const used = factors.used as string[];

    assert.equal(used.includes("internal"), false);
  });

  it("records the evidence it used, so a suggestion can be explained later", async () => {
    const { service, calls } = makeHarness();

    await service.generate(TENANT_ID, input, CONTEXT, NOW);

    const factors = calls.upserts[0].factors as Record<string, unknown>;

    assert.ok("attendance" in factors);
    assert.ok("assignment" in factors);
    assert.ok("used" in factors);
    assert.ok("missing" in factors);
  });

  it("writes every upsert and the audit entry inside ONE transaction", async () => {
    const { service, calls } = makeHarness({ cohortSize: 3, attendance: [], assignments: [] });

    await service.generate(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(calls.transactions, 1);
    assert.equal(calls.upserts.length, 3);
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0].action, INTERNAL_ASSESSMENT_ACTION.GENERATE);
  });

  it("404s when no ACTIVE scheme governs the course-semester", async () => {
    // Proceeding with no rules would mean inventing weights.
    const { service } = makeHarness({ scheme: null });

    await assert.rejects(
      () => service.generate(TENANT_ID, input, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("404s when the named component is not in the scheme", async () => {
    const { service } = makeHarness();

    await assert.rejects(
      () => service.generate(TENANT_ID, { ...input, componentId: "nope" }, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});

// --- decide -----------------------------------------------------------------

describe("InternalAssessmentService.decide", () => {
  const base = {
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    componentId: TARGET_ID,
  };

  it("accepts a mark EQUAL to the suggestion with no reason", async () => {
    // Accepting a proposal needs no justification.
    const { service } = makeHarness();

    const result = await service.decide(
      TENANT_ID,
      STUDENT_ID,
      { ...base, finalMarks: 30 },
      CONTEXT,
      NOW
    );

    assert.equal(result.finalMarks, 30);
    assert.equal(result.isOverridden, false);
    assert.equal(result.isDecided, true);
  });

  it("REQUIRES a reason when the mark differs from the suggestion", async () => {
    // Departing from a proposal does need justification — TD-008 and TD-C39
    // both record what an unexplained consequential change costs.
    const { service } = makeHarness();

    await assert.rejects(
      () =>
        service.decide(TENANT_ID, STUDENT_ID, { ...base, finalMarks: 38 }, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /reason/i);
        return true;
      }
    );
  });

  it("accepts a differing mark WITH a reason, and flags it as an override", async () => {
    const { service } = makeHarness();

    const result = await service.decide(
      TENANT_ID,
      STUDENT_ID,
      { ...base, finalMarks: 38, overrideReason: "Exceptional lab work not captured by marks" },
      CONTEXT,
      NOW
    );

    assert.equal(result.finalMarks, 38);
    assert.equal(result.isOverridden, true);
    assert.equal(result.overrideReason, "Exceptional lab work not captured by marks");
  });

  it("REQUIRES a reason when the suggestion itself was null", async () => {
    // There is nothing to accept, so any awarded mark is a departure.
    const { service } = makeHarness({
      existingSuggestion: {
        id: "sug_1",
        studentId: STUDENT_ID,
        courseId: COURSE_ID,
        semesterId: SEMESTER_ID,
        componentId: TARGET_ID,
        suggestedMarks: null,
        confidence: 0,
        factors: null,
        rationale: null,
        aiModel: null,
        generatedAt: NOW,
        finalMarks: null,
        overrideReason: null,
        decidedAt: null,
        student: { id: STUDENT_ID, enrollmentNo: "E0" },
      },
    });

    await assert.rejects(() =>
      service.decide(TENANT_ID, STUDENT_ID, { ...base, finalMarks: 20 }, CONTEXT, NOW)
    );
  });

  it("REFUSES a mark above the component's maximum, naming it", async () => {
    const { service } = makeHarness();

    await assert.rejects(
      () =>
        service.decide(
          TENANT_ID,
          STUDENT_ID,
          { ...base, finalMarks: 41, overrideReason: "x" },
          CONTEXT,
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /40/);
        return true;
      }
    );
  });

  it("404s when no suggestion exists for the student", async () => {
    // A decision with no proposal behind it is not an override, and this
    // phase's premise is that the two travel together.
    const { service } = makeHarness({ existingSuggestion: null });

    await assert.rejects(
      () =>
        service.decide(TENANT_ID, STUDENT_ID, { ...base, finalMarks: 30 }, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("audits the decision inside the transaction, carrying both figures", async () => {
    const { service, calls } = makeHarness();

    await service.decide(
      TENANT_ID,
      STUDENT_ID,
      { ...base, finalMarks: 38, overrideReason: "Lab work" },
      CONTEXT,
      NOW
    );

    assert.equal(calls.transactions, 1);
    assert.equal(calls.audits[0].action, INTERNAL_ASSESSMENT_ACTION.DECIDE);

    const after = calls.audits[0].after as Record<string, unknown>;
    assert.equal(after.suggestedMarks, 30);
    assert.equal(after.finalMarks, 38);
    assert.equal(after.isOverride, true);
    // The studentId is written into the snapshot because AuditLog has no such
    // column — the audit endpoint filters on exactly this.
    assert.equal(after.studentId, STUDENT_ID);
  });
});

// --- rules ------------------------------------------------------------------

describe("InternalAssessmentService.getRules", () => {
  it("reports the university's own weightages, inventing none", async () => {
    const { service } = makeHarness();

    const rules = await service.getRules(TENANT_ID, {
      courseId: COURSE_ID,
      semesterId: SEMESTER_ID,
    });

    const assign = rules.components.find((entry) => entry.code === "ASSN");
    assert.equal(assign?.weightage, 50);
    assert.equal(assign?.evidenceSignal, "assignment");
  });

  it("lists components that map to no observable signal", async () => {
    // A VIVA has no table to read; surfacing it explains a low confidence.
    const { service } = makeHarness({
      scheme: {
        ...DEFAULT_SCHEME,
        components: [
          ...DEFAULT_SCHEME.components,
          component({ id: "c_viva", code: "VIVA", type: EvaluationComponentType.VIVA }),
        ],
      },
    });

    const rules = await service.getRules(TENANT_ID, {
      courseId: COURSE_ID,
      semesterId: SEMESTER_ID,
    });

    assert.ok(rules.unmappedComponents.includes("VIVA"));
  });

  it("404s when no ACTIVE scheme governs the course-semester", async () => {
    const { service } = makeHarness({ scheme: null });

    await assert.rejects(
      () => service.getRules(TENANT_ID, { courseId: COURSE_ID, semesterId: SEMESTER_ID }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});

// ============================================================================
// Head of department — department confinement.
//
// INTERNAL_ASSESSMENT_ROLES admits BOTH spellings of head of department, and
// this is the one examination surface where a head holds WRITE authority:
// generate proposes internal marks and decide accepts or overrides them.
// Unnarrowed, a head did both for any course in the university simply by
// submitting another department's courseId.
// ============================================================================

describe("InternalAssessmentService — head of department confinement", () => {
  const generateInput = {
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    componentId: TARGET_ID,
    withRationale: false,
  };

  const decideInput = {
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    componentId: TARGET_ID,
    finalMarks: 30,
  };

  async function expectNotFound(run: () => Promise<unknown>): Promise<void> {
    await assert.rejects(run, (err: unknown) => {
      assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
      assert.equal(
        err.statusCode,
        404,
        "the refusal must not disclose that the course or student exists elsewhere"
      );
      return true;
    });
  }

  // --- WRITE: generate ------------------------------------------------------

  it("lets a head GENERATE for a course in their own department", async () => {
    const { service, calls } = makeHarness({ departmentOwnsCourse: true });

    await service.generate(TENANT_ID, generateInput, HEAD_CONTEXT, NOW);

    assert.ok(calls.upserts.length > 0, "the write should have happened");
  });

  it("REFUSES a head GENERATING for another department's courseId", async () => {
    // The manipulated-id case, on a write.
    const { service, calls } = makeHarness({ departmentOwnsCourse: false });

    await expectNotFound(() => service.generate(TENANT_ID, generateInput, HEAD_CONTEXT, NOW));

    assert.equal(calls.upserts.length, 0, "nothing may be written");
    assert.equal(calls.transactions, 0, "the refusal must precede any transaction");
  });

  // --- WRITE: decide --------------------------------------------------------

  it("lets a head DECIDE a mark in their own department", async () => {
    const { service } = makeHarness({ departmentOwnsCourse: true });

    const result = await service.decide(
      TENANT_ID,
      STUDENT_ID,
      decideInput,
      HEAD_CONTEXT,
      NOW
    );

    assert.equal(result.studentId, STUDENT_ID);
  });

  it("REFUSES a head DECIDING a mark for another department's courseId", async () => {
    const { service, calls } = makeHarness({ departmentOwnsCourse: false });

    await expectNotFound(() =>
      service.decide(TENANT_ID, STUDENT_ID, decideInput, HEAD_CONTEXT, NOW)
    );

    assert.equal(calls.audits.length, 0, "no decision may be recorded");
  });

  it("checks the department BEFORE looking the suggestion up", async () => {
    // Otherwise a head learns whether a suggestion exists for another
    // department's course from which error comes back.
    const { service, calls } = makeHarness({
      departmentOwnsCourse: false,
      existingSuggestion: null,
    });

    await expectNotFound(() =>
      service.decide(TENANT_ID, STUDENT_ID, decideInput, HEAD_CONTEXT, NOW)
    );

    assert.equal(calls.departmentChecks, 1);
  });

  // --- READ -----------------------------------------------------------------

  it("REFUSES a head reading RULES for another department's course", async () => {
    const { service } = makeHarness({ departmentOwnsCourse: false });

    await expectNotFound(() =>
      service.getRules(
        TENANT_ID,
        { courseId: COURSE_ID, semesterId: SEMESTER_ID },
        DEPARTMENT_ID
      )
    );
  });

  it("confines the per-student reads by the STUDENT, not the course filter", async () => {
    // courseId is OPTIONAL on these queries. Confining by an absent filter
    // would confine nothing, so the path is Student -> Programme -> Department.
    const { service } = makeHarness({ departmentOwnsStudent: false });

    await expectNotFound(() =>
      service.getForStudent(TENANT_ID, STUDENT_ID, {}, DEPARTMENT_ID)
    );

    const audit = makeHarness({ departmentOwnsStudent: false });
    await expectNotFound(() =>
      audit.service.getAudit(TENANT_ID, STUDENT_ID, {}, DEPARTMENT_ID)
    );
  });

  it("serves the per-student reads for a student in the head's department", async () => {
    const { service } = makeHarness({ departmentOwnsStudent: true });

    const rows = await service.getForStudent(TENANT_ID, STUDENT_ID, {}, DEPARTMENT_ID);

    assert.ok(Array.isArray(rows));
  });

  // --- An unnarrowed caller pays nothing ------------------------------------

  it("does not ask about the department for an unnarrowed caller", async () => {
    const { service, calls } = makeHarness();

    await service.generate(TENANT_ID, generateInput, CONTEXT, NOW);
    await service.getForStudent(TENANT_ID, STUDENT_ID, {});

    assert.equal(
      calls.departmentChecks,
      0,
      "UNIVERSITY_ADMIN and FACULTY must not pay for a check that cannot apply"
    );
  });
});

// ============================================================================
// OWNER      : Gauransh
// MODULE     : Result Reporting
// LAYER      : Repository
// PURPOSE    : Read every fact the four result endpoints need, in a fixed
//              number of statements.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No calculation, no grade resolution, no GPA, no DTO mapping, no policy.
//     Every number these endpoints return is computed by the Result Engine from
//     what this file reads.
//
// THE QUERY BUDGET IS THE WHOLE DESIGN
//   A student's record, however many semesters and courses it spans, costs a
//   FIXED number of statements — one lookup to resolve the subject, then:
//
//     1  registrations          (one IN over the student)
//     2  evaluation schemes     (one IN over every scheme those cite)
//     3  grade bands            (one IN over every scale those cite)
//     4  components             (one IN over the schemes)
//     5  rules                  (one IN over the schemes)
//     6  passing criteria       (one IN over the schemes)
//     7  marks                  (one IN over the registrations)
//
//   Seven. Not seven per course and not seven per semester. A cohort of a
//   thousand students costs the same seven, because the set-based reads widen
//   rather than repeat. There is deliberately NO findByRegistration and no
//   per-student config read — either would be an N+1 waiting to be written by
//   the next person.
//
// TENANCY: every query is anchored on tenantId. Marks additionally travel
//          through their registration, which carries its own tenant column, so
//          a mis-tenanted row cannot surface through the join.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { RegistrationStatus } from "@/app/generated/prisma/enums";

/** Registration columns the engine needs. Declared once so every read agrees. */
export const RESULT_REGISTRATION_SELECT = {
  id: true,
  studentId: true,
  courseId: true,
  semesterId: true,
  sectionId: true,
  programmeId: true,
  evaluationSchemeId: true,
  credits: true,
  registrationType: true,
  attemptNumber: true,
  status: true,
  course: { select: { id: true, code: true, name: true } },
  semester: { select: { id: true, name: true, startDate: true } },
} as const;

/**
 * Registration states whose results are reportable.
 *
 * DROPPED and CANCELLED registrations are excluded at the QUERY, not filtered
 * afterwards: a dropped course was never sat, and letting it reach the engine
 * would put an unearned zero into a credit total. WITHDRAWN is excluded for the
 * same reason — a withdrawal is not a failure and must not divide a GPA.
 */
export const REPORTABLE_REGISTRATION_STATUSES = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.CONFIRMED,
  RegistrationStatus.COMPLETED,
] as const;

/**
 * Ordering for a student's registrations.
 *
 * By semester start date then course code. Exported as a constant so a test can
 * assert it without a database — the same technique C6.1 uses for its list
 * ordering, and for the same reason: an ordering is a contract.
 */
export const RESULT_REGISTRATION_ORDER_BY = [
  { semester: { startDate: "asc" } },
  { course: { code: "asc" } },
] as const;

export class ResultRepository {
  /**
   * Resolve a student by id, tenant-scoped.
   *
   * Returns null for an unknown id and for one owned by another tenant alike,
   * so no id is ever confirmed to exist elsewhere.
   */
  async findStudent(tenantId: string, studentId: string) {
    return prisma.student.findFirst({
      where: { id: studentId, tenantId },
      // programmeId is selected for the DEPARTMENT confinement in
      // ResultService.requireStudent, which needs to know whose programme this
      // student sits in before a head of department may read the record.
      select: { id: true, userId: true, enrollmentNo: true, programmeId: true },
    });
  }

  /**
   * Does this department own this programme?
   *
   * The question a DEPARTMENT-scoped result read reduces to. It is asked of
   * Programme rather than of Student because Student.programmeId is a plain
   * scalar with no relation to Programme in this schema, so the join cannot be
   * expressed in the Student query and has to be a second, indexed read.
   *
   * tenantId is part of the predicate as well as departmentId: a department id
   * is opaque, and pairing the two means even a wrong one cannot reach another
   * institution's programmes.
   */
  async departmentOwnsProgramme(
    tenantId: string,
    departmentId: string,
    programmeId: string
  ): Promise<boolean> {
    const programme = await prisma.programme.findFirst({
      where: { id: programmeId, tenantId, departmentId },
      select: { id: true },
    });

    return programme !== null;
  }

  /**
   * Resolve the student a signed-in user IS.
   *
   * The direction matters: a STUDENT caller's own record is found from their
   * user id, never from the path parameter. The parameter is only ever compared
   * against the answer, so the endpoint discloses nothing about ids it rejects.
   */
  async findStudentByUserId(tenantId: string, userId: string) {
    return prisma.student.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
  }

  /** Resolve a semester by id, tenant-scoped. */
  async findSemester(tenantId: string, semesterId: string) {
    return prisma.semester.findFirst({
      where: { id: semesterId, tenantId },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
  }

  /**
   * Every reportable registration for one student.
   *
   * Index-backed: CourseRegistration is unique on (studentId, courseId,
   * attemptNumber), so studentId is a leading column and the tenant predicate
   * narrows within it. `semesterId` is optional — absent, this is the whole
   * academic record a transcript and a CGPA need.
   */
  async findRegistrationsForStudent(
    tenantId: string,
    studentId: string,
    semesterId?: string
  ) {
    return prisma.courseRegistration.findMany({
      where: {
        tenantId,
        studentId,
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
        ...(semesterId === undefined ? {} : { semesterId }),
      },
      select: RESULT_REGISTRATION_SELECT,
      orderBy: [...RESULT_REGISTRATION_ORDER_BY],
    });
  }

  /**
   * Every reportable registration in one semester, for every student.
   *
   * Index-backed by @@index([tenantId, semesterId, courseId]) — the exact shape
   * of this predicate. One statement for the whole cohort.
   */
  async findRegistrationsForSemester(tenantId: string, semesterId: string) {
    return prisma.courseRegistration.findMany({
      where: {
        tenantId,
        semesterId,
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
      },
      select: RESULT_REGISTRATION_SELECT,
      orderBy: [{ studentId: "asc" }, { course: { code: "asc" } }],
    });
  }

  /**
   * The regulations a set of registrations cite, with their grade scales.
   *
   * The scale and its ceiling travel with the scheme because the engine needs
   * both to validate a band table, and reading them separately would be a
   * second statement for data that is always wanted together.
   */
  async findSchemes(tenantId: string, schemeIds: readonly string[]) {
    if (schemeIds.length === 0) {
      return [];
    }

    return prisma.evaluationScheme.findMany({
      where: { tenantId, id: { in: [...schemeIds] } },
      select: {
        id: true,
        code: true,
        version: true,
        gradeScaleId: true,
        attemptPolicy: true,
        marksRounding: true,
        marksPrecision: true,
        gpaRounding: true,
        gpaPrecision: true,
        gradeScale: {
          select: { id: true, method: true, methodConfig: true, maxGradePoint: true },
        },
      },
    });
  }

  /** Every band of every scale those regulations use. One statement. */
  async findGradeBands(tenantId: string, gradeScaleIds: readonly string[]) {
    if (gradeScaleIds.length === 0) {
      return [];
    }

    return prisma.gradeBand.findMany({
      where: { tenantId, gradeScaleId: { in: [...gradeScaleIds] } },
      select: {
        gradeScaleId: true,
        grade: true,
        label: true,
        minPercent: true,
        maxPercent: true,
        gradePoint: true,
        isPass: true,
        countsForGpa: true,
        sequence: true,
      },
      orderBy: { sequence: "asc" },
    });
  }

  /** Every component of those regulations. One statement. */
  async findComponents(tenantId: string, schemeIds: readonly string[]) {
    if (schemeIds.length === 0) {
      return [];
    }

    return prisma.evaluationComponent.findMany({
      where: { tenantId, schemeId: { in: [...schemeIds] } },
      select: {
        id: true,
        schemeId: true,
        parentComponentId: true,
        code: true,
        sequence: true,
        maxMarks: true,
        weightage: true,
        aggregation: true,
        rollup: true,
        sourceType: true,
        isMandatory: true,
        ruleConfig: true,
      },
      orderBy: { sequence: "asc" },
    });
  }

  /**
   * Every rule of those regulations, IN EXECUTION ORDER.
   *
   * Ordered by (phase, sequence, code) here rather than in the engine. RulePhase
   * is declared in pipeline order and PostgreSQL orders an enum by declaration,
   * so this ordering IS the execution order — and the engine deliberately never
   * re-sorts, because re-deriving it would be a second opinion about something
   * the schema already settles.
   */
  async findRules(tenantId: string, schemeIds: readonly string[]) {
    if (schemeIds.length === 0) {
      return [];
    }

    return prisma.evaluationRule.findMany({
      where: { tenantId, schemeId: { in: [...schemeIds] } },
      select: {
        id: true,
        schemeId: true,
        componentId: true,
        code: true,
        phase: true,
        operation: true,
        sequence: true,
        config: true,
        condition: true,
      },
      orderBy: [{ phase: "asc" }, { sequence: "asc" }, { code: "asc" }],
    });
  }

  /** Every passing criterion of those regulations. One statement. */
  async findCriteria(tenantId: string, schemeIds: readonly string[]) {
    if (schemeIds.length === 0) {
      return [];
    }

    return prisma.passingCriterion.findMany({
      where: { tenantId, schemeId: { in: [...schemeIds] } },
      select: {
        id: true,
        schemeId: true,
        componentId: true,
        code: true,
        metric: true,
        threshold: true,
        unit: true,
        failureOutcome: true,
      },
    });
  }

  /**
   * Every mark for a set of registrations, with the sitting that produced it.
   *
   * Index-backed by @@index([tenantId, courseRegistrationId]) — the exact shape
   * of this predicate. The sitting travels with the mark because the engine
   * needs its component, its own maximum and its sequence number, and fetching
   * events separately would be a second statement plus a join done in
   * application memory.
   *
   * The sitting's STATUS travels too, so the service can decide whether a
   * result is publishable without a further read.
   */
  async findMarks(tenantId: string, registrationIds: readonly string[]) {
    if (registrationIds.length === 0) {
      return [];
    }

    return prisma.studentComponentScore.findMany({
      where: { tenantId, courseRegistrationId: { in: [...registrationIds] } },
      select: {
        courseRegistrationId: true,
        marksObtained: true,
        status: true,
        assessmentEvent: {
          select: {
            id: true,
            evaluationComponentId: true,
            maxMarks: true,
            sequenceNumber: true,
            status: true,
          },
        },
      },
    });
  }
}

export const resultRepository = new ResultRepository();

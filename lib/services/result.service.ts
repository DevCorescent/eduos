// ============================================================================
// OWNER      : Gauransh
// MODULE     : Result Reporting
// LAYER      : Service
// PURPOSE    : Own the whole result pipeline — load, convert, compute, map.
// ARCHITECTURE:
//   • Service owns ALL orchestration and every conversion.
//   • Repository reads; the Result Engine computes; this layer joins them and
//     builds the DTOs. No calculation is written here — every figure comes from
//     C7.1, so a dashboard and a transcript cannot disagree.
//
// THE ONE LOADER
//   All four endpoints go through `loadConfiguration`, which turns a set of
//   scheme ids into prepared schemes in a FIXED number of statements and
//   prepares each scheme exactly ONCE. A thousand-student cohort shares one
//   prepared tree, one indexed rule set and one validated band table. Preparing
//   per student would be a thousand identical computations, and doing the reads
//   per student would be the N+1 this design exists to prevent.
//
// RESULTS ARE COMPUTED, NOT STORED — AND THAT IS THE REPRODUCIBILITY GUARANTEE
//   Phase 16 was built so a historical result can be reproduced forever:
//   CourseRegistration snapshots the credits and the governing regulation, an
//   ACTIVE scheme is immutable, and marks are stored. Recomputing from those
//   inputs yields the same answer every time. A stored result table would be a
//   CACHE of that, not a source of truth, and the day the two disagreed nobody
//   could say which was right.
//
//   Publication is likewise derived rather than duplicated: AssessmentEvent
//   already carries DRAFT → OPEN → LOCKED → PUBLISHED and C6.1 governs it, so a
//   result is published exactly when every sitting that fed it is.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE } from "@/lib/constants/errors";
import {
  MAX_COHORT_SIZE,
  MAX_STUDENT_COURSES,
  PUBLISHED_EVENT_STATUS,
  RESULT_MESSAGE,
} from "@/lib/constants/result";
import { GPA_SCALE, MARK_SCALE } from "@/lib/constants/resultEngine";
import type { ResultRepository } from "@/lib/repositories/result.repository";
import { formatScaled, toScaled } from "@/lib/domain/result-engine/decimal";
import {
  COURSE_OUTCOME,
  GradeCalculationMethod,
  type CourseOutcome,
} from "@/lib/domain/result-engine/enums";
import {
  batchFailures,
  batchResults,
  processCohort,
  processStudent,
  type BatchCourseInput,
  type BatchStudentInput,
  type BatchStudentResult,
} from "@/lib/domain/result-engine/batch";
import {
  calculateStudent,
  prepareScheme,
  type PreparedScheme,
} from "@/lib/domain/result-engine/calculator";
import {
  buildMeritList,
  componentBreakdown,
  creditPosition,
  gradeDistribution,
  semesterTrend,
  summariseCohort,
  trendDelta,
  type CohortMember,
} from "@/lib/domain/result-engine/analytics";
import { RANK_SCOPE } from "@/lib/domain/result-engine/ranking";
import type {
  AssessmentValue,
  ComponentDefinition,
  CourseResultValue,
  CriterionDefinition,
  GradeBandDefinition,
  RoundingPolicy,
  RuleDefinition,
  Scaled,
} from "@/lib/domain/result-engine/types";
import type {
  AcademicStandingDTO,
  BacklogDTO,
  CohortStudentDTO,
  ComponentBreakdownDTO,
  CourseResultDTO,
  CreditPositionDTO,
  GpaDTO,
  ImprovementDTO,
  SemesterCohortResultDTO,
  SemesterResultDTO,
  StudentAnalyticsDTO,
  StudentResultDTO,
  TranscriptDTO,
  TranscriptLineDTO,
} from "@/lib/dto/result.dto";
import type { AttemptPolicy } from "@/app/generated/prisma/enums";

type Registration = Awaited<
  ReturnType<ResultRepository["findRegistrationsForStudent"]>
>[number];
type Mark = Awaited<ReturnType<ResultRepository["findMarks"]>>[number];

/**
 * How much of the tenant the caller may read.
 *
 * Decided by the ROUTE, which is the layer that ran the role guards, and
 * applied HERE, which is the layer that touches the data. The split mirrors
 * C6.2's MarkUploadAuthority for the same reason: deciding who holds which
 * authority needs the session, and enforcing it needs the repository, and
 * neither layer should do the other's job.
 *
 * ANY        — an examination-office caller, reading any student in the tenant.
 * DEPARTMENT — a head of department, confined to students whose programme
 *              belongs to the department they head. The id is resolved from the
 *              authenticated subject in requireResultAccess, never from the
 *              request, so nothing a caller can edit reaches this type.
 * OWN        — a student, confined to the record their own user account
 *              resolves to.
 */
export type ResultAccess =
  | { readonly scope: "ANY" }
  | { readonly scope: "DEPARTMENT"; readonly departmentId: string }
  | { readonly scope: "OWN"; readonly userId: string };

/** Every regulation a request touches, prepared once. */
interface LoadedConfiguration {
  readonly schemes: ReadonlyMap<string, PreparedScheme>;
  readonly attemptPolicies: ReadonlyMap<string, AttemptPolicy>;
  readonly warnings: readonly string[];
}

export class ResultService {
  constructor(private readonly repository: ResultRepository) {}

  // --- GET /api/results/student/[studentId] ---------------------------------

  async getStudentResult(
    tenantId: string,
    studentId: string,
    access: ResultAccess,
    semesterId?: string
  ): Promise<StudentResultDTO> {
    const student = await this.requireStudent(tenantId, studentId, access);
    const registrations = await this.repository.findRegistrationsForStudent(
      tenantId,
      studentId,
      semesterId
    );

    this.assertCourseCount(registrations.length);

    const config = await this.loadConfiguration(tenantId, registrations);
    const marks = await this.loadMarks(tenantId, registrations);
    const computed = this.computeStudent(registrations, marks, config);

    return {
      studentId: student.id,
      enrollmentNo: student.enrollmentNo,
      semesters: computed.semesters,
      cgpa: computed.cgpa,
      credits: computed.credits,
      standing: computed.standing,
      warnings: [...config.warnings, ...computed.warnings],
    };
  }

  // --- GET /api/results/transcript/[studentId] -------------------------------

  async getTranscript(tenantId: string, studentId: string, access: ResultAccess): Promise<TranscriptDTO> {
    const student = await this.requireStudent(tenantId, studentId, access);
    const registrations = await this.repository.findRegistrationsForStudent(
      tenantId,
      studentId
    );

    this.assertCourseCount(registrations.length);

    const config = await this.loadConfiguration(tenantId, registrations);
    const marks = await this.loadMarks(tenantId, registrations);
    const computed = this.computeStudent(registrations, marks, config);

    const lines: TranscriptLineDTO[] = computed.semesters.map((semester, index) => ({
      semesterId: semester.semesterId,
      semesterName: semester.semesterName,
      creditsRegistered: semester.credits.registered,
      creditsEarned: semester.credits.earned,
      sgpa: semester.sgpa.value,
      cgpa: computed.runningCgpa[index] ?? null,
      backlogCount: semester.backlogCount,
      courses: semester.courses.map((course) => ({
        courseCode: course.courseCode,
        courseName: course.courseName,
        credits: course.credits,
        grade: course.grade,
        gradePoint: course.gradePoint,
        attemptNumber: course.attemptNumber,
        outcome: course.outcome,
      })),
    }));

    const isProvisional = computed.semesters.some((semester) => semester.isProvisional);

    return {
      studentId: student.id,
      enrollmentNo: student.enrollmentNo,
      lines,
      degreeSummary: {
        creditsRegistered: computed.credits.registered,
        creditsEarned: computed.credits.earned,
        cgpa: computed.cgpa.value,
        classification: computed.standing.classification,
        semestersCompleted: computed.semesters.filter((s) => s.backlogCount === 0).length,
      },
      standing: computed.standing,
      isProvisional,
    };
  }

  // --- GET /api/results/analytics/[studentId] --------------------------------

  async getAnalytics(tenantId: string, studentId: string, access: ResultAccess): Promise<StudentAnalyticsDTO> {
    const student = await this.requireStudent(tenantId, studentId, access);
    const registrations = await this.repository.findRegistrationsForStudent(
      tenantId,
      studentId
    );

    this.assertCourseCount(registrations.length);

    const config = await this.loadConfiguration(tenantId, registrations);
    const marks = await this.loadMarks(tenantId, registrations);
    const computed = this.computeStudent(registrations, marks, config);
    const policy = this.policyFor(registrations, config);

    const trend = semesterTrend(computed.transcriptRows);
    const delta = trendDelta(trend);

    const breakdown: ComponentBreakdownDTO[] = componentBreakdown(
      computed.courseValues,
      policy
    ).map((row) => ({
      code: row.code,
      achieved: formatScaled(row.achievedScaled, MARK_SCALE),
      maxMarks: formatScaled(row.maxScaled, MARK_SCALE),
      percent: row.percentScaled === null ? null : formatScaled(row.percentScaled, MARK_SCALE),
      courseCount: row.courseCount,
    }));

    return {
      studentId: student.id,
      enrollmentNo: student.enrollmentNo,
      performanceTrend: trend.map((point, index) => ({
        semesterId: point.semesterId,
        semesterName: computed.semesters[index]?.semesterName ?? point.semesterId,
        sgpa: point.sgpaScaled === null ? null : formatScaled(point.sgpaScaled, GPA_SCALE),
        cgpa: point.cgpaScaled === null ? null : formatScaled(point.cgpaScaled, GPA_SCALE),
        creditsEarned: formatScaled(point.creditsEarnedScaled, MARK_SCALE),
        backlogCount: point.backlogCount,
      })),
      trendDelta: delta === null ? null : formatScaled(delta, GPA_SCALE),
      componentBreakdown: breakdown,
      credits: computed.credits,
      standing: computed.standing,
      backlogs: computed.backlogs,
      improvementHistory: computed.improvements,
      // Populated only when a cohort was computed alongside. A rank read from a
      // single student's record would be a rank of one, which is not a rank.
      rankHistory: [],
    };
  }

  // --- GET /api/results/semester/[semesterId] --------------------------------

  async getSemesterResult(
    tenantId: string,
    semesterId: string
  ): Promise<SemesterCohortResultDTO> {
    const semester = await this.repository.findSemester(tenantId, semesterId);

    if (semester === null) {
      throw new AppError(RESULT_MESSAGE.SEMESTER_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    const registrations = await this.repository.findRegistrationsForSemester(
      tenantId,
      semesterId
    );

    const studentIds = new Set(registrations.map((row) => row.studentId));

    if (studentIds.size > MAX_COHORT_SIZE) {
      throw new AppError(RESULT_MESSAGE.COHORT_TOO_LARGE, 422, ERROR_CODE.VALIDATION);
    }

    const config = await this.loadConfiguration(tenantId, registrations);
    const marks = await this.loadMarks(tenantId, registrations);
    const policy = this.policyFor(registrations, config);

    // Grouped ONCE into per-student batches; the engine then computes each
    // independently against the shared prepared schemes.
    const byStudent = new Map<string, Registration[]>();

    for (const registration of registrations) {
      const held = byStudent.get(registration.studentId);

      if (held === undefined) {
        byStudent.set(registration.studentId, [registration]);
      } else {
        held.push(registration);
      }
    }

    const inputs: BatchStudentInput[] = [];

    for (const [studentId, rows] of byStudent) {
      inputs.push({
        studentId,
        semesterId,
        courses: rows.map((row) => this.toBatchCourse(row, marks)),
      });
    }

    const outcome = processCohort(config.schemes, inputs, policy);
    const results = batchResults(outcome);

    const enrollments = new Map<string, string>();
    const members: CohortMember[] = [];
    const courseGradeMembers: CohortMember[] = [];
    const students: CohortStudentDTO[] = [];

    for (const result of results) {
      const member = this.toCohortMember(result);

      members.push(member);

      // One entry per COURSE, for the grade distribution.
      for (const course of result.semester.result.courses) {
        courseGradeMembers.push({
          studentId: `${result.studentId}:${course.courseRegistrationId}`,
          percentageScaled: course.percentageScaled,
          sgpaScaled: null,
          grade: course.grade?.grade ?? null,
          outcome: course.outcome,
          creditsEarnedScaled: course.creditsEarnedScaled,
        });
      }
      students.push({
        studentId: result.studentId,
        enrollmentNo: enrollments.get(result.studentId) ?? result.studentId,
        sgpa: this.formatGpa(result.semester.result.sgpa.valueScaled),
        percentage:
          member.percentageScaled === null
            ? null
            : formatScaled(member.percentageScaled, MARK_SCALE),
        creditsEarned: formatScaled(result.semester.credits.creditsEarnedScaled, MARK_SCALE),
        backlogCount: result.semester.result.backlogCount,
        isPromoted: result.semester.result.isPromoted,
        rank: null,
      });
    }

    const merit = buildMeritList(members, RANK_SCOPE.CLASS);
    const rankBySubject = new Map(merit.ranked.map((entry) => [entry.subjectId, entry]));
    const statistics = summariseCohort(members, policy);

    return {
      semesterId: semester.id,
      semesterName: semester.name,
      students: students.map((student) => ({
        ...student,
        rank: rankBySubject.get(student.studentId)?.rank ?? null,
      })),
      statistics: {
        total: statistics.total,
        evaluated: statistics.evaluated,
        passed: statistics.passed,
        failed: statistics.failed,
        pending: statistics.pending,
        passPercent: this.formatMarkOrNull(statistics.passPercentScaled),
        failPercent: this.formatMarkOrNull(statistics.failPercentScaled),
        average: this.formatMarkOrNull(statistics.averageScaled),
        median: this.formatMarkOrNull(statistics.medianScaled),
        highest: this.formatMarkOrNull(statistics.highestScaled),
        lowest: this.formatMarkOrNull(statistics.lowestScaled),
      },
      // Distributed over COURSE grades, not student grades. A semester's grade
      // distribution answers "how many A's were awarded", and a student taking
      // six courses holds six grades rather than one — collapsing them to a
      // single letter per student would discard five sixths of the data and
      // report a distribution no examiner would recognise.
      gradeDistribution: gradeDistribution(courseGradeMembers, policy).map((row) => ({
        grade: row.grade,
        count: row.count,
        percent: formatScaled(row.percentScaled, MARK_SCALE),
      })),
      meritList: merit.ranked.map((entry) => ({
        studentId: entry.subjectId,
        enrollmentNo: enrollments.get(entry.subjectId) ?? entry.subjectId,
        rank: entry.rank,
        outOf: entry.outOf,
        isTied: entry.isTied,
        sgpa: this.formatGpa(entry.valueScaled),
      })),
      // A student the engine could not compute is reported, never dropped.
      failures: batchFailures(outcome).map(
        (failure) => `${failure.subject ?? "unknown"}: ${failure.message}`
      ),
    };
  }

  // --- Loading --------------------------------------------------------------

  /**
   * Resolve the student this caller is permitted to read.
   *
   * For an ELEVATED caller the student is resolved tenant-scoped by the
   * requested id; an unknown id and one owned by another tenant return the
   * identical 404, so no id is ever confirmed to exist elsewhere.
   *
   * For a STUDENT the direction is REVERSED: their own record is resolved from
   * their user id, and the requested id is only ever COMPARED against it. The
   * path parameter is never used to look anything up for them, so a student
   * asking for any id but their own receives 403 whether that id exists,
   * belongs to another tenant, or exists nowhere at all — the endpoint
   * discloses no student's existence to a student. The 403 strictly precedes
   * the 404, which is what makes that guarantee hold.
   *
   * A caller holding STUDENT with no Student row in this tenant is forbidden
   * rather than served an empty record.
   */
  private async requireStudent(
    tenantId: string,
    studentId: string,
    access: ResultAccess
  ) {
    if (access.scope === "OWN") {
      const own = await this.repository.findStudentByUserId(tenantId, access.userId);

      if (own === null || own.id !== studentId) {
        throw new AppError(RESULT_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
      }
    }

    const student = await this.repository.findStudent(tenantId, studentId);

    if (student === null) {
      throw new AppError(RESULT_MESSAGE.STUDENT_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    // A head of department reads their own department's students and no others.
    // The check runs AFTER the 404 rather than before it, so a head asking for
    // an id that does not exist and one that belongs to another department get
    // different answers only where the student is real — and 403 there is the
    // honest answer: the record exists and is not theirs to read.
    //
    // A student with no programme is refused rather than admitted. An unowned
    // record cannot be shown to belong to this department, and "unknown" must
    // not read as "permitted" here any more than an unassigned head reads as
    // unrestricted in decideDepartmentScope.
    if (access.scope === "DEPARTMENT") {
      const owned =
        student.programmeId !== null &&
        (await this.repository.departmentOwnsProgramme(
          tenantId,
          access.departmentId,
          student.programmeId
        ));

      if (!owned) {
        throw new AppError(RESULT_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
      }
    }

    return student;
  }

  private assertCourseCount(count: number): void {
    if (count > MAX_STUDENT_COURSES) {
      throw new AppError(RESULT_MESSAGE.TOO_MANY_COURSES, 422, ERROR_CODE.VALIDATION);
    }
  }

  /**
   * Load and prepare every regulation a set of registrations cites.
   *
   * Six statements regardless of how many registrations, how many students or
   * how many semesters are involved. Each scheme is prepared exactly once.
   */
  private async loadConfiguration(
    tenantId: string,
    registrations: readonly Registration[]
  ): Promise<LoadedConfiguration> {
    const schemeIds = [...new Set(registrations.map((row) => row.evaluationSchemeId))];

    if (schemeIds.length === 0) {
      return { schemes: new Map(), attemptPolicies: new Map(), warnings: [] };
    }

    const schemeRows = await this.repository.findSchemes(tenantId, schemeIds);
    const scaleIds = [...new Set(schemeRows.map((row) => row.gradeScaleId))];

    const [bandRows, componentRows, ruleRows, criterionRows] = await Promise.all([
      this.repository.findGradeBands(tenantId, scaleIds),
      this.repository.findComponents(tenantId, schemeIds),
      this.repository.findRules(tenantId, schemeIds),
      this.repository.findCriteria(tenantId, schemeIds),
    ]);

    const bandsByScale = groupBy(bandRows, (row) => row.gradeScaleId);
    const componentsByScheme = groupBy(componentRows, (row) => row.schemeId);
    const rulesByScheme = groupBy(ruleRows, (row) => row.schemeId);
    const criteriaByScheme = groupBy(criterionRows, (row) => row.schemeId);

    const schemes = new Map<string, PreparedScheme>();
    const attemptPolicies = new Map<string, AttemptPolicy>();
    const warnings: string[] = [];

    for (const scheme of schemeRows) {
      const policy: RoundingPolicy = {
        marksRounding: scheme.marksRounding,
        marksPrecision: scheme.marksPrecision,
        gpaRounding: scheme.gpaRounding,
        gpaPrecision: scheme.gpaPrecision,
      };

      const prepared = prepareScheme(
        {
          evaluationSchemeId: scheme.id,
          components: (componentsByScheme.get(scheme.id) ?? []).map(toComponentDefinition),
          rules: (rulesByScheme.get(scheme.id) ?? []).map(toRuleDefinition),
          criteria: (criteriaByScheme.get(scheme.id) ?? []).map(toCriterionDefinition),
          gradeBands: (bandsByScale.get(scheme.gradeScaleId) ?? []).map(toBandDefinition),
          policy,
          isRelativeGrading: scheme.gradeScale.method === GradeCalculationMethod.RELATIVE,
        },
        toScaled(scheme.gradeScale.maxGradePoint)
      );

      if (!prepared.ok) {
        // A broken regulation is reported, not thrown: every OTHER regulation
        // in the request still computes, and the students it governs still get
        // their results.
        warnings.push(
          `Regulation ${scheme.code} v${scheme.version} could not be prepared: ${prepared.failure.message}`
        );
        continue;
      }

      schemes.set(scheme.id, prepared.value);
      attemptPolicies.set(scheme.id, scheme.attemptPolicy);
    }

    return { schemes, attemptPolicies, warnings };
  }

  /** Every mark for a set of registrations. One statement. */
  private async loadMarks(
    tenantId: string,
    registrations: readonly Registration[]
  ): Promise<ReadonlyMap<string, Mark[]>> {
    const rows = await this.repository.findMarks(
      tenantId,
      registrations.map((row) => row.id)
    );

    return groupBy(rows, (row) => row.courseRegistrationId);
  }

  // --- Computation ----------------------------------------------------------

  /**
   * The rounding policy a cross-course figure is computed under.
   *
   * An SGPA is one number and needs ONE policy; rounding each term by its own
   * regulation would produce a figure no regulation authorises. The first
   * registration's scheme decides, which is deterministic because the
   * repository orders registrations by semester then course code — and in the
   * ordinary case every course in a semester shares one regulation, so the
   * choice is not a choice at all.
   */
  private policyFor(
    registrations: readonly Registration[],
    config: LoadedConfiguration
  ): RoundingPolicy {
    for (const registration of registrations) {
      const prepared = config.schemes.get(registration.evaluationSchemeId);

      if (prepared !== undefined) {
        return prepared.policy;
      }
    }

    return DEFAULT_POLICY;
  }

  private attemptPolicyFor(
    registrations: readonly Registration[],
    config: LoadedConfiguration
  ): AttemptPolicy {
    for (const registration of registrations) {
      const policy = config.attemptPolicies.get(registration.evaluationSchemeId);

      if (policy !== undefined) {
        return policy;
      }
    }

    return DEFAULT_ATTEMPT_POLICY;
  }

  /** Build the engine's view of one registration. */
  private toBatchCourse(
    registration: Registration,
    marks: ReadonlyMap<string, Mark[]>
  ): BatchCourseInput {
    return {
      courseId: registration.courseId,
      evaluationSchemeId: registration.evaluationSchemeId,
      attemptNumber: registration.attemptNumber,
      registrationType: registration.registrationType,
      calculation: {
        courseRegistrationId: registration.id,
        creditsScaled: toScaled(registration.credits),
        marks: (marks.get(registration.id) ?? []).map(toAssessmentValue),
        // Attendance is not joined here. A criterion reading it comes back as
        // unevaluated with a warning rather than failing a student on a figure
        // nobody supplied — see the deliverable notes.
        attendancePercentScaled: null,
      },
    };
  }

  /**
   * Compute one student's whole record.
   *
   * Registrations are grouped by semester ONCE, each semester computed once,
   * and the degree-level pass runs once over the result. Nothing is recomputed.
   */
  private computeStudent(
    registrations: readonly Registration[],
    marks: ReadonlyMap<string, Mark[]>,
    config: LoadedConfiguration
  ) {
    const policy = this.policyFor(registrations, config);
    const attemptPolicy = this.attemptPolicyFor(registrations, config);

    const bySemester = new Map<string, Registration[]>();

    for (const registration of registrations) {
      const held = bySemester.get(registration.semesterId);

      if (held === undefined) {
        bySemester.set(registration.semesterId, [registration]);
      } else {
        held.push(registration);
      }
    }

    const semesterNames = new Map(
      registrations.map((row) => [row.semesterId, row.semester.name])
    );
    const courseNames = new Map(
      registrations.map((row) => [row.id, row.course])
    );
    const registrationById = new Map(registrations.map((row) => [row.id, row]));

    const computations = [];
    const entriesBySemester = [];
    const warnings: string[] = [];
    const courseValues: CourseResultValue[] = [];

    for (const [semesterId, rows] of bySemester) {
      const outcome = processStudent(
        config.schemes,
        {
          studentId: rows[0].studentId,
          semesterId,
          courses: rows.map((row) => this.toBatchCourse(row, marks)),
        },
        policy
      );

      if (!outcome.ok) {
        warnings.push(`${semesterId}: ${outcome.failure.message}`);
        continue;
      }

      computations.push(outcome.value.semester);
      entriesBySemester.push(outcome.value.entries);
      warnings.push(...outcome.value.semester.warnings);
      courseValues.push(...outcome.value.semester.result.courses);
    }

    const bands = firstBands(config);
    const student = calculateStudent(
      registrations[0]?.studentId ?? "",
      computations,
      entriesBySemester,
      attemptPolicy,
      policy,
      bands
    );

    const semesters: SemesterResultDTO[] = computations.map((computation) => {
      const courses = computation.result.courses.map((course) =>
        this.toCourseDTO(course, registrationById, courseNames)
      );

      return {
        semesterId: computation.result.semesterId,
        semesterName: semesterNames.get(computation.result.semesterId) ?? "",
        courses,
        sgpa: toGpaDTO(computation.result.sgpa),
        credits: toCreditDTO(creditPosition(computation.result.courses)),
        backlogCount: computation.result.backlogCount,
        isPromoted: computation.result.isPromoted,
        isProvisional: computation.pendingOperations.length > 0,
        isPublished: this.isPublished(computation.result.courses, marks),
      };
    });

    return {
      semesters,
      cgpa: toGpaDTO(student.cgpa),
      credits: toCreditDTO(creditPosition(courseValues)),
      standing: toStandingDTO(student.standing),
      transcriptRows: student.transcript,
      runningCgpa: student.transcript.map((row) =>
        row.cgpaScaled === null ? null : formatScaled(row.cgpaScaled, GPA_SCALE)
      ),
      courseValues,
      backlogs: this.toBacklogs(courseValues, registrationById),
      improvements: this.toImprovements(courseValues, registrationById),
      warnings,
    };
  }

  /**
   * Whether every sitting behind a set of courses has been published.
   *
   * Derived from AssessmentEvent.status rather than from a second stored flag,
   * so publication has ONE definition and C6.1 remains the only thing that can
   * change it. A course with no marks at all is not published — there is
   * nothing to publish.
   */
  private isPublished(
    courses: readonly CourseResultValue[],
    marks: ReadonlyMap<string, Mark[]>
  ): boolean {
    if (courses.length === 0) {
      return false;
    }

    for (const course of courses) {
      const rows = marks.get(course.courseRegistrationId) ?? [];

      if (rows.length === 0) {
        return false;
      }

      for (const row of rows) {
        if (row.assessmentEvent.status !== PUBLISHED_EVENT_STATUS) {
          return false;
        }
      }
    }

    return true;
  }

  private toCourseDTO(
    course: CourseResultValue,
    registrations: ReadonlyMap<string, Registration>,
    courses: ReadonlyMap<string, Registration["course"]>
  ): CourseResultDTO {
    const registration = registrations.get(course.courseRegistrationId);
    const meta = courses.get(course.courseRegistrationId);

    return {
      courseRegistrationId: course.courseRegistrationId,
      courseId: meta?.id ?? "",
      courseCode: meta?.code ?? "",
      courseName: meta?.name ?? "",
      attemptNumber: registration?.attemptNumber ?? 1,
      registrationType: registration?.registrationType ?? "REGULAR",
      credits: formatScaled(course.creditsScaled, MARK_SCALE),
      creditsEarned: formatScaled(course.creditsEarnedScaled, MARK_SCALE),
      percentage: formatScaled(course.percentageScaled, MARK_SCALE),
      grade: course.grade?.grade ?? null,
      classification: course.grade?.label ?? null,
      gradePoint:
        course.grade === null ? null : formatScaled(course.grade.gradePointScaled, MARK_SCALE),
      isOverridden: course.grade?.isOverridden ?? false,
      outcome: course.outcome,
      isPass: course.outcome === COURSE_OUTCOME.PASS,
      components: course.components.map((component) => ({
        code: component.code,
        isLeaf: component.isLeaf,
        raw: formatScaled(component.rawScaled, MARK_SCALE),
        awarded: formatScaled(component.adjustedScaled, MARK_SCALE),
        maxMarks: formatScaled(component.maxMarksScaled, MARK_SCALE),
        contribution: formatScaled(component.contributionScaled, MARK_SCALE),
        sessionCount: component.sessionCount,
      })),
      failedCriteria: course.failedCriteria.map((failure) => ({
        code: failure.code,
        metric: failure.metric,
        threshold: formatScaled(failure.thresholdScaled, MARK_SCALE),
        actual: formatScaled(failure.actualScaled, MARK_SCALE),
        outcome: failure.outcome,
      })),
      pendingOperations: [...course.pendingCohortRules],
    };
  }

  /**
   * Every course that concluded without passing, and whether a later attempt
   * cleared it.
   *
   * "Cleared" is decided by looking for a PASS at the same course in any
   * attempt, which is why the whole record is loaded rather than one semester.
   */
  private toBacklogs(
    courses: readonly CourseResultValue[],
    registrations: ReadonlyMap<string, Registration>
  ): BacklogDTO[] {
    const passedCourses = new Set<string>();

    for (const course of courses) {
      if (course.outcome === COURSE_OUTCOME.PASS) {
        const registration = registrations.get(course.courseRegistrationId);

        if (registration !== undefined) {
          passedCourses.add(registration.courseId);
        }
      }
    }

    const backlogs: BacklogDTO[] = [];

    for (const course of courses) {
      if (
        course.outcome !== COURSE_OUTCOME.FAIL &&
        course.outcome !== COURSE_OUTCOME.INELIGIBLE
      ) {
        continue;
      }

      const registration = registrations.get(course.courseRegistrationId);

      if (registration === undefined) {
        continue;
      }

      backlogs.push({
        courseCode: registration.course.code,
        courseName: registration.course.name,
        semesterId: registration.semesterId,
        credits: formatScaled(course.creditsScaled, MARK_SCALE),
        attemptNumber: registration.attemptNumber,
        outcome: course.outcome,
        isCleared: passedCourses.has(registration.courseId),
      });
    }

    return backlogs;
  }

  /** Every attempt beyond the first, whatever became of it. */
  private toImprovements(
    courses: readonly CourseResultValue[],
    registrations: ReadonlyMap<string, Registration>
  ): ImprovementDTO[] {
    const improvements: ImprovementDTO[] = [];

    for (const course of courses) {
      const registration = registrations.get(course.courseRegistrationId);

      if (registration === undefined || registration.attemptNumber <= 1) {
        continue;
      }

      improvements.push({
        courseCode: registration.course.code,
        attemptNumber: registration.attemptNumber,
        registrationType: registration.registrationType,
        grade: course.grade?.grade ?? null,
        gradePoint:
          course.grade === null
            ? null
            : formatScaled(course.grade.gradePointScaled, MARK_SCALE),
        outcome: course.outcome,
      });
    }

    return improvements;
  }

  private toCohortMember(result: BatchStudentResult): CohortMember {
    const courses = result.semester.result.courses;
    let total = 0;
    let counted = 0;
    let worst: CourseOutcome = COURSE_OUTCOME.PASS;

    for (const course of courses) {
      if (
        course.outcome === COURSE_OUTCOME.WITHHELD ||
        course.outcome === COURSE_OUTCOME.INCOMPLETE
      ) {
        worst = course.outcome;
        continue;
      }

      if (course.outcome !== COURSE_OUTCOME.PASS && worst === COURSE_OUTCOME.PASS) {
        worst = COURSE_OUTCOME.FAIL;
      }

      total += course.percentageScaled;
      counted += 1;
    }

    return {
      studentId: result.studentId,
      percentageScaled: counted === 0 ? null : Math.round(total / counted),
      sgpaScaled: result.semester.result.sgpa.valueScaled,
      grade: null,
      outcome: worst,
      creditsEarnedScaled: result.semester.credits.creditsEarnedScaled,
    };
  }

  private formatGpa(value: Scaled | null): string | null {
    return value === null ? null : formatScaled(value, GPA_SCALE);
  }

  private formatMarkOrNull(value: Scaled | null): string | null {
    return value === null ? null : formatScaled(value, MARK_SCALE);
  }
}

// --- Conversion: Prisma rows to engine definitions --------------------------
//
// Every conversion lives HERE and nowhere else. Decimal becomes Scaled exactly
// once, at this boundary, so nothing downstream can convert it a second time or
// convert it differently.

type ComponentRow = Awaited<ReturnType<ResultRepository["findComponents"]>>[number];
type RuleRow = Awaited<ReturnType<ResultRepository["findRules"]>>[number];
type CriterionRow = Awaited<ReturnType<ResultRepository["findCriteria"]>>[number];
type BandRow = Awaited<ReturnType<ResultRepository["findGradeBands"]>>[number];

function toComponentDefinition(row: ComponentRow): ComponentDefinition {
  return {
    id: row.id,
    code: row.code,
    parentComponentId: row.parentComponentId,
    sequence: row.sequence,
    maxMarksScaled: toScaled(row.maxMarks),
    weightageScaled: toScaled(row.weightage),
    aggregation: row.aggregation,
    rollup: row.rollup,
    sourceType: row.sourceType,
    isMandatory: row.isMandatory,
    ruleConfig: row.ruleConfig,
  };
}

function toRuleDefinition(row: RuleRow): RuleDefinition {
  return {
    id: row.id,
    code: row.code,
    componentId: row.componentId,
    phase: row.phase,
    operation: row.operation,
    sequence: row.sequence,
    config: row.config,
    condition: row.condition,
  };
}

function toCriterionDefinition(row: CriterionRow): CriterionDefinition {
  return {
    id: row.id,
    code: row.code,
    componentId: row.componentId,
    metric: row.metric,
    thresholdScaled: toScaled(row.threshold),
    unit: row.unit,
    failureOutcome: row.failureOutcome,
  };
}

function toBandDefinition(row: BandRow): GradeBandDefinition {
  return {
    grade: row.grade,
    label: row.label,
    minPercentScaled: toScaled(row.minPercent),
    maxPercentScaled: toScaled(row.maxPercent),
    gradePointScaled: toScaled(row.gradePoint),
    isPass: row.isPass,
    countsForGpa: row.countsForGpa,
    sequence: row.sequence,
  };
}

function toAssessmentValue(row: Mark): AssessmentValue {
  return {
    componentId: row.assessmentEvent.evaluationComponentId,
    sequenceNumber: row.assessmentEvent.sequenceNumber,
    maxMarksScaled: toScaled(row.assessmentEvent.maxMarks),
    marksScaled: row.marksObtained === null ? null : toScaled(row.marksObtained),
    status: row.status,
  };
}

// --- Small shared helpers ---------------------------------------------------

/** Group rows by a key in ONE pass. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const id = key(row);
    const held = grouped.get(id);

    if (held === undefined) {
      grouped.set(id, [row]);
    } else {
      held.push(row);
    }
  }

  return grouped;
}

/** The band table a degree-level standing is read from. */
function firstBands(config: LoadedConfiguration) {
  for (const prepared of config.schemes.values()) {
    return prepared.bands;
  }

  return EMPTY_BANDS;
}

function toGpaDTO(gpa: {
  valueScaled: Scaled | null;
  creditsAttemptedScaled: Scaled;
  creditsEarnedScaled: Scaled;
  coursesCounted: number;
}): GpaDTO {
  return {
    value: gpa.valueScaled === null ? null : formatScaled(gpa.valueScaled, GPA_SCALE),
    creditsAttempted: formatScaled(gpa.creditsAttemptedScaled, MARK_SCALE),
    creditsEarned: formatScaled(gpa.creditsEarnedScaled, MARK_SCALE),
    coursesCounted: gpa.coursesCounted,
  };
}

function toCreditDTO(position: {
  registeredScaled: Scaled;
  earnedScaled: Scaled;
  pendingScaled: Scaled;
  failedScaled: Scaled;
}): CreditPositionDTO {
  return {
    registered: formatScaled(position.registeredScaled, MARK_SCALE),
    earned: formatScaled(position.earnedScaled, MARK_SCALE),
    pending: formatScaled(position.pendingScaled, MARK_SCALE),
    failed: formatScaled(position.failedScaled, MARK_SCALE),
  };
}

function toStandingDTO(standing: {
  cgpaScaled: Scaled | null;
  cgpaPercentScaled: Scaled | null;
  classification: string | null;
  grade: string | null;
  creditsEarnedScaled: Scaled;
  backlogCount: number;
  isClear: boolean;
}): AcademicStandingDTO {
  return {
    cgpa: standing.cgpaScaled === null ? null : formatScaled(standing.cgpaScaled, GPA_SCALE),
    cgpaPercent:
      standing.cgpaPercentScaled === null
        ? null
        : formatScaled(standing.cgpaPercentScaled, MARK_SCALE),
    classification: standing.classification,
    grade: standing.grade,
    creditsEarned: formatScaled(standing.creditsEarnedScaled, MARK_SCALE),
    backlogCount: standing.backlogCount,
    isClear: standing.isClear,
  };
}

/**
 * The policy used when a request touches no usable regulation at all.
 *
 * Reached only when every scheme failed to prepare, in which case there are no
 * results to round either — it exists so the code has no unreachable branch,
 * not because any regulation is assumed.
 */
const DEFAULT_POLICY: RoundingPolicy = {
  marksRounding: "HALF_UP",
  marksPrecision: MARK_SCALE,
  gpaRounding: "HALF_UP",
  gpaPrecision: MARK_SCALE,
};

const DEFAULT_ATTEMPT_POLICY: AttemptPolicy = "LATEST_ATTEMPT";

const EMPTY_BANDS = {
  bands: [] as readonly GradeBandDefinition[],
  passMarkScaled: null,
  failBand: null,
  maxGradePointScaled: 0,
};

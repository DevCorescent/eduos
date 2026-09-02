// ============================================================================
// OWNER      : Gauransh
// MODULE     : AI Assisted Internal Assessment (Phase 25)
// LAYER      : Repository
// PURPOSE    : Every read and write this module needs, and nothing that decides
//              anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • NO normalisation, NO blending, NO confidence arithmetic, NO override
//     rule. Every one of those is a decision and lives in the domain module or
//     the service. This file will tell you a student's attendance rows and
//     their graded submissions; it will never tell you what proportion they
//     represent.
//
// THE MARKING RULES COME FROM PHASE 16, READ HERE
//   `findActiveSchemeComponents` resolves the ACTIVE EvaluationScheme through
//   the course registrations for a course-semester — CourseRegistration pins
//   `evaluationSchemeId`, which is exactly the "which regulation applies"
//   question Phase 16 already answered. Nothing here re-answers it and no
//   parallel rules table exists.
//
// TENANT ISOLATION
//   Every query filters on tenantId. The evidence reads reach models owned by
//   Phases 9 and 10; AssignmentSubmission has no tenantId of its own (TD-A), so
//   that read anchors ownership through `assignment: { tenantId }`.
//
// THE QUERY BUDGET
//   findActiveSchemeComponents 1
//   findRegisteredStudents     1
//   findAttendanceTotals       1 (grouped, not per student)
//   findSubmissionTotals       1 (grouped, not per student)
//   findComponentScoreTotals   1 (grouped, not per student)
//   findPriorPerformance       1 (grouped, not per student)
//   upsertSuggestion           1 per student, inside the caller's transaction
//   Every evidence read is GROUPED ACROSS THE WHOLE COHORT, so generating for
//   three hundred students costs four reads rather than twelve hundred.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import {
  AttendanceStatus,
  EvaluationSchemeStatus,
  SubmissionStatus,
  type Prisma,
} from "@/app/generated/prisma/client";
import { REPORTABLE_REGISTRATION_STATUSES } from "@/lib/repositories/result.repository";
import { INTERNAL_ASSESSMENT_RESOURCE } from "@/lib/constants/internalAssessment";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** Attendance counts for one student. */
export interface AttendanceTotal {
  readonly studentId: string;
  readonly held: number;
  readonly attended: number;
}

/** Marks totals for one student over one kind of work. */
export interface MarksTotal {
  readonly studentId: string;
  readonly graded: number;
  readonly obtained: number;
  readonly available: number;
}

export class InternalAssessmentRepository {
  /**
   * The ACTIVE evaluation scheme governing a course-semester, with its
   * components.
   *
   * Resolved through CourseRegistration.evaluationSchemeId, which pins the
   * regulation a registration was made under. `distinct` on the scheme id keeps
   * this to one row per scheme rather than one per student.
   *
   * Returns null when nothing is registered or no ACTIVE scheme applies — which
   * the service turns into a 404 naming the situation, rather than proceeding
   * with no rules and inventing weights.
   *
   * COST: one statement.
   */
  async findActiveSchemeComponents(
    tenantId: string,
    courseId: string,
    semesterId: string,
    client: DbClient = prisma
  ) {
    const registration = await client.courseRegistration.findFirst({
      where: {
        tenantId,
        courseId,
        semesterId,
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
        evaluationScheme: { status: EvaluationSchemeStatus.ACTIVE },
      },
      select: {
        evaluationScheme: {
          select: {
            id: true,
            code: true,
            name: true,
            version: true,
            status: true,
            marksPrecision: true,
            components: {
              orderBy: [{ sequence: "asc" }, { id: "asc" }],
              select: {
                id: true,
                code: true,
                name: true,
                type: true,
                sourceType: true,
                maxMarks: true,
                weightage: true,
                parentComponentId: true,
                isMandatory: true,
              },
            },
          },
        },
      },
    });

    return registration?.evaluationScheme ?? null;
  }

  /**
   * Students registered for a course-semester, bounded.
   *
   * THE COHORT every generate call works over. Ordered by studentId so a
   * bounded run is deterministic — an unordered `take` would cover a different
   * arbitrary subset each time it was invoked.
   *
   * COST: one statement.
   */
  async findRegisteredStudents(
    tenantId: string,
    courseId: string,
    semesterId: string,
    studentIds: readonly string[] | undefined,
    limit: number,
    client: DbClient = prisma
  ) {
    return client.courseRegistration.findMany({
      where: {
        tenantId,
        courseId,
        semesterId,
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
        ...(studentIds && studentIds.length > 0
          ? { studentId: { in: [...studentIds] } }
          : {}),
      },
      orderBy: [{ studentId: "asc" }],
      take: limit,
      select: {
        studentId: true,
        student: { select: { id: true, enrollmentNo: true } },
      },
    });
  }

  /**
   * Attendance held and attended, per student, for one course.
   *
   * GROUPED ACROSS THE COHORT rather than read per student — three hundred
   * students cost one statement, not three hundred.
   *
   * PRESENT and LATE both count as attended; a student who arrived late
   * attended. EXCUSED does NOT count as attended but DOES count as held: an
   * authorised absence is still a session the student did not sit in, and
   * excluding it entirely would silently improve their rate.
   *
   * COST: one statement.
   */
  async findAttendanceTotals(
    tenantId: string,
    courseId: string,
    studentIds: readonly string[],
    client: DbClient = prisma
  ): Promise<readonly AttendanceTotal[]> {
    if (studentIds.length === 0) return [];

    const grouped = await client.attendance.groupBy({
      by: ["studentId", "status"],
      where: { tenantId, courseId, studentId: { in: [...studentIds] } },
      _count: { _all: true },
    });

    const totals = new Map<string, { held: number; attended: number }>();

    for (const row of grouped) {
      const entry = totals.get(row.studentId) ?? { held: 0, attended: 0 };
      const count = row._count._all;

      entry.held += count;

      if (row.status === AttendanceStatus.PRESENT || row.status === AttendanceStatus.LATE) {
        entry.attended += count;
      }

      totals.set(row.studentId, entry);
    }

    return [...totals.entries()].map(([studentId, entry]) => ({ studentId, ...entry }));
  }

  /**
   * Graded assignment marks per student, for one course.
   *
   * `available` is the sum of each parent assignment's maxMarks, so the
   * proportion is against what was actually attemptable rather than a
   * hard-coded scale.
   *
   * Only GRADED submissions contribute. An ungraded submission has no mark, and
   * treating a missing mark as zero would penalise a student for work the
   * faculty member has not assessed yet.
   *
   * Ownership is anchored through `assignment: { tenantId }` because
   * AssignmentSubmission carries no tenantId column (TD-A).
   *
   * COST: one statement.
   */
  async findAssignmentTotals(
    tenantId: string,
    courseId: string,
    studentIds: readonly string[],
    client: DbClient = prisma
  ): Promise<readonly MarksTotal[]> {
    if (studentIds.length === 0) return [];

    const rows = await client.assignmentSubmission.findMany({
      where: {
        studentId: { in: [...studentIds] },
        status: SubmissionStatus.GRADED,
        assignment: { tenantId, courseId },
      },
      select: {
        studentId: true,
        marks: true,
        assignment: { select: { maxMarks: true, type: true } },
      },
    });

    const totals = new Map<string, { graded: number; obtained: number; available: number }>();

    for (const row of rows) {
      if (row.marks === null) continue;

      const entry = totals.get(row.studentId) ?? { graded: 0, obtained: 0, available: 0 };
      entry.graded += 1;
      entry.obtained += row.marks;
      entry.available += row.assignment.maxMarks;
      totals.set(row.studentId, entry);
    }

    return [...totals.entries()].map(([studentId, entry]) => ({ studentId, ...entry }));
  }

  /**
   * Marks recorded against Phase 16 components of given types, per student.
   *
   * This is where QUIZ and PRACTICAL evidence comes from: those marks are
   * entered through Phase 16's StudentComponentScore, not through assignments.
   * Reading them here rather than inventing a quiz table is the whole reason
   * this phase composes with Phase 16 instead of duplicating it.
   *
   * COST: one statement.
   */
  async findComponentScoreTotals(
    tenantId: string,
    studentIds: readonly string[],
    componentIds: readonly string[],
    client: DbClient = prisma
  ): Promise<readonly MarksTotal[]> {
    if (studentIds.length === 0 || componentIds.length === 0) return [];

    // StudentComponentScore carries NEITHER studentId NOR componentId. It keys
    // on (assessmentEventId, courseRegistrationId): the student is reached
    // through the registration and the component through the event. That is
    // Phase 16's shape and this phase reads it as it is rather than adding
    // denormalised columns to a table it does not own.
    const rows = await client.studentComponentScore.findMany({
      where: {
        tenantId,
        courseRegistration: { studentId: { in: [...studentIds] } },
        assessmentEvent: { evaluationComponentId: { in: [...componentIds] } },
      },
      select: {
        marksObtained: true,
        courseRegistration: { select: { studentId: true } },
        // maxMarks comes from the EVENT, not the component: a component worth 20
        // may be assessed by two events of 10 each, and the component's own
        // maximum would then double-count the denominator.
        assessmentEvent: { select: { maxMarks: true } },
      },
    });

    const totals = new Map<string, { graded: number; obtained: number; available: number }>();

    for (const row of rows) {
      if (row.marksObtained === null) continue;

      const studentId = row.courseRegistration.studentId;
      const entry = totals.get(studentId) ?? { graded: 0, obtained: 0, available: 0 };
      entry.graded += 1;
      entry.obtained += Number(row.marksObtained);
      entry.available += Number(row.assessmentEvent.maxMarks);
      totals.set(studentId, entry);
    }

    return [...totals.entries()].map(([studentId, entry]) => ({ studentId, ...entry }));
  }

  /**
   * Prior academic standing per student, as a proportion of marks available.
   *
   * WHY THIS IS NOT A STORED CGPA
   *   Student carries no cgpa column — nothing in the schema stores a
   *   cumulative grade point, and Phase 16 computes it on demand through the
   *   result engine. Calling that engine once per student would be a fan-out
   *   over the whole cohort on the generate path, so this reads the underlying
   *   evidence instead: every mark the student has recorded in a DIFFERENT
   *   semester, as a share of the marks those assessments made available.
   *
   *   That is "previous academic performance" in the plainest sense the data
   *   supports, and it is reported as a proportion rather than dressed up as a
   *   CGPA it is not.
   *
   *   Excluding the CURRENT semester matters: including it would feed a
   *   student's in-progress marks back into the suggestion for those same
   *   marks, which is circular.
   *
   * COST: one statement, grouped across the whole cohort.
   */
  async findPriorPerformance(
    tenantId: string,
    studentIds: readonly string[],
    excludeSemesterId: string,
    client: DbClient = prisma
  ): Promise<readonly MarksTotal[]> {
    if (studentIds.length === 0) return [];

    const rows = await client.studentComponentScore.findMany({
      where: {
        tenantId,
        courseRegistration: {
          studentId: { in: [...studentIds] },
          semesterId: { not: excludeSemesterId },
        },
      },
      select: {
        marksObtained: true,
        courseRegistration: { select: { studentId: true } },
        assessmentEvent: { select: { maxMarks: true } },
      },
    });

    const totals = new Map<string, { graded: number; obtained: number; available: number }>();

    for (const row of rows) {
      if (row.marksObtained === null) continue;

      const studentId = row.courseRegistration.studentId;
      const entry = totals.get(studentId) ?? { graded: 0, obtained: 0, available: 0 };
      entry.graded += 1;
      entry.obtained += Number(row.marksObtained);
      entry.available += Number(row.assessmentEvent.maxMarks);
      totals.set(studentId, entry);
    }

    return [...totals.entries()].map(([studentId, entry]) => ({ studentId, ...entry }));
  }

  /**
   * Create or refresh one student's suggestion.
   *
   * An UPSERT on the natural key, so regenerating updates in place rather than
   * accumulating proposals nothing distinguishes. The faculty decision columns
   * are deliberately NOT touched on update: regenerating a suggestion must not
   * silently erase a mark a human already awarded.
   *
   * COST: one statement.
   */
  async upsertSuggestion(
    input: {
      tenantId: string;
      studentId: string;
      courseId: string;
      semesterId: string;
      componentId: string;
      suggestedMarks: number | null;
      confidence: number;
      factors: Prisma.InputJsonValue;
      rationale: string | null;
      aiModel: string | null;
      generatedById: string;
      generatedAt: Date;
    },
    client: DbClient = prisma
  ) {
    return client.internalAssessmentSuggestion.upsert({
      where: {
        tenantId_studentId_courseId_semesterId_componentId: {
          tenantId: input.tenantId,
          studentId: input.studentId,
          courseId: input.courseId,
          semesterId: input.semesterId,
          componentId: input.componentId,
        },
      },
      create: {
        tenantId: input.tenantId,
        studentId: input.studentId,
        courseId: input.courseId,
        semesterId: input.semesterId,
        componentId: input.componentId,
        suggestedMarks: input.suggestedMarks,
        confidence: input.confidence,
        factors: input.factors,
        rationale: input.rationale,
        aiModel: input.aiModel,
        generatedById: input.generatedById,
        generatedAt: input.generatedAt,
      },
      update: {
        suggestedMarks: input.suggestedMarks,
        confidence: input.confidence,
        factors: input.factors,
        rationale: input.rationale,
        aiModel: input.aiModel,
        generatedById: input.generatedById,
        generatedAt: input.generatedAt,
        // finalMarks, overrideReason, decidedById and decidedAt are ABSENT.
        // A regeneration must not erase a faculty member's decision.
      },
      select: SUGGESTION_SELECT,
    });
  }

  /** One student's suggestions, optionally narrowed. COST: one statement. */
  async findSuggestions(
    tenantId: string,
    studentId: string,
    filter: { courseId?: string; semesterId?: string },
    client: DbClient = prisma
  ) {
    return client.internalAssessmentSuggestion.findMany({
      where: {
        tenantId,
        studentId,
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
        ...(filter.semesterId ? { semesterId: filter.semesterId } : {}),
      },
      orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
      select: SUGGESTION_SELECT,
    });
  }

  /** One specific suggestion, by its natural key. COST: one statement. */
  async findSuggestion(
    key: {
      tenantId: string;
      studentId: string;
      courseId: string;
      semesterId: string;
      componentId: string;
    },
    client: DbClient = prisma
  ) {
    return client.internalAssessmentSuggestion.findUnique({
      where: { tenantId_studentId_courseId_semesterId_componentId: key },
      select: SUGGESTION_SELECT,
    });
  }

  /** Record the faculty decision. COST: one statement. */
  async recordDecision(
    input: {
      id: string;
      finalMarks: number;
      overrideReason: string | null;
      decidedById: string;
      decidedAt: Date;
    },
    client: DbClient = prisma
  ) {
    return client.internalAssessmentSuggestion.update({
      where: { id: input.id },
      data: {
        finalMarks: input.finalMarks,
        overrideReason: input.overrideReason,
        decidedById: input.decidedById,
        decidedAt: input.decidedAt,
      },
      select: SUGGESTION_SELECT,
    });
  }

  /**
   * This module's audit history for one student.
   *
   * Reads AuditLog filtered to this module's own resource name, so a Phase 25
   * audit view can never surface another module's entries. The student filter
   * is applied against the `after` snapshot, because AuditLog has no studentId
   * column — which is why the service writes it into the snapshot.
   *
   * COST: one statement.
   */
  /**
   * Does this department own the course a suggestion is against?
   *
   * The authoritative link for every operation that names a course:
   * AssessmentEvent-style work is department-owned through Course.departmentId,
   * which is a real column on a real relation rather than anything the caller
   * supplies.
   *
   * tenantId is in the predicate as well: a department id is opaque, and
   * pairing the two means a wrong one cannot reach another institution.
   */
  async courseBelongsToDepartment(
    tenantId: string,
    courseId: string,
    departmentId: string
  ): Promise<boolean> {
    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId, departmentId },
      select: { id: true },
    });

    return course !== null;
  }

  /**
   * Does this department own the student a suggestion belongs to?
   *
   * Used where courseId is OPTIONAL — the per-student reads, which without a
   * course would otherwise return every suggestion a student has in any
   * department's course. The path is Student -> Programme -> Department.
   *
   * TWO reads rather than a join because Student.programmeId is a plain scalar
   * with no Prisma relation to Programme in this schema, so
   * `where: { programme: { departmentId } }` does not typecheck and cannot be
   * written. Both are single indexed lookups.
   *
   * A student with NO programme is NOT owned by any department and is refused.
   */
  async studentBelongsToDepartment(
    tenantId: string,
    studentId: string,
    departmentId: string
  ): Promise<boolean> {
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId },
      select: { programmeId: true },
    });

    if (!student?.programmeId) {
      return false;
    }

    const programme = await prisma.programme.findFirst({
      where: { id: student.programmeId, tenantId, departmentId },
      select: { id: true },
    });

    return programme !== null;
  }

  async findAudit(
    tenantId: string,
    studentId: string,
    filter: { courseId?: string; semesterId?: string },
    client: DbClient = prisma
  ) {
    const predicate: Prisma.AuditLogWhereInput[] = [
      { after: { path: ["studentId"], equals: studentId } },
    ];

    if (filter.courseId) {
      predicate.push({ after: { path: ["courseId"], equals: filter.courseId } });
    }
    if (filter.semesterId) {
      predicate.push({ after: { path: ["semesterId"], equals: filter.semesterId } });
    }

    return client.auditLog.findMany({
      where: {
        tenantId,
        resource: INTERNAL_ASSESSMENT_RESOURCE,
        AND: predicate,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        action: true,
        resourceId: true,
        // A bare id, not an expanded name: AuditLog.userId carries no foreign
        // key and AuditLog declares no `user` relation (the TD-C / TD-C41
        // shape). There is nothing to traverse, and a per-row lookup here would
        // be an N+1. A caller resolves the name through GET /api/users/[id].
        userId: true,
        before: true,
        after: true,
        createdAt: true,
      },
    });
  }

  /** Run a unit of work atomically. The service decides the BOUNDARY. */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}

/** Everything a suggestion is reported as. */
const SUGGESTION_SELECT = {
  id: true,
  tenantId: true,
  studentId: true,
  courseId: true,
  semesterId: true,
  componentId: true,
  suggestedMarks: true,
  confidence: true,
  factors: true,
  rationale: true,
  aiModel: true,
  generatedAt: true,
  finalMarks: true,
  overrideReason: true,
  decidedAt: true,
  student: { select: { id: true, enrollmentNo: true } },
} as const;

export const internalAssessmentRepository = new InternalAssessmentRepository();

/** The abstraction the service depends on. Imported as `import type`. */
export type InternalAssessmentRepositoryPort = Pick<
  InternalAssessmentRepository,
  | "findActiveSchemeComponents"
  | "findRegisteredStudents"
  | "findAttendanceTotals"
  | "findAssignmentTotals"
  | "findComponentScoreTotals"
  | "findPriorPerformance"
  | "upsertSuggestion"
  | "findSuggestions"
  | "findSuggestion"
  | "recordDecision"
  | "findAudit"
  | "courseBelongsToDepartment"
  | "studentBelongsToDepartment"
  | "transaction"
>;

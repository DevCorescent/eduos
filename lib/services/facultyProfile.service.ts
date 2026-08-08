// ============================================================================
// OWNER      : Gauransh
// MODULE     : Faculty Profile & Performance Analytics (Phase 23)
// LAYER      : Service
// PURPOSE    : Own the access rule, orchestrate the reads, and delegate every
//              calculation.
// ARCHITECTURE:
//   • Service owns ALL orchestration and the ACCESS decision.
//   • It calculates NOTHING. Every count, rate and average comes from
//     lib/domain/faculty-analytics/metrics.ts, and the feedback rating comes
//     from Phase 20's own service rather than being re-derived — recomputing a
//     rating a faculty member can already see on the feedback page would be a
//     second opinion about the same number.
//
// THE ACCESS RULE, IN ONE PLACE
//   A faculty member may read and edit their OWN record. Reading or editing
//   ANOTHER member's requires an administrative role. Both refusals are the
//   same 404 used for "no such member", so neither answer confirms the
//   existence of the other — the same reasoning Phases 17 and 18 apply to
//   student records.
//
//   The rule is applied by resolveAccess() at the top of every method, so no
//   endpoint can be added later that forgets it.
//
// A FAILING SUBSYSTEM COSTS ONE PANEL, NOT THE PAGE
//   The feedback rating comes from a service that throws on its own failure
//   modes. Propagating that would show a head of department nothing because one
//   panel was unavailable, so it is settled independently and degrades to a
//   null rating with a zero response count.
//
// QUERY BUDGET, STATED HONESTLY
//   getProfile      1 statement (child collections nested).
//   getWorkload     1 resolve + 3 (assignments, timetable, student count).
//   getPerformance  1 resolve + 5 (as workload, plus attendance and results) +
//                   whatever the feedback service costs.
//   getAnalytics    identical to getPerformance — it is the same gather with a
//                   wider projection, not a second set of reads.
//   updateProfile   1 resolve + up to 7 inside one transaction.
//   No call is inside a loop, so every figure is bounded and constant per
//   request.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import {
  FACULTY_ANALYTICS_ATTENDANCE_LIMIT,
  FACULTY_ANALYTICS_RESULT_LIMIT,
  FACULTY_PROFILE_MESSAGE,
} from "@/lib/constants/facultyProfile";
import {
  summariseAttendance,
  summariseResults,
  summariseWorkload,
} from "@/lib/domain/faculty-analytics/metrics";
import {
  toFacultyProfileDto,
  toFacultyWorkloadDto,
  type FacultyAnalyticsDto,
  type FacultyPerformanceDto,
  type FacultyProfileDto,
  type FacultyProfileRow,
  type FacultyWorkloadDto,
} from "@/lib/dto/facultyProfile.dto";
import type { FacultyProfileRepositoryPort } from "@/lib/repositories/facultyProfile.repository";
import type {
  FacultyScopeQuery,
  UpdateFacultyProfileInput,
} from "@/lib/validations/facultyProfile.validation";

/**
 * Reads the average student rating for a faculty member.
 *
 * A NARROW PORT over Phase 20 rather than a direct dependency on its service:
 * this module needs one number, and depending on the whole FeedbackService
 * would drag its four collaborators into this module's construction and its
 * tests. The port returns the figure or null; that a null degrades the panel
 * rather than failing the request is this service's decision.
 */
export interface FacultyFeedbackPort {
  findAverageRating(
    tenantId: string,
    facultyId: string,
    semesterId: string | undefined
  ): Promise<{ averageRating: number | null; responseCount: number }>;
}

/**
 * Who is asking, as the route resolved them.
 *
 * `scope` carries the AUTHORITY the guard established, not the caller's raw
 * roles. The guard decides WHAT a caller may reach; this service decides WHICH
 * record they asked for — keeping the two apart is what stops the comparison
 * being skipped by accident. Same contract as Phase 16's ResultAccess.
 *
 * ANY — an administrative caller, reading or editing anyone in their tenant.
 * OWN — a faculty member, confined to the FacultyMember row they themselves are.
 */
export type FacultyAccessScope = "ANY" | "OWN";

export interface FacultyAccessContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly scope: FacultyAccessScope;
}

export class FacultyProfileService {
  constructor(
    private readonly repository: FacultyProfileRepositoryPort,
    private readonly feedback: FacultyFeedbackPort
  ) {}

  /** GET /api/faculty/profile/[facultyId] */
  async getProfile(
    context: FacultyAccessContext,
    facultyId: string
  ): Promise<FacultyProfileDto> {
    await this.assertMayRead(context, facultyId);

    const row = await this.repository.findProfile(context.tenantId, facultyId);

    if (!row) throw this.notFound();

    return toFacultyProfileDto(row as unknown as FacultyProfileRow);
  }

  /**
   * PATCH /api/faculty/profile/[facultyId]
   *
   * RULES   : A faculty member may edit their own profile. Editing another's
   *           requires an administrative role — a lecturer must not be able to
   *           rewrite a colleague's qualifications.
   *
   *           The three child collections are REPLACED WHOLESALE when supplied
   *           and left untouched when omitted, per the validation contract.
   *           `undefined` means "leave alone"; `[]` means "empty it". Those are
   *           different requests and are honoured differently.
   *
   * ATOMICITY: the profile update and every collection replacement share ONE
   *           transaction. A profile whose publications were deleted but not
   *           recreated is data loss with no error, which a partial write would
   *           produce on any failure between the two statements.
   */
  async updateProfile(
    context: FacultyAccessContext,
    facultyId: string,
    input: UpdateFacultyProfileInput
  ): Promise<FacultyProfileDto> {
    await this.assertMayWrite(context, facultyId);

    const updated = await this.repository.transaction(async (client) =>
      this.repository.replaceProfile(
        {
          tenantId: context.tenantId,
          facultyId,
          profile: {
            // Each key is included only when the caller supplied it, so an
            // omitted field is not written as null. `nullish()` in the schema
            // means an EXPLICIT null clears the value, which is distinct from
            // omission and is preserved here.
            ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
            ...(input.designation !== undefined ? { designation: input.designation } : {}),
            ...(input.qualification !== undefined ? { qualification: input.qualification } : {}),
            ...(input.specialization !== undefined ? { specialization: input.specialization } : {}),
            ...(input.experience !== undefined ? { experience: input.experience } : {}),
          },
          ...(input.publications !== undefined
            ? {
                publications: input.publications.map((entry) => ({
                  tenantId: context.tenantId,
                  facultyId,
                  title: entry.title,
                  publisher: entry.publisher ?? null,
                  identifier: entry.identifier ?? null,
                  url: entry.url ?? null,
                  publishedOn: entry.publishedOn ? new Date(entry.publishedOn) : null,
                })),
              }
            : {}),
          ...(input.certifications !== undefined
            ? {
                certifications: input.certifications.map((entry) => ({
                  tenantId: context.tenantId,
                  facultyId,
                  name: entry.name,
                  issuer: entry.issuer ?? null,
                  url: entry.url ?? null,
                  issuedOn: entry.issuedOn ? new Date(entry.issuedOn) : null,
                  expiresOn: entry.expiresOn ? new Date(entry.expiresOn) : null,
                })),
              }
            : {}),
          ...(input.education !== undefined
            ? {
                education: input.education.map((entry) => ({
                  tenantId: context.tenantId,
                  facultyId,
                  degree: entry.degree,
                  institution: entry.institution,
                  fieldOfStudy: entry.fieldOfStudy ?? null,
                  startYear: entry.startYear ?? null,
                  endYear: entry.endYear ?? null,
                  grade: entry.grade ?? null,
                })),
              }
            : {}),
        },
        client
      )
    );

    return toFacultyProfileDto(updated as unknown as FacultyProfileRow);
  }

  /** GET /api/faculty/workload/[facultyId] */
  async getWorkload(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ): Promise<FacultyWorkloadDto> {
    await this.assertMayRead(context, facultyId);

    const { assignments, slots, studentCount } = await this.gatherTeaching(
      context.tenantId,
      facultyId,
      query.semesterId
    );

    return toFacultyWorkloadDto({
      facultyId,
      semesterId: query.semesterId ?? null,
      summary: summariseWorkload(assignments, slots),
      studentCount,
      assignments,
      slots,
    });
  }

  /** GET /api/faculty/performance/[facultyId] */
  async getPerformance(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ): Promise<FacultyPerformanceDto> {
    const gathered = await this.gatherPerformance(context, facultyId, query);

    return gathered.performance;
  }

  /**
   * GET /api/faculty/analytics/[facultyId]
   *
   * The same gather as getPerformance with a wider projection — NOT a second
   * set of reads. The README names two endpoints and they legitimately return
   * different shapes, but issuing the queries twice to produce them would be
   * duplicate work for identical data.
   */
  async getAnalytics(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ): Promise<FacultyAnalyticsDto> {
    const { performance, workload } = await this.gatherPerformance(context, facultyId, query);

    return {
      ...performance,
      slotsBySessionType: workload.summary.slotsBySessionType,
      courses: workload.courses,
    };
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Read the teaching picture once.
   *
   * The three reads are independent and are issued CONCURRENTLY — sequentially
   * they would be three round trips where one wait suffices. The student count
   * depends on the assignments, so it is taken after them rather than beside.
   */
  private async gatherTeaching(
    tenantId: string,
    facultyId: string,
    semesterId: string | undefined
  ) {
    const [assignments, slots] = await Promise.all([
      this.repository.findAssignments(tenantId, facultyId, semesterId),
      this.repository.findTimetable(tenantId, facultyId, semesterId),
    ]);

    const studentCount = await this.repository.countTaughtStudents(
      tenantId,
      assignments
        .filter((assignment) => assignment.isActive)
        .map((assignment) => ({
          courseId: assignment.courseId,
          sectionId: assignment.sectionId,
        }))
    );

    return { assignments, slots, studentCount };
  }

  /**
   * Everything both analytics endpoints need, gathered once.
   *
   * The feedback read is settled INDEPENDENTLY. Phase 20's analytics can refuse
   * a faculty member it cannot resolve, or an anonymity threshold it will not
   * cross; propagating that would take down a dashboard because one panel was
   * unavailable. A failure degrades to a null rating with a zero count, which
   * is indistinguishable to a client from "nobody has responded yet" — and both
   * are honestly "no rating to show".
   */
  private async gatherPerformance(
    context: FacultyAccessContext,
    facultyId: string,
    query: FacultyScopeQuery
  ) {
    await this.assertMayRead(context, facultyId);

    const teaching = await this.gatherTeaching(context.tenantId, facultyId, query.semesterId);

    const courseIds = [
      ...new Set(
        teaching.assignments
          .filter((assignment) => assignment.isActive)
          .map((assignment) => assignment.courseId)
      ),
    ];

    const [attendance, results, feedback] = await Promise.all([
      this.repository.findAttendanceForFaculty(
        context.tenantId,
        facultyId,
        FACULTY_ANALYTICS_ATTENDANCE_LIMIT
      ),
      this.repository.findResultsForCourses(
        context.tenantId,
        courseIds,
        query.semesterId,
        FACULTY_ANALYTICS_RESULT_LIMIT
      ),
      this.feedback
        .findAverageRating(context.tenantId, facultyId, query.semesterId)
        .catch(() => ({ averageRating: null, responseCount: 0 })),
    ]);

    const summary = summariseWorkload(teaching.assignments, teaching.slots);

    const workload = toFacultyWorkloadDto({
      facultyId,
      semesterId: query.semesterId ?? null,
      summary,
      studentCount: teaching.studentCount,
      assignments: teaching.assignments,
      slots: teaching.slots,
    });

    const performance: FacultyPerformanceDto = {
      facultyId,
      semesterId: query.semesterId ?? null,
      teaching: {
        courseCount: summary.courseCount,
        sectionCount: summary.sectionCount,
        weeklySlotCount: summary.weeklySlotCount,
        studentCount: teaching.studentCount,
      },
      attendance: summariseAttendance(attendance.rows, attendance.truncated),
      results: summariseResults(results.rows, results.truncated),
      feedback,
    };

    return { performance, workload };
  }

  /**
   * May this caller READ the named member's record?
   *
   * An administrative role reads anyone in their tenant. A faculty member reads
   * only themselves, which is decided by resolving them to their OWN
   * FacultyMember row and comparing ids — never by trusting a client-supplied
   * identifier.
   */
  private async assertMayRead(
    context: FacultyAccessContext,
    facultyId: string
  ): Promise<void> {
    if (context.scope === "ANY") return;

    const own = await this.repository.findByUserId(context.tenantId, context.userId);

    // A caller holding FACULTY but owning no FacultyMember row reaches the same
    // refusal as one reading someone else's record.
    if (!own || own.id !== facultyId) throw this.notFound();
  }

  /**
   * May this caller WRITE the named member's record?
   *
   * The same rule as reading. Stated as a separate method rather than aliased
   * so that a future divergence — say, an institution that lets an HOD read but
   * not edit — has a place to live that is not a boolean parameter.
   */
  private async assertMayWrite(
    context: FacultyAccessContext,
    facultyId: string
  ): Promise<void> {
    if (context.scope === "ANY") return;

    const own = await this.repository.findByUserId(context.tenantId, context.userId);

    if (!own || own.id !== facultyId) throw this.notFound();
  }

  /**
   * One refusal for three situations: no such member, another tenant's member,
   * and another person's record. Distinguishing them would confirm the
   * existence of a record the caller may not read.
   */
  private notFound(): AppError {
    return new AppError(
      FACULTY_PROFILE_MESSAGE.NOT_FOUND,
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODE.NOT_FOUND
    );
  }
}

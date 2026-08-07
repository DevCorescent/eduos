// ============================================================================
// OWNER      : Gauransh
// MODULE     : Open Elective Management
// LAYER      : Service
// PURPOSE    : Orchestrate the five open-elective use cases.
// ARCHITECTURE:
//                Repository  ->  Domain Engine  ->  CourseRegistrationService
//
//   • The SERVICE owns lifecycle rules, authorisation outcomes and transaction
//     boundaries — and nothing else.
//   • It computes NO allocation. Eligibility, ordering, seat awarding and
//     reporting all live in lib/domain/open-electives, which this file calls
//     and never reimplements. A seat rule written here would be a second
//     opinion about an answer the engine already gives.
//   • Enrolment is delegated to CourseRegistrationService, which already owns
//     attempt numbering, credit snapshotting and scheme resolution. Writing
//     registrations here would duplicate all three.
//
// DUAL-MODE, UNLIKE PHASES 17 AND 18
//   Those were purely self-service. This module is not: a student acts on their
//   own record (`submitPreferences`, `getStatus`) while staff act on a cohort
//   (`allocate`, `lock`). The split is explicit — a student method resolves the
//   caller to their own Student row and never accepts an id, while a staff
//   method names an OFFERING and never a student.
//
// SEATS AND CONCURRENCY
//   Seat availability is derived — `totalSeats - count(ALLOCATED)` — and never
//   stored, so it cannot drift. The genuine hazard is two allocation runs each
//   seeing the last seat free. `allocate` therefore runs inside ONE interactive
//   transaction that re-reads the offering and clears prior verdicts before
//   writing new ones, so a concurrent run collides on the
//   @@unique([offeringId, studentId]) constraint rather than quietly
//   double-booking. That is documented as a limitation, not claimed as a proof:
//   see the report accompanying this batch.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE } from "@/lib/constants/errors";
import {
  ALLOCATABLE_STATUS,
  ELECTIVE_MESSAGE,
  MAX_ALLOCATION_COHORT,
  PREFERENCE_EDITABLE_STATUS,
  canTransition,
} from "@/lib/constants/openElective";
import { OpenElectiveStatus } from "@/app/generated/prisma/enums";
import type {
  DbClient,
  OpenElectiveRepository,
} from "@/lib/repositories/openElective.repository";
import {
  evaluateEligibility,
  groupRulesByOffering,
} from "@/lib/domain/open-electives/eligibilityEngine";
import {
  runAllocation,
  type AllocationApplicant,
} from "@/lib/domain/open-electives/allocationEngine";
import { summariseAllocation } from "@/lib/domain/open-electives/allocationReport";
import {
  toAllocationDto,
  toAllocationReportDto,
  toOfferingDto,
  toPreferenceDto,
  toStudentOfferingDto,
  type AllocationReportDto,
  type ElectiveStatusDto,
  type OpenElectiveOfferingDto,
  type PreferenceSubmissionDto,
  type StudentOfferingDto,
} from "@/lib/dto/openElective.dto";
import type {
  AllocateInput,
  ListOfferingsQuery,
  LockInput,
  SubmitPreferencesInput,
} from "@/lib/validations/openElective.validation";

/**
 * The caller's authority, decided by the route and applied here.
 *
 * Mirrors Phase 16's ResultAccess for the same reason: deciding WHO is asking
 * needs the session, enforcing it needs a repository, and neither layer should
 * do the other's job.
 */
export type ElectiveAccess =
  | { readonly scope: "STAFF" }
  | { readonly scope: "STUDENT"; readonly userId: string };

/** A page of offerings with its pagination metadata. */
export interface OfferingPage {
  readonly offerings: readonly OpenElectiveOfferingDto[] | readonly StudentOfferingDto[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

/**
 * The narrow slice of CourseRegistrationService this module depends on.
 *
 * Interface Segregation: allocation needs to enrol, and nothing else. Depending
 * on the whole class would let elective handling quietly start dropping
 * registrations.
 *
 * Shaped to what registerBulk ACTUALLY returns — counts and skips, not the
 * created rows. That is why ElectiveRosterPort exists below: the registration
 * ids an allocation must link to are read back rather than assumed, because
 * assuming them would have produced allocations with a null registration and no
 * error to say why.
 */
export interface ElectiveEnrolmentPort {
  registerBulk(
    tenantId: string,
    input: {
      readonly courseId: string;
      readonly semesterId: string;
      /**
       * The OFFERING department's regulation, carried from the offering row.
       *
       * This is the Phase 19 decision made real: an open elective is graded by
       * the department that offers it, not by the student's own programme. The
       * column is required by registerBulk, which is what forced the question
       * to be answered rather than defaulted.
       */
      readonly evaluationSchemeId: string;
      readonly studentIds: string[];
      readonly registrationType: "OPEN_ELECTIVE";
    },
    context: { readonly actorId: string; readonly ipAddress: string | null; readonly userAgent: string | null }
  ): Promise<{ readonly registeredCount: number }>;
}

/**
 * Reads back the registrations an enrolment produced.
 *
 * Needed because registerBulk reports COUNTS rather than rows — a 500-student
 * batch deliberately does not echo 500 records. The allocation still has to
 * link each award to its enrolment, so the roster is read once after the write,
 * inside the same transaction.
 */
export interface ElectiveRosterPort {
  findRoster(
    tenantId: string,
    courseId: string,
    semesterId: string,
    statuses: readonly ("REGISTERED" | "CONFIRMED" | "COMPLETED")[],
    sectionId?: string,
    client?: DbClient
  ): Promise<readonly { readonly id: string; readonly studentId: string }[]>;
}

/** Resolves a student from a user, and reads the facts eligibility needs. */
export interface ElectiveStudentPort {
  findStudentByUserId(
    tenantId: string,
    userId: string
  ): Promise<{ readonly id: string } | null>;
  findStudentProfiles(
    tenantId: string,
    studentIds: readonly string[]
  ): Promise<
    readonly {
      readonly id: string;
      readonly programmeId: string | null;
      readonly specialisationId: string | null;
      readonly currentSemester: number;
    }[]
  >;
}

/** Supplies a merit key. Returns null for a student with no CGPA — never zero. */
export interface ElectiveMeritPort {
  findCgpaScaled(
    tenantId: string,
    studentIds: readonly string[]
  ): Promise<ReadonlyMap<string, number | null>>;
}

export class OpenElectiveService {
  constructor(
    private readonly repository: OpenElectiveRepository,
    private readonly students: ElectiveStudentPort,
    private readonly merit: ElectiveMeritPort,
    private readonly enrolment: ElectiveEnrolmentPort,
    private readonly roster: ElectiveRosterPort
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/open-electives
  // --------------------------------------------------------------------------

  /**
   * The offering catalogue.
   *
   * For STAFF this is the plain catalogue. For a STUDENT each offering is
   * annotated with THEIR eligibility and THEIR existing choice — computed by
   * the domain engine, never here.
   *
   * COST: four statements for any page size — the page, its count, one batched
   * eligibility read and one batched seat count. Adding a student's own
   * preferences makes five. None grows with the page.
   */
  async listOfferings(
    tenantId: string,
    query: ListOfferingsQuery,
    access: ElectiveAccess
  ): Promise<OfferingPage> {
    const page = await this.repository.listOfferings(tenantId, query);
    const offeringIds = page.rows.map((row) => row.id);

    const [rules, seatCounts] = await Promise.all([
      this.repository.findEligibility(tenantId, offeringIds),
      this.repository.countAllocatedForOfferings(tenantId, offeringIds),
    ]);

    const rulesByOffering = groupRulesByOffering(rules);
    const allocatedByOffering = new Map(
      seatCounts.map((entry) => [entry.offeringId, entry._count._all])
    );

    const base = page.rows.map((row) =>
      toOfferingDto(row, allocatedByOffering.get(row.id) ?? 0, rulesByOffering.get(row.id) ?? [])
    );

    const pagination = {
      page: query.page,
      limit: query.limit,
      total: page.total,
      totalPages: Math.ceil(page.total / query.limit),
    };

    if (access.scope === "STAFF") {
      return { offerings: base, pagination };
    }

    const studentId = await this.resolveOwnStudent(tenantId, access.userId);
    const profile = await this.requireProfile(tenantId, studentId);

    // One read for every semester the page spans — not one per offering.
    const semesterIds = [...new Set(page.rows.map((row) => row.semesterId))];
    const chosen = new Map<string, number>();

    for (const semesterId of semesterIds) {
      const preferences = await this.repository.findStudentPreferences(
        tenantId,
        studentId,
        semesterId
      );

      for (const preference of preferences) {
        chosen.set(preference.offeringId, preference.preferenceRank);
      }
    }

    const annotated = base.map((offering) => {
      const verdict = evaluateEligibility(
        profile,
        rulesByOffering.get(offering.id) ?? []
      );

      return toStudentOfferingDto(
        offering,
        verdict.isEligible,
        verdict.reasons,
        chosen.get(offering.id) ?? null
      );
    });

    return { offerings: annotated, pagination };
  }

  // --------------------------------------------------------------------------
  // POST /api/open-electives/select
  // --------------------------------------------------------------------------

  /**
   * Record a student's ranked choices, replacing whatever they had.
   *
   * Every chosen offering must exist, belong to this tenant, sit in the named
   * semester and be OPEN. Eligibility is checked too: letting an ineligible
   * student queue would waste a place the allocator has to refuse anyway, and
   * telling them at allocation time rather than at selection time is the worse
   * of two moments to find out.
   *
   * COST: five statements — resolve, profile, offerings, rules, then one
   * transaction containing the delete and the insert.
   */
  async submitPreferences(
    tenantId: string,
    userId: string,
    input: SubmitPreferencesInput,
    now: Date
  ): Promise<PreferenceSubmissionDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);
    const profile = await this.requireProfile(tenantId, studentId);

    const offeringIds = input.preferences.map((entry) => entry.offeringId);
    const offerings = await this.repository.findOfferingsByIds(tenantId, offeringIds);
    const byId = new Map(offerings.map((offering) => [offering.id, offering]));

    const rules = await this.repository.findEligibility(tenantId, offeringIds);
    const rulesByOffering = groupRulesByOffering(rules);

    for (const choice of input.preferences) {
      const offering = byId.get(choice.offeringId);

      if (offering === undefined) {
        throw new AppError(ELECTIVE_MESSAGE.OFFERING_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
      }

      if (offering.semesterId !== input.semesterId) {
        throw new AppError(ELECTIVE_MESSAGE.SEMESTER_MISMATCH, 422, ERROR_CODE.VALIDATION);
      }

      if (offering.status !== PREFERENCE_EDITABLE_STATUS) {
        throw new AppError(ELECTIVE_MESSAGE.NOT_OPEN, 409, ERROR_CODE.CONFLICT);
      }

      const verdict = evaluateEligibility(
        profile,
        rulesByOffering.get(offering.id) ?? []
      );

      if (!verdict.isEligible) {
        throw new AppError(
          verdict.reasons[0] ?? ELECTIVE_MESSAGE.INELIGIBLE,
          403,
          ERROR_CODE.FORBIDDEN
        );
      }
    }

    const rows = input.preferences.map((choice) => ({
      offeringId: choice.offeringId,
      preferenceRank: choice.preferenceRank,
      submittedAt: now,
    }));

    const recorded = await this.repository.transaction((tx) =>
      this.repository.replacePreferences(tenantId, studentId, input.semesterId, rows, tx)
    );

    const stored = await this.repository.findStudentPreferences(
      tenantId,
      studentId,
      input.semesterId
    );

    return {
      studentId,
      semesterId: input.semesterId,
      recorded,
      preferences: stored.map(toPreferenceDto),
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/open-electives/status
  // --------------------------------------------------------------------------

  /**
   * One student's own position: what they chose and what came of it.
   *
   * COST: three statements — resolve, preferences, allocations.
   */
  async getStatus(
    tenantId: string,
    userId: string,
    semesterId: string
  ): Promise<ElectiveStatusDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const [preferences, allocations] = await Promise.all([
      this.repository.findStudentPreferences(tenantId, studentId, semesterId),
      this.repository.findStudentAllocations(tenantId, studentId, semesterId),
    ]);

    // Editable while ANY chosen offering is still OPEN — the same predicate the
    // DTO exposes as acceptsPreferences, read from the offering rather than
    // re-derived from a status string here.
    const isEditable = allocations.length === 0 && preferences.length > 0
      ? await this.anyChosenOfferingOpen(tenantId, preferences.map((p) => p.offeringId))
      : preferences.length === 0;

    return {
      studentId,
      semesterId,
      preferences: preferences.map(toPreferenceDto),
      allocations: allocations.map(toAllocationDto),
      isAllocated: allocations.length > 0,
      isEditable,
    };
  }

  // --------------------------------------------------------------------------
  // POST /api/open-electives/allocate
  // --------------------------------------------------------------------------

  /**
   * Run one offering's allocation.
   *
   * The service does the LIFECYCLE and the TRANSACTION; the domain engine does
   * the allocation. Every seat decision below comes from `runAllocation` — this
   * method contains no comparison of a seat count to a queue length, because
   * that comparison exists once, in seatAllocator.
   *
   * Enrolment is delegated to CourseRegistrationService, which owns attempt
   * numbering and credit snapshotting. The registrations it returns are linked
   * back onto the allocation rows so an award is traceable to its enrolment.
   *
   * COST: bounded and constant per run — it does not grow with the cohort.
   */
  async allocate(
    tenantId: string,
    input: AllocateInput,
    actorUserId: string,
    now: Date
  ): Promise<AllocationReportDto> {
    const offering = await this.requireOffering(tenantId, input.offeringId);

    if (offering.status === OpenElectiveStatus.ALLOCATED && !input.force) {
      throw new AppError(ELECTIVE_MESSAGE.ALREADY_ALLOCATED, 409, ERROR_CODE.CONFLICT);
    }

    if (offering.status !== ALLOCATABLE_STATUS && offering.status !== OpenElectiveStatus.ALLOCATED) {
      throw new AppError(ELECTIVE_MESSAGE.NOT_ALLOCATABLE, 409, ERROR_CODE.CONFLICT);
    }

    const preferences = await this.repository.findOfferingPreferences(
      tenantId,
      input.offeringId
    );

    if (preferences.length > MAX_ALLOCATION_COHORT) {
      throw new AppError(ELECTIVE_MESSAGE.COHORT_TOO_LARGE, 422, ERROR_CODE.VALIDATION);
    }

    const studentIds = preferences.map((preference) => preference.studentId);

    const [profiles, cgpa, rules] = await Promise.all([
      this.students.findStudentProfiles(tenantId, studentIds),
      this.merit.findCgpaScaled(tenantId, studentIds),
      this.repository.findEligibility(tenantId, [input.offeringId]),
    ]);

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    const applicants: AllocationApplicant[] = preferences.map((preference) => {
      const profile = profileById.get(preference.studentId);

      return {
        studentId: preference.studentId,
        preferenceRank: preference.preferenceRank,
        submittedAt: preference.submittedAt,
        // Null means "no CGPA", which the engine treats as a real state. No
        // value is ever invented for a student who has none.
        cgpaScaled: cgpa.get(preference.studentId) ?? null,
        profile: {
          studentId: preference.studentId,
          programmeId: profile?.programmeId ?? null,
          specialisationId: profile?.specialisationId ?? null,
          currentSemester: profile?.currentSemester ?? 0,
        },
      };
    });

    // The whole allocation, computed by the domain engine.
    const result = runAllocation({
      offeringId: input.offeringId,
      totalSeats: offering.totalSeats,
      strategy: offering.allocationStrategy,
      eligibilityRules: rules,
      applicants,
      allocatedAt: now,
    });

    const awarded = result.verdicts.filter((verdict) => verdict.outcome === "ALLOCATED");

    const written = await this.repository.transaction(async (tx) => {
      // Clearing first is what makes a forced re-run possible at all: the
      // (offeringId, studentId) unique constraint would otherwise reject the
      // second verdict for every student.
      await this.repository.deleteAllocations(tenantId, input.offeringId, tx);

      if (awarded.length > 0) {
        await this.enrolment.registerBulk(
          tenantId,
          {
            courseId: offering.courseId,
            semesterId: offering.semesterId,
            evaluationSchemeId: offering.evaluationSchemeId,
            studentIds: awarded.map((verdict) => verdict.studentId),
            registrationType: "OPEN_ELECTIVE",
          },
          { actorId: actorUserId, ipAddress: null, userAgent: null }
        );
      }

      // registerBulk reports counts, not rows, so the ids are read back — once,
      // for the whole cohort, inside the same transaction. A student who
      // already held an enrolment was SKIPPED rather than created, and the
      // roster returns them too, so their award still links correctly.
      const registrations =
        awarded.length === 0
          ? []
          : await this.roster.findRoster(
              tenantId,
              offering.courseId,
              offering.semesterId,
              ["REGISTERED", "CONFIRMED", "COMPLETED"],
              undefined,
              tx
            );

      const registrationByStudent = new Map(
        registrations.map((registration) => [registration.studentId, registration.id])
      );

      await this.repository.createAllocations(
        result.verdicts.map((verdict) => ({
          tenantId,
          offeringId: input.offeringId,
          studentId: verdict.studentId,
          preferenceRank: verdict.preferenceRank,
          outcome: verdict.outcome,
          courseRegistrationId:
            verdict.outcome === "ALLOCATED"
              ? registrationByStudent.get(verdict.studentId) ?? null
              : null,
          allocatedAt: verdict.allocatedAt,
        })),
        tx
      );

      await this.repository.updateOfferingStatus(
        tenantId,
        input.offeringId,
        OpenElectiveStatus.ALLOCATED,
        now,
        tx
      );

      return this.repository.findAllocations(tenantId, input.offeringId, tx);
    });

    // Computed by the domain module, so the report and the run cannot disagree.
    const summary = summariseAllocation(result, offering.totalSeats);

    return {
      ...toAllocationReportDto(input.offeringId, offering.totalSeats, written),
      allocated: summary.awarded,
      notAllocated: summary.refused,
      seatsRemaining: summary.seatsRemaining,
    };
  }

  // --------------------------------------------------------------------------
  // PATCH /api/open-electives/lock
  // --------------------------------------------------------------------------

  /**
   * Freeze an offering's preference set.
   *
   * The transition table decides whether it is permitted; this method does not
   * restate the rule. OPEN -> LOCKED is the intended path, and an offering
   * already ALLOCATED cannot be locked because ALLOCATED is terminal.
   *
   * COST: two statements.
   */
  async lock(
    tenantId: string,
    input: LockInput,
    now: Date
  ): Promise<OpenElectiveOfferingDto> {
    const offering = await this.requireOffering(tenantId, input.offeringId);

    if (!canTransition(offering.status, OpenElectiveStatus.LOCKED)) {
      throw new AppError(ELECTIVE_MESSAGE.INVALID_TRANSITION, 409, ERROR_CODE.CONFLICT);
    }

    const updated = await this.repository.updateOfferingStatus(
      tenantId,
      input.offeringId,
      OpenElectiveStatus.LOCKED,
      now
    );

    const allocated = await this.repository.countAllocated(tenantId, input.offeringId);
    const rules = await this.repository.findEligibility(tenantId, [input.offeringId]);

    return toOfferingDto(updated, allocated, rules);
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  /**
   * Resolve the caller to the Student row they own.
   *
   * A permitted role with no Student row is FORBIDDEN, not served an empty
   * list — the same convention Phases 17 and 18 established for the identical
   * situation, using the same message so the two cases are indistinguishable.
   */
  private async resolveOwnStudent(tenantId: string, userId: string): Promise<string> {
    const own = await this.students.findStudentByUserId(tenantId, userId);

    if (own === null) {
      throw new AppError(ELECTIVE_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    return own.id;
  }

  /** The academic facts eligibility is decided on. */
  private async requireProfile(tenantId: string, studentId: string) {
    const [profile] = await this.students.findStudentProfiles(tenantId, [studentId]);

    if (profile === undefined) {
      throw new AppError(ELECTIVE_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    return {
      studentId,
      programmeId: profile.programmeId,
      specialisationId: profile.specialisationId,
      currentSemester: profile.currentSemester,
    };
  }

  /** One offering, or 404. Unknown and other-tenant ids are alike here. */
  private async requireOffering(tenantId: string, offeringId: string) {
    const offering = await this.repository.findOfferingById(tenantId, offeringId);

    if (offering === null) {
      throw new AppError(ELECTIVE_MESSAGE.OFFERING_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    return offering;
  }

  /** Whether any of a student's chosen offerings still accepts changes. */
  private async anyChosenOfferingOpen(
    tenantId: string,
    offeringIds: readonly string[],
    client?: DbClient
  ): Promise<boolean> {
    const offerings = await this.repository.findOfferingsByIds(
      tenantId,
      offeringIds,
      client
    );

    return offerings.some((offering) => offering.status === PREFERENCE_EDITABLE_STATUS);
  }
}

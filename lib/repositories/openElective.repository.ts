// ============================================================================
// OWNER      : Gauransh
// MODULE     : Open Elective Management
// LAYER      : Repository
// PURPOSE    : Every read and write the open-elective module needs, and nothing
//              that decides anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • NO seat arithmetic, NO eligibility evaluation, NO ranking, NO allocation,
//     NO status-transition checking, NO DTO mapping. Each of those is a
//     business rule and every one of them lives in the service.
//
//   The distinction is sharpest around SEATS. This file will happily tell you
//   how many allocations an offering has (`countAllocated`) and what capacity
//   it declared (`totalSeats` on the row). It will never tell you how many
//   seats REMAIN, because that is a subtraction, and a subtraction is a
//   calculation. The service does it.
//
//   Likewise ELIGIBILITY: `findEligibility` returns the rules. It does not
//   evaluate whether a given student satisfies them — that is a decision about
//   programme, branch and semester, and it belongs where decisions belong.
//
// TENANT ISOLATION IS STRUCTURAL, NOT MERELY FILTERED
//   OpenElectiveOffering carries @@unique([tenantId, id]), so eligibility,
//   preferences and allocations reference it through a COMPOSITE foreign key on
//   (tenantId, id). A child row citing another tenant's offering is refused by
//   the database, not by a predicate this file could forget to write. Every
//   query below ALSO filters on tenantId — belt and braces, because a
//   structural guarantee about writes is not a guarantee about reads.
//
// THE QUERY BUDGET
//   Every method issues a FIXED number of statements. The paginated catalogue
//   read costs two (a page and its count); every other method costs one, except
//   `replacePreferences`, which is a delete plus a createMany inside a caller-
//   supplied transaction. There is no per-row read anywhere, so no method can
//   become an N+1 — an offering's eligibility rules travel with it through a
//   nested select rather than one query per rule.
//
// INDEXES THIS RELIES ON
//   OpenElectiveOffering   @@index([tenantId, semesterId, status]) — catalogue
//   OpenElectivePreference @@index([tenantId, offeringId, preferenceRank,
//                                   submittedAt]) — the allocation input, in
//                          rank order with the FCFS tie-breaker on the same
//                          index, so a run needs no sort of its own
//   OpenElectiveAllocation @@index([tenantId, offeringId, outcome]) — the seat
//                          count and the allocation report
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import {
  ElectiveAllocationOutcome,
  OpenElectiveStatus,
  type Prisma,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** A page of rows and the total that satisfied the same predicate. */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/**
 * Offering columns every read returns.
 *
 * The course, semester and department travel with the offering because a
 * catalogue is unreadable without them, and fetching them separately would be
 * three round trips for one page. `evaluationScheme` is projected as an id plus
 * its code and version — enough for a client to see WHICH regulation grades the
 * elective without loading a regulation's whole configuration.
 */
export const OFFERING_SELECT = {
  id: true,
  tenantId: true,
  courseId: true,
  semesterId: true,
  offeringDepartmentId: true,
  evaluationSchemeId: true,
  totalSeats: true,
  status: true,
  allocationStrategy: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, name: true, credits: true, type: true } },
  semester: { select: { id: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  evaluationScheme: { select: { id: true, code: true, version: true } },
} as const;

/** Eligibility columns. Every one — the model holds nothing private. */
export const ELIGIBILITY_SELECT = {
  id: true,
  offeringId: true,
  programmeId: true,
  specialisationId: true,
  semesterNumber: true,
  programme: { select: { id: true, code: true, name: true } },
  specialisation: { select: { id: true, code: true, name: true } },
} as const;

/** Preference columns. `submittedAt` is projected: FCFS reads it. */
export const PREFERENCE_SELECT = {
  id: true,
  studentId: true,
  offeringId: true,
  semesterId: true,
  preferenceRank: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Allocation columns. */
export const ALLOCATION_SELECT = {
  id: true,
  offeringId: true,
  studentId: true,
  preferenceRank: true,
  outcome: true,
  courseRegistrationId: true,
  allocatedAt: true,
} as const;

/**
 * Catalogue ordering: soonest-starting semester first, then course code.
 *
 * `id` closes it so the order is TOTAL — offset pagination over a non-total
 * order silently skips one row and repeats another between pages. Exported so a
 * test can assert it without a database.
 */
export const OFFERING_ORDER_BY = [
  { semester: { startDate: "asc" } },
  { course: { code: "asc" } },
  { id: "asc" },
] as const;

/**
 * Preference ordering: rank first, then submission time.
 *
 * This is the ALLOCATION INPUT ORDER, and it matches the composite index
 * exactly, so a run reads its cohort already sorted. Rank is always honoured
 * before any tie-break; `submittedAt` is what FCFS breaks ties on. A MERIT
 * offering re-orders within a rank using data this table does not hold, which
 * is the service's problem and not this file's.
 */
export const PREFERENCE_ORDER_BY = [
  { preferenceRank: "asc" },
  { submittedAt: "asc" },
  { id: "asc" },
] as const;

/** The one status in which a preference may be written. */
export const PREFERENCE_WRITABLE_STATUS = OpenElectiveStatus.OPEN;

/** The outcome that consumes a seat. */
export const SEAT_CONSUMING_OUTCOME = ElectiveAllocationOutcome.ALLOCATED;

export class OpenElectiveRepository {
  // --- Offerings ------------------------------------------------------------

  /**
   * The offering catalogue, filtered and paged.
   *
   * COST: two statements — the page and its count under the identical
   * predicate, so the total can never describe a wider set than the caller can
   * read. Issued separately rather than in a transaction: this is a read-only
   * catalogue, and a count that drifts by one under a concurrent write costs
   * far less than holding a transaction open for a portal page.
   */
  async listOfferings(
    tenantId: string,
    filters: OfferingFilters,
    client: DbClient = prisma
  ): Promise<Page<OfferingRow>> {
    const where: Prisma.OpenElectiveOfferingWhereInput = {
      tenantId,
      ...(filters.semesterId === undefined ? {} : { semesterId: filters.semesterId }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.departmentId === undefined
        ? {}
        : { offeringDepartmentId: filters.departmentId }),
      ...(filters.courseId === undefined ? {} : { courseId: filters.courseId }),
    };

    const rows = await client.openElectiveOffering.findMany({
      where,
      select: OFFERING_SELECT,
      orderBy: [...OFFERING_ORDER_BY],
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    });

    const total = await client.openElectiveOffering.count({ where });

    return { rows, total };
  }

  /**
   * One offering, tenant-scoped.
   *
   * findFirst rather than findUnique, and that is not stylistic: findUnique
   * accepts only a unique key, so the tenant predicate could not be part of the
   * lookup and would have to be checked after the row was read. Checking
   * afterwards means a caller who can distinguish "found but not yours" from
   * "not found" learns that another tenant's offering exists.
   *
   * COST: one statement.
   */
  async findOfferingById(tenantId: string, offeringId: string, client: DbClient = prisma) {
    return client.openElectiveOffering.findFirst({
      where: { id: offeringId, tenantId },
      select: OFFERING_SELECT,
    });
  }

  /**
   * Move an offering's status.
   *
   * The compound selector carries its OWN tenant predicate rather than
   * inheriting one from a preceding read — the same TOCTOU defence Phase 16
   * established. Which transitions are legal is the SERVICE's rule; this
   * method will write whatever it is told, which is why the service asserts
   * first.
   *
   * COST: one statement.
   */
  async updateOfferingStatus(
    tenantId: string,
    offeringId: string,
    status: OpenElectiveStatus,
    statusChangedAt: Date,
    client: DbClient = prisma
  ) {
    return client.openElectiveOffering.update({
      where: { tenantId_id: { tenantId, id: offeringId } },
      data: { status, statusChangedAt },
      select: OFFERING_SELECT,
    });
  }

  // --- Eligibility ----------------------------------------------------------

  /**
   * The eligibility rules for a set of offerings.
   *
   * Takes a SET, not one id, so a catalogue of forty offerings costs ONE
   * statement rather than forty. This is the shape that keeps the list endpoint
   * free of an N+1 — the service groups the result by offeringId.
   *
   * An offering with no rows is UNRESTRICTED. That meaning is the service's to
   * apply; this method reports the rows and nothing more.
   *
   * COST: one statement.
   */
  async findEligibility(
    tenantId: string,
    offeringIds: readonly string[],
    client: DbClient = prisma
  ) {
    if (offeringIds.length === 0) {
      return [];
    }

    return client.openElectiveEligibility.findMany({
      where: { tenantId, offeringId: { in: [...offeringIds] } },
      select: ELIGIBILITY_SELECT,
    });
  }

  // --- Preferences ----------------------------------------------------------

  /**
   * One student's preferences for a semester, in rank order.
   *
   * COST: one statement.
   */
  async findStudentPreferences(
    tenantId: string,
    studentId: string,
    semesterId: string,
    client: DbClient = prisma
  ) {
    return client.openElectivePreference.findMany({
      where: { tenantId, studentId, semesterId },
      select: PREFERENCE_SELECT,
      orderBy: [...PREFERENCE_ORDER_BY],
    });
  }

  /**
   * Every preference for one offering — the allocation input.
   *
   * Returned in rank-then-submission order, matching the composite index, so a
   * run reads its cohort already sorted and performs no sort of its own.
   *
   * COST: one statement.
   */
  async findOfferingPreferences(
    tenantId: string,
    offeringId: string,
    client: DbClient = prisma
  ) {
    return client.openElectivePreference.findMany({
      where: { tenantId, offeringId },
      select: PREFERENCE_SELECT,
      orderBy: [...PREFERENCE_ORDER_BY],
    });
  }

  /**
   * Replace a student's preferences for one semester, wholesale.
   *
   * Delete-then-insert rather than a per-row diff, and the reasoning is
   * specific to this table: a preference LIST is ordered, and re-ranking three
   * choices means every row changes. A diff would issue three updates and still
   * have to reason about the (studentId, semesterId, preferenceRank) unique
   * constraint mid-flight, where a transient duplicate rank would abort the
   * transaction. Clearing first removes that hazard entirely.
   *
   * The caller MUST supply a transaction handle — this is two statements that
   * are only correct together, and a crash between them would leave a student
   * with no preferences at all.
   *
   * COST: two statements. Whether the offering is OPEN is the service's check.
   */
  async replacePreferences(
    tenantId: string,
    studentId: string,
    semesterId: string,
    rows: readonly PreferenceInput[],
    client: DbClient
  ): Promise<number> {
    await client.openElectivePreference.deleteMany({
      where: { tenantId, studentId, semesterId },
    });

    if (rows.length === 0) {
      return 0;
    }

    const created = await client.openElectivePreference.createMany({
      data: rows.map((row) => ({
        tenantId,
        studentId,
        semesterId,
        offeringId: row.offeringId,
        preferenceRank: row.preferenceRank,
        submittedAt: row.submittedAt,
      })),
    });

    return created.count;
  }

  /**
   * The offerings a set of preference rows point at.
   *
   * One statement for the whole set, so validating that every chosen offering
   * exists, is OPEN and belongs to this tenant costs one read rather than one
   * per choice. The service does the validating; this supplies the facts.
   *
   * COST: one statement.
   */
  async findOfferingsByIds(
    tenantId: string,
    offeringIds: readonly string[],
    client: DbClient = prisma
  ) {
    if (offeringIds.length === 0) {
      return [];
    }

    return client.openElectiveOffering.findMany({
      where: { tenantId, id: { in: [...offeringIds] } },
      select: OFFERING_SELECT,
    });
  }

  // --- Allocations ----------------------------------------------------------

  /**
   * How many seats an offering has CONSUMED.
   *
   * A count, not a remainder. `totalSeats - this` is the remaining figure, and
   * that subtraction is a calculation the service performs — which is why this
   * method is named for what it counts rather than for what the caller wants.
   *
   * COST: one statement.
   */
  async countAllocated(tenantId: string, offeringId: string, client: DbClient = prisma) {
    return client.openElectiveAllocation.count({
      where: { tenantId, offeringId, outcome: SEAT_CONSUMING_OUTCOME },
    });
  }

  /**
   * Consumed seats for MANY offerings at once.
   *
   * groupBy rather than a count per offering: a catalogue of forty offerings
   * costs ONE statement, not forty. This is the second half of keeping the list
   * endpoint free of an N+1 — the first was findEligibility taking a set.
   *
   * COST: one statement.
   */
  async countAllocatedForOfferings(
    tenantId: string,
    offeringIds: readonly string[],
    client: DbClient = prisma
  ) {
    if (offeringIds.length === 0) {
      return [];
    }

    return client.openElectiveAllocation.groupBy({
      by: ["offeringId"],
      where: {
        tenantId,
        offeringId: { in: [...offeringIds] },
        outcome: SEAT_CONSUMING_OUTCOME,
      },
      _count: { _all: true },
    });
  }

  /** Every allocation verdict for one offering — the allocation report. */
  async findAllocations(tenantId: string, offeringId: string, client: DbClient = prisma) {
    return client.openElectiveAllocation.findMany({
      where: { tenantId, offeringId },
      select: ALLOCATION_SELECT,
      orderBy: [{ outcome: "asc" }, { preferenceRank: "asc" }, { id: "asc" }],
    });
  }

  /** One student's allocation verdicts across a semester's offerings. */
  async findStudentAllocations(
    tenantId: string,
    studentId: string,
    semesterId: string,
    client: DbClient = prisma
  ) {
    return client.openElectiveAllocation.findMany({
      where: { tenantId, studentId, offering: { semesterId } },
      select: { ...ALLOCATION_SELECT, offering: { select: OFFERING_SELECT } },
      orderBy: [{ preferenceRank: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Write a run's verdicts.
   *
   * `createMany` rather than one create per student: a five-hundred-student
   * cohort is one statement. The service supplies the rows — including the
   * NOT_ALLOCATED ones, which are written rather than omitted because a student
   * who asked and was refused is the most important row in a report.
   *
   * COST: one statement.
   */
  async createAllocations(
    rows: readonly AllocationInput[],
    client: DbClient
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const created = await client.openElectiveAllocation.createMany({ data: [...rows] });

    return created.count;
  }

  /**
   * Clear an offering's verdicts so a run may be repeated.
   *
   * Exists because @@unique([offeringId, studentId]) means a second run cannot
   * accumulate a second verdict beside the first. WHETHER a re-run is permitted
   * is a lifecycle rule and therefore the service's; this only makes it
   * possible.
   *
   * COST: one statement.
   */
  async deleteAllocations(tenantId: string, offeringId: string, client: DbClient) {
    const deleted = await client.openElectiveAllocation.deleteMany({
      where: { tenantId, offeringId },
    });

    return deleted.count;
  }

  /**
   * Run work inside one interactive transaction.
   *
   * Exposed so the service can make an allocation atomic without this file
   * knowing what atomicity it needs. Mirrors CourseRegistrationRepository's own
   * `transaction` helper rather than introducing a second way to do it.
   */
  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => fn(tx));
  }
}

// --- Input and row shapes ---------------------------------------------------
//
// Declared STRUCTURALLY rather than imported as the validation module's
// inferred types, so the repository depends on the shape it needs rather than
// on a Zod schema — an optional field added to a schema then cannot silently
// change a query.

/** Filters the offering catalogue accepts. */
export interface OfferingFilters {
  readonly page: number;
  readonly limit: number;
  readonly semesterId?: string;
  readonly status?: OpenElectiveStatus;
  readonly departmentId?: string;
  readonly courseId?: string;
}

/** One preference row to write. */
export interface PreferenceInput {
  readonly offeringId: string;
  readonly preferenceRank: number;
  readonly submittedAt: Date;
}

/** One allocation verdict to write. */
export interface AllocationInput {
  readonly tenantId: string;
  readonly offeringId: string;
  readonly studentId: string;
  readonly preferenceRank: number;
  readonly outcome: ElectiveAllocationOutcome;
  readonly courseRegistrationId?: string | null;
  readonly allocatedAt: Date;
}

export type OfferingRow = Prisma.OpenElectiveOfferingGetPayload<{
  select: typeof OFFERING_SELECT;
}>;

export type EligibilityRow = Prisma.OpenElectiveEligibilityGetPayload<{
  select: typeof ELIGIBILITY_SELECT;
}>;

export type PreferenceRow = Prisma.OpenElectivePreferenceGetPayload<{
  select: typeof PREFERENCE_SELECT;
}>;

export type AllocationRow = Prisma.OpenElectiveAllocationGetPayload<{
  select: typeof ALLOCATION_SELECT;
}>;

export const openElectiveRepository = new OpenElectiveRepository();

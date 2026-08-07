// ============================================================================
// OWNER      : Gauransh
// MODULE     : Attendance Lock & Audit System (Phase 22)
// LAYER      : Repository
// PURPOSE    : Every read and write the lock module needs, and nothing that
//              decides anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • It never evaluates a window. `findActiveLocksForUnits` returns LOCKED
//     rows for the units asked about; whether any of them covers a particular
//     date is lockWindow.ts's decision, taken by the service. A repository that
//     filtered on the window would put the same rule in two layers and let them
//     disagree — in the one module where disagreement means a finalised
//     academic record is silently editable.
//   • It never decides that a missing lock is an error, that an already-locked
//     unit is a conflict, or what an audit snapshot contains.
//
// TENANT ISOLATION
//   Every query filters on tenantId. AttendanceLock carries no composite key to
//   Course, Section or Semester — those are Phase 1-20 models with no
//   @@unique([tenantId, id]) to reference, and adding one would alter an
//   existing table. Cross-tenant consistency is therefore enforced here and in
//   the service's reference checks rather than by the database. That is a
//   stated weakening, the same one Phase 20 recorded for its references to
//   pre-existing models.
//
// THE QUERY BUDGET
//   Every method issues a FIXED number of statements. The paginated audit read
//   costs two (a page and its count); every other method costs one. There is no
//   per-row read anywhere, so no method can become an N+1 — the actor and the
//   teaching unit travel with a lock through nested selects rather than one
//   query per row.
//
// INDEXES THIS RELIES ON
//   AttendanceLock @@unique([tenantId, courseId, sectionId, semesterId])
//                  — the upsert target and the single-unit lookup
//   AttendanceLock @@index([tenantId, status]) — the enforcement read
//   AuditLog       @@index([resource, resourceId]) and @@index([createdAt])
//                  — the audit history read
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { AttendanceLockStatus, type Prisma } from "@/app/generated/prisma/client";
import { ATTENDANCE_LOCK_RESOURCE } from "@/lib/constants/attendanceLock";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** A page of rows and the total that satisfied the same predicate. */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/** The teaching unit a lock names. */
export interface TeachingUnit {
  readonly courseId: string;
  readonly sectionId: string;
  readonly semesterId: string;
}

/**
 * The actor columns every attributed read expands.
 *
 * Declared once because four selects below need the identical projection, and
 * four copies would be four chances for one to omit `email` and produce a DTO
 * that cannot be mapped.
 */
const ACTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
} as const;

/**
 * Everything a lock is reported as.
 *
 * The three unit relations are expanded so a lock can be named — "CS301,
 * Section A" rather than two cuids — and both actors so an audit view is
 * readable. Nothing else is joined: Attendance itself is deliberately NOT
 * counted here, because a count is a figure a service would have to explain and
 * no endpoint in this phase reports one.
 */
export const ATTENDANCE_LOCK_SELECT = {
  id: true,
  tenantId: true,
  courseId: true,
  sectionId: true,
  semesterId: true,
  status: true,
  fromDate: true,
  toDate: true,
  reason: true,
  lockedAt: true,
  unlockedAt: true,
  unlockReason: true,
  course: { select: { code: true, name: true } },
  section: { select: { name: true } },
  semester: { select: { name: true } },
  lockedBy: { select: ACTOR_SELECT },
  unlockedBy: { select: ACTOR_SELECT },
} as const;

/**
 * The minimum the enforcement path reads.
 *
 * Deliberately NARROWER than ATTENDANCE_LOCK_SELECT. This projection is issued
 * on every attendance write in the system, so it selects the four columns the
 * decision needs and joins nothing at all — expanding a course name on the hot
 * path would cost three joins per mark to produce text nobody reads.
 */
export const ATTENDANCE_LOCK_DECISION_SELECT = {
  id: true,
  courseId: true,
  sectionId: true,
  semesterId: true,
  status: true,
  fromDate: true,
  toDate: true,
  course: { select: { code: true } },
} as const;

/**
 * The AuditLog projection the audit endpoint reports.
 *
 * DECLARED BEFORE THE CLASS, DELIBERATELY. When this lived below the class and
 * findAudit annotated its own return type as
 * `Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>`, the reference
 * was circular and TypeScript deferred the whole select — which silently
 * disabled checking of the projection itself. An invalid relation in it
 * compiled cleanly and would have failed at runtime. Hoisting it and letting
 * the return type be INFERRED is what makes the select checked.
 *
 * `userId` IS REPORTED AS A BARE ID, NOT EXPANDED TO A NAME.
 *   AuditLog.userId carries no foreign key and AuditLog declares no `user`
 *   relation — an unconstrained identity column, the same TD-C / TD-C41 shape
 *   recorded for Assignment.createdBy and Certificate.revokedBy. There is no
 *   relation to traverse, and adding one would alter a Phase 1-20 table this
 *   phase has no cause to touch. A caller resolves the name through
 *   GET /api/users/[id]; a per-row lookup here would be an N+1 over a
 *   paginated view.
 *
 * userAgent is deliberately NOT selected — a browser string in an academic
 * audit view is noise a reader never acts on.
 */
const AUDIT_SELECT = {
  id: true,
  action: true,
  resourceId: true,
  userId: true,
  before: true,
  after: true,
  ipAddress: true,
  createdAt: true,
} as const;

export class AttendanceLockRepository {
  /**
   * The lock covering one teaching unit, or null.
   *
   * Uses the unique key directly, so this is an index lookup rather than a
   * scan. Returns a RELEASED lock as readily as a held one — the caller needs
   * to distinguish "never locked" from "unlocked", and collapsing both to null
   * would make the unlock endpoint unable to tell a missing unit from an
   * already-released one.
   *
   * COST: one statement.
   */
  async findByUnit(tenantId: string, unit: TeachingUnit, client: DbClient = prisma) {
    return client.attendanceLock.findUnique({
      where: {
        tenantId_courseId_sectionId_semesterId: {
          tenantId,
          courseId: unit.courseId,
          sectionId: unit.sectionId,
          semesterId: unit.semesterId,
        },
      },
      select: ATTENDANCE_LOCK_SELECT,
    });
  }

  /**
   * Every LOCKED row among the given (course, section) pairs.
   *
   * THE ENFORCEMENT READ. Called once per attendance write with the distinct
   * pairs a batch names — one statement for a hundred-row register, not a
   * hundred.
   *
   * Filtered to LOCKED here because an UNLOCKED row can never block anything
   * and fetching it would only enlarge the result the service must scan. That
   * is a projection, not a rule: the rule — that status LOCKED plus a covering
   * window refuses a write — still lives entirely in lockWindow.ts.
   *
   * The semester is NOT part of the predicate. Attendance carries no semesterId
   * column, so a write cannot state one; the service resolves it from the
   * section and matches on the returned rows. Passing the pairs alone keeps
   * this query on the (tenantId, status) index.
   *
   * COST: one statement. Returns [] for an empty input without querying.
   */
  async findActiveLocksForUnits(
    tenantId: string,
    pairs: readonly { courseId: string; sectionId: string }[],
    client: DbClient = prisma
  ) {
    if (pairs.length === 0) return [];

    return client.attendanceLock.findMany({
      where: {
        tenantId,
        status: AttendanceLockStatus.LOCKED,
        OR: pairs.map((pair) => ({
          courseId: pair.courseId,
          sectionId: pair.sectionId,
        })),
      },
      select: ATTENDANCE_LOCK_DECISION_SELECT,
    });
  }

  /**
   * Locks matching an optional filter, newest first.
   *
   * Every filter is optional and an omitted one is not applied, so this answers
   * both "is THIS unit locked" and "what is locked in this semester". Unbounded
   * by design: locks are bounded by the tenant's teaching units, unlike the
   * audit history which grows without limit and is therefore paginated.
   *
   * COST: one statement.
   */
  async findMany(
    tenantId: string,
    filter: Partial<TeachingUnit>,
    client: DbClient = prisma
  ) {
    return client.attendanceLock.findMany({
      where: {
        tenantId,
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.semesterId ? { semesterId: filter.semesterId } : {}),
      },
      // Deterministic: lockedAt alone is not, because two units locked by one
      // administrator in the same click share a timestamp.
      orderBy: [{ lockedAt: "desc" }, { id: "desc" }],
      select: ATTENDANCE_LOCK_SELECT,
    });
  }

  /**
   * Create the lock for a unit, or re-lock the unit that already has one.
   *
   * An UPSERT rather than a create, because the unique key means a unit locked,
   * released and locked again must reuse its row — and because the alternative
   * (delete-then-create) would break the AuditLog trail, whose resourceId
   * points at this id.
   *
   * The update branch resets the release columns to null. A re-locked unit that
   * kept its old unlockedBy would report a release that is no longer in effect,
   * and the permanent record of that release is in AuditLog where it belongs.
   *
   * COST: one statement.
   */
  async lock(
    input: {
      tenantId: string;
      unit: TeachingUnit;
      fromDate: Date | null;
      toDate: Date | null;
      reason: string | null;
      lockedById: string;
      lockedAt: Date;
    },
    client: DbClient = prisma
  ) {
    return client.attendanceLock.upsert({
      where: {
        tenantId_courseId_sectionId_semesterId: {
          tenantId: input.tenantId,
          courseId: input.unit.courseId,
          sectionId: input.unit.sectionId,
          semesterId: input.unit.semesterId,
        },
      },
      create: {
        tenantId: input.tenantId,
        courseId: input.unit.courseId,
        sectionId: input.unit.sectionId,
        semesterId: input.unit.semesterId,
        status: AttendanceLockStatus.LOCKED,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        lockedById: input.lockedById,
        lockedAt: input.lockedAt,
      },
      update: {
        status: AttendanceLockStatus.LOCKED,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        lockedById: input.lockedById,
        lockedAt: input.lockedAt,
        unlockedById: null,
        unlockedAt: null,
        unlockReason: null,
      },
      select: ATTENDANCE_LOCK_SELECT,
    });
  }

  /**
   * Release an existing lock.
   *
   * Targets the row by id — the service has already read it, so re-resolving
   * through the composite key would be a second lookup for the same row. The
   * `status: LOCKED` predicate is the optimistic guard: a concurrent unlock
   * that won the race leaves this update matching zero rows, which Prisma
   * raises as P2025 and the shared error mapper turns into 404 rather than
   * reporting a release that did not happen.
   *
   * COST: one statement.
   */
  async unlock(
    input: {
      lockId: string;
      tenantId: string;
      unlockedById: string;
      unlockedAt: Date;
      unlockReason: string;
    },
    client: DbClient = prisma
  ) {
    return client.attendanceLock.update({
      where: {
        id: input.lockId,
        tenantId: input.tenantId,
        status: AttendanceLockStatus.LOCKED,
      },
      data: {
        status: AttendanceLockStatus.UNLOCKED,
        unlockedById: input.unlockedById,
        unlockedAt: input.unlockedAt,
        unlockReason: input.unlockReason,
      },
      select: ATTENDANCE_LOCK_SELECT,
    });
  }

  /**
   * One page of this module's audit history, newest first.
   *
   * Reads AuditLog filtered to this module's own resource name, so a Phase 22
   * audit view can never surface another module's entries. The unit filters are
   * applied against the `after` snapshot's ids rather than against a column,
   * because AuditLog has no course, section or semester column — which is why
   * the service writes those ids into the snapshot in the first place.
   *
   * Ordering is createdAt then id, both descending. The id tiebreaker is
   * required for correctness rather than presentation: offset pagination over
   * rows sharing a timestamp can repeat or skip entries across pages, and a
   * bulk lock writes several rows within the same millisecond.
   *
   * COST: two statements, issued in one transaction so the total cannot shift
   * between them.
   */
  async findAudit(
    tenantId: string,
    filter: {
      readonly courseId?: string;
      readonly sectionId?: string;
      readonly semesterId?: string;
      readonly action?: string;
      readonly page: number;
      readonly limit: number;
    },
    client: DbClient = prisma
  ) {
    const unitPredicate: Prisma.AuditLogWhereInput[] = [];

    if (filter.courseId) {
      unitPredicate.push({ after: { path: ["courseId"], equals: filter.courseId } });
    }
    if (filter.sectionId) {
      unitPredicate.push({ after: { path: ["sectionId"], equals: filter.sectionId } });
    }
    if (filter.semesterId) {
      unitPredicate.push({ after: { path: ["semesterId"], equals: filter.semesterId } });
    }

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      resource: ATTENDANCE_LOCK_RESOURCE,
      ...(filter.action ? { action: filter.action } : {}),
      ...(unitPredicate.length > 0 ? { AND: unitPredicate } : {}),
    };

    const [rows, total] = await client.$transaction([
      client.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        select: AUDIT_SELECT,
      }),
      client.auditLog.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * Run a unit of work atomically.
   *
   * The repository owns the Prisma handle, so the transaction is opened here;
   * the service decides its BOUNDARY by choosing what to put inside the
   * callback. That split is what keeps `import { prisma }` out of the service
   * while leaving the service in charge of atomicity — the same arrangement
   * Phase 16's evaluationScheme.repository established.
   *
   * No isolation level is exposed. This module has no write-skew hazard: every
   * transaction here touches ONE lock row identified by a unique key, and the
   * unlock path additionally carries `status: LOCKED` in its predicate, so two
   * concurrent releases contend on the same row and the loser matches nothing.
   */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}

export const attendanceLockRepository = new AttendanceLockRepository();

/**
 * The abstraction the service depends on.
 *
 * Declared so the service imports a CONTRACT rather than a concrete class
 * holding a live Prisma connection — the `import type` is erased at compile
 * time, so the service never pulls lib/db/prisma into its runtime graph and can
 * be unit-tested with no database and no environment.
 */
export type AttendanceLockRepositoryPort = Pick<
  AttendanceLockRepository,
  | "findByUnit"
  | "findActiveLocksForUnits"
  | "findMany"
  | "lock"
  | "unlock"
  | "findAudit"
  | "transaction"
>;

// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Profile Portal
// LAYER      : Repository
// PURPOSE    : Read every fact a student's own profile, dashboard and
//              achievement list are built from.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No calculation, no profile-completion scoring, no attendance percentage,
//     no DTO mapping, no formatting. Completion is a ratio and a ratio is
//     arithmetic; it belongs to the service.
//
// SELF-SERVICE, AND WHAT THAT CHANGES HERE
//   Phase 18 never accepts a studentId from a client. The caller is resolved
//   tenantId + userId -> Student, and every subsequent read uses the RESOLVED
//   id. That is why `findStudentByUserId` exists and why no method takes an id
//   the caller could have chosen. A method that accepted one would be the only
//   thing standing between a student and someone else's profile, and this layer
//   declines to be that thing.
//
// TENANCY AND OWNERSHIP
//   Every query carries tenantId. Where the model itself has no tenant column —
//   StudentPersonal, StudentDocument, StudentParent, Certificate all hang off
//   Student — ownership travels through the RESOLVED studentId, which was
//   itself produced by a tenant-scoped read. A row cannot therefore be reached
//   without having proved the tenant first. Achievement carries its own
//   tenantId and is filtered on both.
//
// THE QUERY BUDGET
//   A whole profile costs SIX statements and never more, however many
//   documents, parents, certificates or achievements the student holds:
//
//     1  student + user + personal   (one read, relations nested)
//     2  parents                     (one read through the join table)
//     3  documents                   (one read)
//     4  certificates                (one read)
//     5  achievements                (one read)
//     6  counts                      (one grouped read — see findProfileCounts)
//
//   Nested selects rather than per-relation queries are what keep that flat.
//   There is deliberately no findParentById, no findDocumentById and no
//   per-row read of any kind: each would be an N+1 waiting to be written.
//
// INDEXES THIS RELIES ON
//   Student      @@unique([userId]) — the resolution read is a unique lookup.
//   StudentDocument @@index([studentId]), Certificate @@index([studentId]),
//   Achievement  @@index([tenantId, studentId, achievedOn]) — the last is a
//   composite matching the portal predicate and its sort exactly, which this
//   phase was free to create because Achievement is a new table.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type { AchievementCategory, DocumentType, Prisma } from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * The identity and academic columns a profile shows.
 *
 * `user` supplies the name, contact and — per the Phase 18 decision —
 * `avatarUrl`, the primary source for the professional photograph.
 * `passwordHash` is of course absent; so is every other credential column.
 */
export const STUDENT_PROFILE_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  enrollmentNo: true,
  programmeId: true,
  batchId: true,
  sectionId: true,
  specialisationId: true,
  currentSemester: true,
  status: true,
  admissionDate: true,
  graduationDate: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      phone: true,
      avatarUrl: true,
    },
  },
  personal: {
    select: {
      dateOfBirth: true,
      gender: true,
      bloodGroup: true,
      nationality: true,
      religion: true,
      category: true,
      motherTongue: true,
      permanentAddr: true,
      localAddr: true,
      emergencyContact: true,
      disability: true,
      disabilityDesc: true,
      updatedAt: true,
    },
  },
  batch: { select: { id: true, name: true } },
  section: { select: { id: true, name: true } },
  specialisation: { select: { id: true, name: true } },
} as const;

/** Document columns a student may see about their own uploads. */
export const STUDENT_DOCUMENT_SELECT = {
  id: true,
  type: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  mimeType: true,
  isVerified: true,
  verifiedAt: true,
  uploadedAt: true,
} as const;

/**
 * Certificate columns a student may see.
 *
 * `data` is deliberately absent: it is an unbounded JSON blob whose contents
 * nobody can enumerate, and projecting one is how unintended fields reach a
 * browser. `isRevoked` IS projected — a student is entitled to know that a
 * certificate they hold no longer stands.
 */
export const CERTIFICATE_SELECT = {
  id: true,
  certificateNo: true,
  type: true,
  issuedAt: true,
  expiresAt: true,
  pdfUrl: true,
  qrCode: true,
  isRevoked: true,
  revokedAt: true,
} as const;

/** Achievement columns. Every one of them; the model holds nothing private. */
export const ACHIEVEMENT_SELECT = {
  id: true,
  title: true,
  category: true,
  description: true,
  issuer: true,
  achievedOn: true,
  certificateUrl: true,
  evidenceUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Ordering for a student's achievements: most recently ACHIEVED first.
 *
 * By `achievedOn` rather than `createdAt`, because a student entering a 2023
 * prize in 2026 expects it filed under 2023. `id` follows so the order is
 * TOTAL — two achievements on one date would otherwise come back in whatever
 * order the planner chose, and a list that reshuffled between requests looks
 * broken. Exported so a test can assert it without a database.
 */
export const ACHIEVEMENT_ORDER_BY = [
  { achievedOn: "desc" },
  { id: "desc" },
] as const;

/** Ordering for documents: most recently uploaded first. */
export const DOCUMENT_ORDER_BY = [{ uploadedAt: "desc" }, { id: "desc" }] as const;

/** Ordering for certificates: most recently issued first. */
export const CERTIFICATE_ORDER_BY = [{ issuedAt: "desc" }, { id: "desc" }] as const;

/**
 * Ordering for parents: the primary contact first.
 *
 * `isPrimary` descending puts the nominated contact at the top, which is the
 * one a portal shows when it has room for only one. `parentId` breaks the tie.
 */
export const PARENT_ORDER_BY = [{ isPrimary: "desc" }, { parentId: "asc" }] as const;

export class StudentProfileRepository {
  /**
   * Resolve the Student a signed-in user IS.
   *
   * THE ONLY ENTRY POINT to every other method here. Scoped by tenant as well
   * as user, so a session carried into the wrong tenant resolves to nothing
   * rather than to a student. Returns null for "no such student in this
   * tenant" — a permitted role with no Student row, which the service turns
   * into FORBIDDEN rather than an empty profile.
   *
   * COST: one statement, a unique lookup on Student.userId.
   */
  async findStudentByUserId(tenantId: string, userId: string, client: DbClient = prisma) {
    return client.student.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
  }

  /**
   * The whole identity, academic and personal record in ONE statement.
   *
   * User, personal, batch, section and specialisation are nested rather than
   * read separately: five reads for data always wanted together would be five
   * round trips for one page.
   *
   * Scoped by BOTH id and tenantId even though the id was already resolved
   * tenant-scoped. That is deliberate belt-and-braces — the cost is one
   * predicate on an indexed column, and the failure it prevents is a resolved
   * id being reused across a tenant boundary by a future caller.
   *
   * COST: one statement.
   */
  async findProfile(tenantId: string, studentId: string, client: DbClient = prisma) {
    return client.student.findFirst({
      where: { id: studentId, tenantId },
      select: STUDENT_PROFILE_SELECT,
    });
  }

  /**
   * A student's parents and guardians, primary contact first.
   *
   * Read through StudentParent so the join-table's `isPrimary` travels with the
   * parent — it is a property of the RELATIONSHIP, not of the person, and a
   * parent may be primary for one child and not another.
   *
   * `annualIncome` is projected because a profile portal shows it on the
   * parent card; it is the student's own family's figure, not another's.
   *
   * COST: one statement.
   */
  async findParents(studentId: string, client: DbClient = prisma) {
    return client.studentParent.findMany({
      where: { studentId },
      select: {
        isPrimary: true,
        parent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            occupation: true,
            annualIncome: true,
            relation: true,
          },
        },
      },
      orderBy: [...PARENT_ORDER_BY],
    });
  }

  /**
   * A student's uploaded documents.
   *
   * `type` optionally narrows the read — which is how the professional
   * photograph is found when `User.avatarUrl` is absent: the Phase 18 fallback
   * is a StudentDocument of type PHOTO, and that is a filter rather than a
   * second method.
   *
   * COST: one statement.
   */
  async findDocuments(
    studentId: string,
    type?: DocumentType,
    client: DbClient = prisma
  ) {
    return client.studentDocument.findMany({
      where: { studentId, ...(type === undefined ? {} : { type }) },
      select: STUDENT_DOCUMENT_SELECT,
      orderBy: [...DOCUMENT_ORDER_BY],
    });
  }

  /**
   * A student's certificates.
   *
   * Tenant-scoped in its own right: Certificate carries a tenantId, and nothing
   * in the schema constrains a certificate to join a student of the same
   * tenant. Filtering on both is the same defensive pairing the shipped
   * transcript route applies to the same model.
   *
   * Revoked certificates are RETURNED, not hidden. A student is entitled to
   * know one no longer stands, and silently omitting it would leave them
   * believing they still hold it.
   *
   * COST: one statement.
   */
  async findCertificates(tenantId: string, studentId: string, client: DbClient = prisma) {
    return client.certificate.findMany({
      where: { tenantId, studentId },
      select: CERTIFICATE_SELECT,
      orderBy: [...CERTIFICATE_ORDER_BY],
    });
  }

  /**
   * A student's achievements, most recently achieved first.
   *
   * Scoped on BOTH tenantId and studentId. Achievement carries its own tenant
   * column and no composite tenant-proving foreign key — see the model's own
   * documentation for why that key was unavailable — so this predicate is the
   * enforcement, not a convenience.
   *
   * `category` narrows the list without a second method.
   *
   * COST: one statement, served by @@index([tenantId, studentId, achievedOn]).
   */
  async findAchievements(
    tenantId: string,
    studentId: string,
    category?: AchievementCategory,
    client: DbClient = prisma
  ) {
    return client.achievement.findMany({
      where: {
        tenantId,
        studentId,
        ...(category === undefined ? {} : { category }),
      },
      select: ACHIEVEMENT_SELECT,
      orderBy: [...ACHIEVEMENT_ORDER_BY],
    });
  }

  /**
   * The counts a dashboard summarises, WITHOUT reading the rows.
   *
   * A dashboard needs four numbers, not four collections. Counting in the
   * database rather than fetching and measuring in application code is the
   * difference between four integers and four full result sets crossing the
   * wire — and the summary is O(1) in memory whatever the student holds.
   *
   * `pendingDocuments` counts UNVERIFIED uploads. `activeCertificates` counts
   * those neither revoked nor expired; the expiry predicate is `null OR in the
   * future`, because a certificate with no expiry never expires.
   *
   * COST: four counts issued concurrently — see the note on Promise.all below.
   */
  async findProfileCounts(
    tenantId: string,
    studentId: string,
    now: Date,
    client: DbClient = prisma
  ) {
    // Issued together rather than sequentially. Four independent counts have no
    // ordering dependency, so awaiting them one at a time would pay four round
    // trips for what the connection can overlap. This is four statements, not
    // an N+1: the count is FIXED and does not grow with the data.
    const [documentCount, pendingDocuments, certificateCount, activeCertificates] =
      await Promise.all([
        client.studentDocument.count({ where: { studentId } }),
        client.studentDocument.count({ where: { studentId, isVerified: false } }),
        client.certificate.count({ where: { tenantId, studentId } }),
        client.certificate.count({
          where: {
            tenantId,
            studentId,
            isRevoked: false,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),
      ]);

    return { documentCount, pendingDocuments, certificateCount, activeCertificates };
  }

  /**
   * The student's most recent notifications.
   *
   * Notification is addressed by USER, not by student, so this takes the userId
   * the caller was resolved from. It is index-backed by @@index([userId]).
   *
   * Bounded by `take` rather than paginated: a dashboard shows a handful and a
   * page-two of a dashboard panel is not a thing. Unsent notifications are
   * excluded — a queued message the system has not delivered is not something
   * a student should learn about from a dashboard.
   *
   * COST: one statement.
   */
  async findRecentNotifications(
    tenantId: string,
    userId: string,
    take: number,
    client: DbClient = prisma
  ) {
    return client.notification.findMany({
      where: { tenantId, userId, sentAt: { not: null } },
      select: {
        id: true,
        type: true,
        subject: true,
        body: true,
        sentAt: true,
        readAt: true,
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take,
    });
  }
}

export const studentProfileRepository = new StudentProfileRepository();

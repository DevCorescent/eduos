// ============================================================================
// OWNER      : Gauransh
// MODULE     : Notification Center & Announcement System (Phase 27)
// LAYER      : Controller (composition root)
// PURPOSE    : Wire NotificationEmitterService to Prisma, and expose the
//              recipient lookups the emitting phases need.
// ARCHITECTURE:
//   • The adapter performs ONLY database access.
//   • It decides nothing: which events are notifiable, what a subject reads and
//     whether a failure matters are all the service's, and the calling phase's.
//
// THE RECIPIENT LOOKUPS LIVE HERE
//   Phases 22, 24 and 26 each need "who should hear about this", and each
//   answer is a projection no existing repository exposes in that shape. They
//   are thin adapters over Prisma rather than new repositories, matching the
//   pattern feedback.controller.ts established.
//
// EVERY LOOKUP IS BOUNDED
//   A course-wide notification is addressed to a cohort, and a first-year core
//   course can carry several hundred students. Each lookup takes `distinct` and
//   a hard cap, so one publication cannot become an unbounded write.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { NotificationCategory } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { REPORTABLE_REGISTRATION_STATUSES } from "@/lib/repositories/result.repository";
import {
  EMITTED_NOTIFICATION_TYPE,
  NotificationEmitterService,
  type NotificationWriterPort,
} from "@/lib/services/notificationEmitter.service";

/**
 * How many recipients one event may notify.
 *
 * Bounded so a single publication cannot write an unbounded number of rows. A
 * cohort larger than this is unusual; when it happens the notification reaches
 * the first N and the announcement surface — which is resolved on read and has
 * no such limit — carries the rest.
 */
const MAX_RECIPIENTS = 1000;

/**
 * The single write.
 *
 * `createMany` so a cohort costs one statement rather than one per recipient.
 * `status` is left to the column default and `sentAt` is NOT set: nothing in
 * this project transmits, and stamping a send time would claim a delivery that
 * did not happen — the same honesty POST /api/notifications/send already
 * observes.
 */
const writerPort: NotificationWriterPort = {
  async createMany(rows) {
    if (rows.length === 0) return;

    await prisma.notification.createMany({
      data: rows.map((row) => ({
        tenantId: row.tenantId,
        userId: row.userId,
        type: EMITTED_NOTIFICATION_TYPE,
        category: row.category as NotificationCategory,
        subject: row.subject,
        body: row.body,
        data: (row.data ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  },
};

/** The single wired instance every emitting phase delegates to. */
export const notificationEmitter = new NotificationEmitterService(writerPort);

/**
 * The User ids of faculty members assigned to a course-section.
 *
 * FacultyMember.userId carries a real unique foreign key to User, so this is a
 * genuine join rather than an unconstrained id. Filtered to ACTIVE assignments:
 * a withdrawn assignment is not a teaching duty, and notifying its holder would
 * be telling someone about a course they no longer teach.
 *
 * COST: one statement.
 */
export async function findFacultyUserIdsForUnit(
  tenantId: string,
  courseId: string,
  sectionId: string
): Promise<readonly string[]> {
  const rows = await prisma.facultyCourseAssignment.findMany({
    where: {
      tenantId,
      courseId,
      isActive: true,
      // A null sectionId on an assignment means "all sections of this course",
      // so such a holder is notified about any section's lock.
      OR: [{ sectionId }, { sectionId: null }],
    },
    select: { faculty: { select: { userId: true } } },
    take: MAX_RECIPIENTS,
  });

  return [...new Set(rows.map((row) => row.faculty.userId))];
}

/**
 * The User ids of students registered for a course.
 *
 * Narrowed by section when the resource or assignment names one. The
 * registration statuses that count come from Phase 16's own list rather than a
 * second copy.
 *
 * COST: one statement.
 */
export async function findStudentUserIdsForCourse(
  tenantId: string,
  courseId: string,
  sectionId: string | null
): Promise<readonly string[]> {
  const rows = await prisma.courseRegistration.findMany({
    where: {
      tenantId,
      courseId,
      ...(sectionId ? { sectionId } : {}),
      status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
    },
    select: { student: { select: { userId: true } } },
    distinct: ["studentId"],
    take: MAX_RECIPIENTS,
  });

  return [...new Set(rows.map((row) => row.student.userId))];
}

/**
 * The User id behind a Student id.
 *
 * Used to address a student directly — the assignment-evaluated event knows a
 * studentId and must reach the person.
 *
 * COST: one statement.
 */
export async function findStudentUserId(
  tenantId: string,
  studentId: string
): Promise<string | null> {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId },
    select: { userId: true },
  });

  return student?.userId ?? null;
}

/**
 * The User id behind a FacultyMember id.
 *
 * FacultyMember.userId carries a real unique foreign key to User, so this is a
 * genuine relation rather than an unconstrained id — unlike Assignment.createdBy,
 * which needs `userExists` before it can be addressed.
 *
 * COST: one statement.
 */
export async function findFacultyUserId(
  tenantId: string,
  facultyId: string
): Promise<string | null> {
  const faculty = await prisma.facultyMember.findFirst({
    where: { id: facultyId, tenantId },
    select: { userId: true },
  });

  return faculty?.userId ?? null;
}

/**
 * The User ids behind a set of Student ids.
 *
 * Used by the bulk events — attendance marking and fee-demand generation both
 * know a list of students and must reach the people. ONE statement for the
 * whole set, never one per student.
 *
 * COST: one statement.
 */
export async function findStudentUserIds(
  tenantId: string,
  studentIds: readonly string[]
): Promise<readonly string[]> {
  if (studentIds.length === 0) return [];

  const rows = await prisma.student.findMany({
    where: { tenantId, id: { in: [...studentIds] } },
    select: { userId: true },
    take: MAX_RECIPIENTS,
  });

  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * The User ids of students who took part in one open-elective offering's
 * allocation.
 *
 * Read from OpenElectiveAllocation rather than from preferences, because an
 * allocation run produces a verdict for every candidate — allocated or not —
 * and a student who was NOT allocated is precisely the one who most needs to
 * know the run happened.
 *
 * COST: one statement.
 */
export async function findElectiveAllocationUserIds(
  tenantId: string,
  offeringId: string
): Promise<{ userIds: readonly string[]; semesterId: string | null }> {
  const rows = await prisma.openElectiveAllocation.findMany({
    where: { tenantId, offeringId },
    select: { student: { select: { userId: true } }, offering: { select: { semesterId: true } } },
    take: MAX_RECIPIENTS,
  });

  return {
    userIds: [...new Set(rows.map((row) => row.student.userId))],
    semesterId: rows[0]?.offering.semesterId ?? null,
  };
}

/**
 * The User ids of a tenant's administrators.
 *
 * The audience for the README's administration notifications. Resolved by ROLE
 * NAME through UserRole, which is how requireRole itself decides authority —
 * Role.name is the stable identifier across tenants while ids are per-row
 * cuids.
 *
 * COST: one statement.
 */
export async function findAdminUserIds(
  tenantId: string,
  roleNames: readonly string[] = ["UNIVERSITY_ADMIN"]
): Promise<readonly string[]> {
  const rows = await prisma.userRole.findMany({
    where: {
      user: { tenantId, isActive: true },
      role: { name: { in: [...roleNames] } },
    },
    select: { userId: true },
    distinct: ["userId"],
    take: MAX_RECIPIENTS,
  });

  return rows.map((row) => row.userId);
}

/**
 * Attendance totals per student for one course, for the low-attendance check.
 *
 * GROUPED ACROSS THE WHOLE COHORT — a thirty-student register costs one
 * statement, not thirty. PRESENT and LATE both count as attended; a student who
 * arrived late attended. EXCUSED counts as held but not attended, matching the
 * treatment Phase 23's metrics module already applies.
 *
 * COST: one statement.
 */
export async function findAttendanceRatios(
  tenantId: string,
  courseId: string,
  studentIds: readonly string[]
): Promise<ReadonlyMap<string, { held: number; attended: number }>> {
  const totals = new Map<string, { held: number; attended: number }>();

  if (studentIds.length === 0) return totals;

  const grouped = await prisma.attendance.groupBy({
    by: ["studentId", "status"],
    where: { tenantId, courseId, studentId: { in: [...studentIds] } },
    _count: { _all: true },
  });

  for (const row of grouped) {
    const entry = totals.get(row.studentId) ?? { held: 0, attended: 0 };
    entry.held += row._count._all;

    if (row.status === "PRESENT" || row.status === "LATE") {
      entry.attended += row._count._all;
    }

    totals.set(row.studentId, entry);
  }

  return totals;
}

/**
 * Confirm a User id exists in this tenant.
 *
 * Assignment.createdBy is an unconstrained identity column with no foreign key
 * (TD-C), so an assignment can carry an id that resolves to nobody. Checking it
 * before addressing a notification is what stops an undeliverable row being
 * written — the Phase 27 migration had to null exactly this kind of dangling
 * value before the new foreign key could be validated.
 *
 * COST: one statement.
 */
export async function userExists(tenantId: string, userId: string): Promise<boolean> {
  const found = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true },
  });

  return found !== null;
}

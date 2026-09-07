// ============================================================================
// MODULE : Timetable — Class Scheduling Notifications
// LAYER  : Controller (composition)
// PURPOSE: Turn "a class was scheduled / moved / cancelled" into bell entries
//          for exactly the people affected, without any route having to know
//          how that audience is worked out.
//
// WHY A CONTROLLER RATHER THAN THREE CALLS IN EACH ROUTE
//   POST and PATCH on /api/timetables both need the same audience, resolved the
//   same way, emitted the same way, after their own write has committed. Stated
//   twice it would drift — and the way it drifts is silent: one route notifies
//   the section and the other notifies the course registrations, so half the
//   class never hears about the change.
//
// EVERY FUNCTION HERE IS FIRE-AND-FORGET
//   Each wraps its work in notifyAfterCommit, which swallows and logs. A bell
//   entry that fails to write must never roll back — or appear to roll back —
//   a timetable change that already committed. See notificationEmitter.service
//   for the full reasoning, including why this is not a transactional outbox.
// ============================================================================

import {
  findFacultyUserIdsForUnit,
  findStudentUserIdsForCourse,
  findStudentUserIdsForSection,
  notificationEmitter,
  notifyAfterCommit,
} from "@/lib/controllers/notificationEmitter.controller";

/** The slot a notification is about, already resolved to human labels. */
export interface ScheduledClassNotice {
  readonly tenantId: string;
  readonly slotId: string;
  readonly courseId: string;
  readonly sectionId: string;
  /** The faculty member's own User id, so they hear about their own class. */
  readonly facultyUserId: string | null;
  /** "CS101 — Introduction to Programming", for the subject line. */
  readonly courseLabel: string;
  /** The full period sentence from describeSlot(). */
  readonly description: string;
}

/**
 * Everyone who should hear about a class on this (section, course).
 *
 * THE UNION IS THE POINT. Two relationships express "this class is yours" and
 * neither is complete on its own — see findStudentUserIdsForSection for why.
 * The faculty audience comes from the existing findFacultyUserIdsForUnit, so a
 * co-teacher with an active assignment is told about a colleague's change to a
 * class they share.
 *
 * The lecturer teaching the slot is added explicitly rather than being assumed
 * to hold an assignment: a class may be timetabled before the assignment row
 * exists, which is exactly the state facultyTeaching.ts documents as ordinary
 * at the start of a term.
 *
 * Deduplicated, so a student registered for the course AND sitting in the
 * section receives one notification rather than two.
 *
 * COST: three statements, issued together.
 */
async function audienceFor(notice: ScheduledClassNotice): Promise<string[]> {
  const [registered, inSection, teaching] = await Promise.all([
    findStudentUserIdsForCourse(notice.tenantId, notice.courseId, notice.sectionId),
    findStudentUserIdsForSection(notice.tenantId, notice.sectionId),
    findFacultyUserIdsForUnit(notice.tenantId, notice.courseId, notice.sectionId),
  ]);

  return [
    ...new Set([
      ...registered,
      ...inSection,
      ...teaching,
      ...(notice.facultyUserId ? [notice.facultyUserId] : []),
    ]),
  ];
}

/** Announce a newly scheduled class. Never throws. */
export async function notifyClassScheduled(
  scope: string,
  notice: ScheduledClassNotice
): Promise<void> {
  await notifyAfterCommit(scope, async () => {
    await notificationEmitter.classScheduled({
      tenantId: notice.tenantId,
      recipientUserIds: await audienceFor(notice),
      slotId: notice.slotId,
      courseLabel: notice.courseLabel,
      description: notice.description,
    });
  });
}

/**
 * Announce a moved class. Never throws.
 *
 * The audience is resolved from the slot AS IT NOW IS. When an edit moves a
 * class to a different section, that leaves the old section uninformed — a real
 * limitation, recorded rather than papered over, because notifying both sets
 * would tell the old section about a class that is no longer theirs while
 * calling it a reschedule. Moving a class between sections is better expressed
 * as cancelling one and scheduling another, which this API supports.
 */
export async function notifyClassRescheduled(
  scope: string,
  notice: ScheduledClassNotice & { previousDescription: string }
): Promise<void> {
  await notifyAfterCommit(scope, async () => {
    await notificationEmitter.classRescheduled({
      tenantId: notice.tenantId,
      recipientUserIds: await audienceFor(notice),
      slotId: notice.slotId,
      courseLabel: notice.courseLabel,
      previousDescription: notice.previousDescription,
      description: notice.description,
    });
  });
}

/** Announce a cancelled class. Never throws. */
export async function notifyClassCancelled(
  scope: string,
  notice: ScheduledClassNotice
): Promise<void> {
  await notifyAfterCommit(scope, async () => {
    await notificationEmitter.classCancelled({
      tenantId: notice.tenantId,
      recipientUserIds: await audienceFor(notice),
      slotId: notice.slotId,
      courseLabel: notice.courseLabel,
      description: notice.description,
    });
  });
}

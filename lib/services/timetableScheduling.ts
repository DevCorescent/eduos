// ============================================================================
// MODULE : Timetable — Class Scheduling
// LAYER  : Service (data access + scheduling rules)
// PURPOSE: Answer, in one place, the two questions every scheduling write asks:
//          do the four references belong to this tenant, and does this slot
//          collide with one already on the timetable?
//
// WHY THIS IS ITS OWN MODULE
//   Three endpoints now need identical answers — POST /api/timetables,
//   PATCH /api/timetables/[id], and the faculty path through both. A rule that
//   is stated three times drifts, and a scheduling rule that drifts is worse
//   than one that is absent: the create path refuses a double-booking the edit
//   path then lets through, and the room ends up with two classes in it anyway.
//
// WHY THE ORIGINAL PHASE HAD NO COLLISION CHECK
//   It is documented in lib/validations/timetable.ts and in the route: Timetable
//   declares no unique constraint of any kind, so the database permits the same
//   section booked twice at one time, the same lecturer in two rooms at once and
//   byte-identical duplicate rows. That was the correct call at the time —
//   inventing a scheduling rule the schema did not express would have been
//   guesswork. Class Scheduling states the rule explicitly, so it now belongs
//   here, in the application layer, which is the only layer that can express it:
//   overlap is a range predicate across rows, and no unique index can hold it.
//
// WHY OVERLAP IS COMPUTED IN MEMORY
//   The candidate set is one tenant's ACTIVE slots on ONE weekday that already
//   share a faculty member, a section or a room with the slot being written —
//   bounded by how many periods a day has, so tens of rows at most. Expressing
//   `startA < endB AND startB < endA` as a Prisma predicate is possible but
//   costs a raw fragment and hides the rule inside a query builder; computing it
//   here keeps it readable and testable without a database.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type { DayOfWeek, SessionType } from "@/app/generated/prisma/client";
import { isBefore } from "@/lib/validations/timetable";

/** The scheduling-relevant shape of one slot, whether stored or proposed. */
export interface SlotShape {
  readonly semesterId: string;
  readonly sectionId: string;
  readonly courseId: string;
  readonly facultyId: string;
  readonly day: DayOfWeek;
  readonly startTime: string;
  readonly endTime: string;
  readonly roomNo?: string | null;
  readonly sessionType?: SessionType;
  readonly isActive?: boolean;
}

/**
 * What is wrong with the proposed slot.
 *
 * DUPLICATE is not a double-booking and is not reported alongside the other
 * three. An identical row clashes with itself on every axis, so a naive scan
 * answers "this faculty member already has a class", "this section already has
 * a class" AND "that room is already booked" — three refusals describing one
 * row that is in fact the very class being scheduled. That reads as a
 * scheduling problem to be worked around when the truth is simply that the
 * class is already on the timetable.
 *
 * Timetable declares no unique constraint on any column or combination, so the
 * database permits byte-identical rows; this is the only thing that does not.
 */
export type ConflictKind = "DUPLICATE" | "FACULTY" | "SECTION" | "ROOM";

/** One collision, in the terms the person scheduling the class will recognise. */
export interface ScheduleConflict {
  readonly kind: ConflictKind;
  /** The slot already holding the period. */
  readonly slotId: string;
  /** Ready to show to a user. Names the clash and the period it occupies. */
  readonly message: string;
}

/**
 * Do two half-open time ranges overlap?
 *
 * Half-open — [start, end) — so a class ending at 10:00 and one starting at
 * 10:00 are back-to-back rather than clashing. That is the only reading that
 * makes a normal period grid schedulable at all.
 *
 * Both comparisons go through isBefore so this cannot develop its own idea of
 * what "earlier" means; the schema's zero-padded HH:mm is what makes string
 * comparison equal clock comparison.
 */
export function overlaps(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return isBefore(startA, endB) && isBefore(startB, endA);
}

/** "09:00–10:00 on Monday", for a message a human reads. */
function period(slot: { day: DayOfWeek; startTime: string; endTime: string }): string {
  const day = slot.day.charAt(0) + slot.day.slice(1).toLowerCase();
  return `${slot.startTime}–${slot.endTime} on ${day}`;
}

/**
 * Every clash the proposed slot would create, in a fixed order.
 *
 * INPUT   : the resolved tenant, the slot as it WOULD be after the write, and
 *           — on an edit — the id of the row being changed, which must not be
 *           compared against itself.
 * RETURNS : an empty array when the period is free. Every conflict found is
 *           returned rather than only the first, because a lecturer moving a
 *           class wants to know it clashes on all three counts in one go rather
 *           than discovering them one failed save at a time.
 *
 * A CANCELLED SLOT BLOCKS NOTHING. `isActive: false` is how this product
 * cancels a class, so a cancelled row still occupying its room would make the
 * period permanently unusable. Only active slots are candidates.
 *
 * ROOM MATCHING IS EXACT, and only when a room is named. Timetable.roomNo is
 * free text with no Room model behind it, so "A101" and "a101" are different
 * rooms as far as this system is concerned — the same statement
 * lib/validations/timetable.ts already makes. A slot with no room books no room.
 *
 * COMPLEXITY : one statement. The predicate is narrow enough that the rows come
 *              back bounded by the number of periods in a day.
 */
export async function findScheduleConflicts(
  tenantId: string,
  slot: SlotShape,
  excludeSlotId?: string
): Promise<ScheduleConflict[]> {
  const roomNo = slot.roomNo?.trim() ? slot.roomNo.trim() : null;

  const candidates = await prisma.timetable.findMany({
    where: {
      tenantId,
      day: slot.day,
      isActive: true,
      ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
      // Only rows that could possibly clash. A slot sharing none of the three
      // resources cannot conflict however its times fall.
      OR: [
        { facultyId: slot.facultyId },
        { sectionId: slot.sectionId },
        ...(roomNo ? [{ roomNo }] : []),
      ],
    },
    select: {
      id: true,
      // semesterId, courseId and sessionType are selected for the duplicate
      // comparison alone — the three overlap checks below never read them.
      semesterId: true,
      courseId: true,
      sessionType: true,
      facultyId: true,
      sectionId: true,
      roomNo: true,
      day: true,
      startTime: true,
      endTime: true,
    },
  });

  // The proposed slot's own session type, defaulted the way the column is.
  // Comparing `undefined` against a stored "LECTURE" would make a body that
  // omits the field look different from the row it would create.
  const sessionType = slot.sessionType ?? "LECTURE";

  // An exact duplicate short-circuits everything. Reported ALONE and BEFORE the
  // overlap scan: the row it names is the same class, so adding "and the
  // section is busy then" would be describing this very slot back at the
  // caller. See ConflictKind.
  //
  // Every scheduling column is compared — including semester and course, which
  // no overlap rule reads. Two slots for the same section at the same time
  // teaching DIFFERENT courses are a section clash, not a duplicate, and the
  // messages have to say so.
  const duplicate = candidates.find(
    (candidate) =>
      candidate.semesterId === slot.semesterId &&
      candidate.sectionId === slot.sectionId &&
      candidate.courseId === slot.courseId &&
      candidate.facultyId === slot.facultyId &&
      candidate.day === slot.day &&
      candidate.startTime === slot.startTime &&
      candidate.endTime === slot.endTime &&
      (candidate.roomNo ?? null) === roomNo &&
      candidate.sessionType === sessionType
  );

  if (duplicate) {
    return [
      {
        kind: "DUPLICATE",
        slotId: duplicate.id,
        message: `This exact class is already on the timetable at ${period(duplicate)}.`,
      },
    ];
  }

  const conflicts: ScheduleConflict[] = [];

  for (const candidate of candidates) {
    if (!overlaps(slot.startTime, slot.endTime, candidate.startTime, candidate.endTime)) {
      continue;
    }

    // Precedence is fixed — faculty, then section, then room — so the same
    // clash always reports in the same order regardless of which row the
    // database returned first.
    if (candidate.facultyId === slot.facultyId) {
      conflicts.push({
        kind: "FACULTY",
        slotId: candidate.id,
        message: `This faculty member already has a class at ${period(candidate)}.`,
      });
    }

    if (candidate.sectionId === slot.sectionId) {
      conflicts.push({
        kind: "SECTION",
        slotId: candidate.id,
        message: `This section already has a class at ${period(candidate)}.`,
      });
    }

    if (roomNo && candidate.roomNo === roomNo) {
      conflicts.push({
        kind: "ROOM",
        slotId: candidate.id,
        message: `Room ${roomNo} is already booked at ${period(candidate)}.`,
      });
    }
  }

  return conflicts;
}

/**
 * The four references, each proven to belong to THIS tenant.
 *
 * Existence is not the question. All four columns carry real foreign keys, but a
 * foreign key proves a row exists somewhere — and Timetable.tenantId carries no
 * foreign key at all, so nothing in the schema ties a slot to the rows it points
 * at. These four lookups are the only thing that does.
 *
 * RETURNS the human labels alongside, because the notification the students
 * receive has to name a course and a lecturer rather than repeat four cuids —
 * which is exactly what the original POST handler did.
 */
export interface ResolvedReferences {
  readonly semesterName: string;
  readonly sectionName: string;
  readonly courseCode: string;
  readonly courseName: string;
  readonly facultyName: string;
  readonly facultyUserId: string;
}

/**
 * Which reference failed, or the labels for the four that resolved.
 *
 * One field at a time, in the schema's own column order, so a body with several
 * bad references always reports the same one — the precedence the POST handler
 * already applied, kept intact.
 */
export type ReferenceCheck =
  | { ok: true; references: ResolvedReferences }
  | { ok: false; missing: "semester" | "section" | "course" | "faculty" };

/**
 * COMPLEXITY : four reads issued together. None depends on another.
 */
export async function resolveReferences(
  tenantId: string,
  ids: {
    semesterId: string;
    sectionId: string;
    courseId: string;
    facultyId: string;
  }
): Promise<ReferenceCheck> {
  const [semester, section, course, faculty] = await Promise.all([
    prisma.semester.findFirst({
      where: { id: ids.semesterId, tenantId },
      select: { name: true },
    }),
    prisma.section.findFirst({
      where: { id: ids.sectionId, tenantId },
      select: { name: true },
    }),
    prisma.course.findFirst({
      where: { id: ids.courseId, tenantId },
      select: { code: true, name: true },
    }),
    prisma.facultyMember.findFirst({
      where: { id: ids.facultyId, tenantId },
      select: {
        userId: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  if (!semester) return { ok: false, missing: "semester" };
  if (!section) return { ok: false, missing: "section" };
  if (!course) return { ok: false, missing: "course" };
  if (!faculty) return { ok: false, missing: "faculty" };

  return {
    ok: true,
    references: {
      semesterName: semester.name,
      sectionName: section.name,
      courseCode: course.code,
      courseName: course.name,
      facultyName: `${faculty.user.firstName} ${faculty.user.lastName}`.trim(),
      facultyUserId: faculty.userId,
    },
  };
}

/**
 * The one sentence every class-scheduling notification is built from.
 *
 * Stated here rather than in the emitter so the created, rescheduled and
 * cancelled messages cannot describe the same slot three different ways.
 */
export function describeSlot(
  slot: Pick<SlotShape, "day" | "startTime" | "endTime" | "roomNo" | "sessionType">,
  references: Pick<ResolvedReferences, "courseCode" | "courseName" | "facultyName" | "sectionName">
): string {
  const parts = [
    `${references.courseCode} — ${references.courseName}`,
    `Section ${references.sectionName}`,
    period(slot as { day: DayOfWeek; startTime: string; endTime: string }),
  ];

  if (slot.roomNo) parts.push(`Room ${slot.roomNo}`);
  if (slot.sessionType && slot.sessionType !== "LECTURE") parts.push(String(slot.sessionType));
  if (references.facultyName) parts.push(references.facultyName);

  return parts.join(" · ");
}

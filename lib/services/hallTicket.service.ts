// ============================================================================
// OWNER  : Gauransh
// MODULE : Examination — Eligibility and Hall Tickets
// LAYER  : Service
// PURPOSE: Answer "who may sit this examination" from data that already
//          exists, and issue the hall tickets that follow from that answer.
//
// NO SEPARATE EXAMINATION REGISTRATION
//   The cohort for an examination is its course's CourseRegistration rows for
//   the same semester. There is no ExamRegistration model and this service does
//   not invent one: an enrolment in the course IS the registration for its
//   examinations, which is also why a student who withdrew is excluded without
//   any second withdrawal being recorded.
//
// ELIGIBILITY IS DERIVED, HALL TICKETS ARE STORED
//   decideEligibility recomputes from the enrolment and the register on every
//   read, so it can never disagree with them. A hall ticket records that a
//   document was ISSUED — unrecoverable from anything else — so it is a row.
//
// THE RULE THIS SERVICE EXISTS TO ENFORCE
//   A hall ticket is issued ONLY to a student the same function judges
//   eligible. The check is here, on the server, in the same transaction-shaped
//   path as the write; the screen that calls it is a convenience.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { isAttended } from "@/lib/domain/attendance/attended";
import {
  decideEligibility,
  type EligibilityDecision,
} from "@/lib/domain/examination/eligibility";

/** One student's standing for one examination. */
export interface EligibilityRow {
  readonly studentId: string;
  readonly enrollmentNo: string;
  readonly studentName: string;
  readonly courseRegistrationId: string;
  readonly registrationStatus: string;
  readonly sessionsHeld: number;
  readonly sessionsAttended: number;
  readonly decision: EligibilityDecision;
  /** The ticket already issued to them, if any. */
  readonly ticketNo: string | null;
  /** The seat allocated on that ticket, if any. */
  readonly seatNo: string | null;
}

export interface ExaminationContext {
  readonly id: string;
  readonly title: string;
  readonly courseId: string;
  readonly semesterId: string;
}

/**
 * Resolve an examination inside the caller's tenant.
 *
 * Tenant-scoped, so an id belonging to another university resolves to null and
 * the route answers 404 — the same answer an unknown id gets, disclosing
 * nothing about what exists elsewhere.
 */
export async function findExamination(
  tenantId: string,
  examinationId: string
): Promise<ExaminationContext | null> {
  return prisma.examination.findFirst({
    where: { id: examinationId, tenantId },
    select: { id: true, title: true, courseId: true, semesterId: true },
  });
}

/**
 * The examination cohort with each student's eligibility.
 *
 * COMPLEXITY: three statements regardless of cohort size — the enrolments, the
 * attendance register grouped by student, and the tickets already issued.
 * Per-student queries would be an N+1 on the one screen most likely to be
 * opened for a full cohort.
 */
export async function listEligibility(
  tenantId: string,
  examination: ExaminationContext
): Promise<EligibilityRow[]> {
  const registrations = await prisma.courseRegistration.findMany({
    where: {
      tenantId,
      courseId: examination.courseId,
      semesterId: examination.semesterId,
    },
    select: {
      id: true,
      studentId: true,
      status: true,
      student: {
        select: {
          enrollmentNo: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (registrations.length === 0) return [];

  const studentIds = registrations.map((row) => row.studentId);

  const [attendance, tickets] = await Promise.all([
    // Grouped in the database rather than counted in memory: the register for a
    // term is far larger than the cohort, and only the two totals are wanted.
    prisma.attendance.groupBy({
      by: ["studentId", "status"],
      where: { tenantId, courseId: examination.courseId, studentId: { in: studentIds } },
      _count: { _all: true },
    }),
    prisma.hallTicket.findMany({
      where: { tenantId, examinationId: examination.id },
      select: { studentId: true, ticketNo: true, seatNo: true },
    }),
  ]);

  const held = new Map<string, number>();
  const attended = new Map<string, number>();

  for (const row of attendance) {
    const count = row._count._all;
    held.set(row.studentId, (held.get(row.studentId) ?? 0) + count);

    // What counts as attended is lib/domain/attendance/attended.ts. This module
    // was the one that had it right, and its reasoning is now recorded there as
    // the rule the analytics and notification paths were corrected to match.
    if (isAttended(row.status)) {
      attended.set(row.studentId, (attended.get(row.studentId) ?? 0) + count);
    }
  }

  const ticketByStudent = new Map(
    tickets.map((t) => [t.studentId, { ticketNo: t.ticketNo, seatNo: t.seatNo }])
  );

  return registrations
    .map((registration) => {
      const sessionsHeld = held.get(registration.studentId) ?? 0;
      const sessionsAttended = attended.get(registration.studentId) ?? 0;

      return {
        studentId: registration.studentId,
        enrollmentNo: registration.student.enrollmentNo,
        studentName: `${registration.student.user.firstName} ${registration.student.user.lastName}`.trim(),
        courseRegistrationId: registration.id,
        registrationStatus: registration.status,
        sessionsHeld,
        sessionsAttended,
        decision: decideEligibility({
          registrationStatus: registration.status,
          sessionsHeld,
          sessionsAttended,
        }),
        ticketNo: ticketByStudent.get(registration.studentId)?.ticketNo ?? null,
        seatNo: ticketByStudent.get(registration.studentId)?.seatNo ?? null,
      };
    })
    .sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo));
}

/**
 * The printed identity of a ticket.
 *
 * Deterministic rather than sequential, so re-issuing produces the same number
 * and no counter has to be configured before a tenant can issue anything. The
 * examination id's tail keeps it unique across examinations; the enrolment
 * number keeps it unique within one. @@unique([tenantId, ticketNo]) is the
 * guarantee, not this function.
 */
export function ticketNumberFor(
  examination: ExaminationContext,
  enrollmentNo: string
): string {
  return `HT-${examination.id.slice(-6).toUpperCase()}-${enrollmentNo}`;
}

export interface IssueResult {
  readonly issuedCount: number;
  readonly alreadyIssuedCount: number;
  readonly ineligibleCount: number;
}

/**
 * Issue hall tickets to every eligible student in the cohort.
 *
 * THE ELIGIBILITY GATE IS HERE, NOT IN THE CALLER.
 *   Rows are filtered by the same decideEligibility the read path uses, so a
 *   request cannot ask for a ticket for an ineligible student by any means —
 *   there is no studentId in the request to manipulate. The endpoint issues
 *   for the COHORT, and the cohort is derived from the examination.
 *
 * IDEMPOTENT.
 *   createMany with skipDuplicates leans on
 *   @@unique([examinationId, studentId]): running it twice issues nothing the
 *   second time and reports it, rather than failing or duplicating.
 */
export async function issueHallTickets(
  tenantId: string,
  examination: ExaminationContext,
  issuedById: string
): Promise<IssueResult> {
  const cohort = await listEligibility(tenantId, examination);

  const eligible = cohort.filter((row) => row.decision.eligible);
  const alreadyIssued = eligible.filter((row) => row.ticketNo !== null).length;

  const pending = eligible.filter((row) => row.ticketNo === null);

  if (pending.length > 0) {
    await prisma.hallTicket.createMany({
      data: pending.map((row) => ({
        tenantId,
        examinationId: examination.id,
        studentId: row.studentId,
        ticketNo: ticketNumberFor(examination, row.enrollmentNo),
        issuedById,
      })),
      skipDuplicates: true,
    });
  }

  return {
    issuedCount: pending.length,
    alreadyIssuedCount: alreadyIssued,
    ineligibleCount: cohort.length - eligible.length,
  };
}

/**
 * The seat label for the nth candidate.
 *
 * A-01 … A-30, B-01 …: a row letter and a padded number, which is what a seat
 * looks like on a real hall plan and sorts correctly as a string.
 */
export function seatLabel(index: number, seatsPerRow = SEATS_PER_ROW): string {
  const row = Math.floor(index / seatsPerRow);
  const position = (index % seatsPerRow) + 1;
  const letter = String.fromCharCode(65 + (row % 26));
  const suffix = row >= 26 ? String(Math.floor(row / 26) + 1) : "";

  return `${letter}${suffix}-${String(position).padStart(2, "0")}`;
}

/** Seats in one row of the hall. A plain constant — no seating plan model. */
export const SEATS_PER_ROW = 30;

export interface AllocateSeatsResult {
  readonly allocatedCount: number;
  readonly alreadyAllocatedCount: number;
}

/**
 * Allocate seats to the issued hall tickets of one examination.
 *
 * DETERMINISTIC
 *   Tickets are ordered by enrolment number and numbered from A-01. The same
 *   cohort always produces the same plan, so an allocation can be re-derived
 *   and checked rather than only trusted.
 *
 * NON-DESTRUCTIVE
 *   A ticket that already carries a seat keeps it. Re-running allocates only
 *   the tickets issued since — which is what happens when a late-eligible
 *   student is added — instead of renumbering a hall whose candidates have
 *   already been told where to sit.
 *
 * NO DUPLICATES
 *   Enforced by @@unique([examinationId, seatNo]), not by this function. Seats
 *   already taken are excluded from the pool before assignment, so the writes
 *   do not rely on the constraint firing; the constraint is what makes the
 *   guarantee true regardless of who writes.
 */
export async function allocateSeats(
  tenantId: string,
  examination: ExaminationContext
): Promise<AllocateSeatsResult> {
  const tickets = await prisma.hallTicket.findMany({
    where: { tenantId, examinationId: examination.id },
    select: { id: true, seatNo: true, student: { select: { enrollmentNo: true } } },
  });

  const taken = new Set(
    tickets.map((ticket) => ticket.seatNo).filter((seat): seat is string => seat !== null)
  );

  const pending = tickets
    .filter((ticket) => ticket.seatNo === null)
    .sort((a, b) => a.student.enrollmentNo.localeCompare(b.student.enrollmentNo));

  if (pending.length === 0) {
    return { allocatedCount: 0, alreadyAllocatedCount: taken.size };
  }

  // Walk the plan from the start and skip anything already occupied, so a
  // second run fills the gaps rather than colliding with the first.
  let cursor = 0;
  const assignments: { id: string; seatNo: string }[] = [];

  for (const ticket of pending) {
    let seat = seatLabel(cursor);

    while (taken.has(seat)) {
      cursor += 1;
      seat = seatLabel(cursor);
    }

    taken.add(seat);
    assignments.push({ id: ticket.id, seatNo: seat });
    cursor += 1;
  }

  // One transaction: a half-seated hall is worse than an unseated one, because
  // the candidates who were told a seat and the ones who were not look the same
  // on the day.
  await prisma.$transaction(
    assignments.map((assignment) =>
      prisma.hallTicket.update({
        where: { id: assignment.id },
        data: { seatNo: assignment.seatNo },
      })
    )
  );

  return {
    allocatedCount: assignments.length,
    alreadyAllocatedCount: taken.size - assignments.length,
  };
}

/** One student's own tickets, newest examination first. */
export async function listStudentHallTickets(tenantId: string, studentId: string) {
  return prisma.hallTicket.findMany({
    where: { tenantId, studentId },
    select: {
      id: true,
      ticketNo: true,
      seatNo: true,
      issuedAt: true,
      examination: {
        select: {
          id: true,
          title: true,
          type: true,
          date: true,
          startTime: true,
          endTime: true,
          venue: true,
          maxMarks: true,
          course: { select: { code: true, name: true } },
          semester: { select: { name: true } },
        },
      },
    },
    orderBy: { issuedAt: "desc" },
  });
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Correction Requests (PRD §13.2)
// LAYER  : Service
// PURPOSE: Own the rules of the correction workflow — who may raise one, who
//          may decide it, and what an approval actually does to the register.
//
// A REQUEST NEVER MUTATES ATTENDANCE. AN APPROVAL DOES.
//   Raising a request writes one row and touches nothing else, so a disputed
//   mark keeps its value until somebody with the authority to change it says so.
//   Approval applies the change and records it; rejection leaves the register
//   exactly as it was and records that too.
//
// WHY THE APPROVAL PATH DOES NOT CONSULT THE LOCK
//   assertWritable guards the ORDINARY write paths — POST /api/attendance and
//   DELETE /api/attendance/[id] — and continues to. It is deliberately NOT
//   applied here: a lock exists to stop casual edits to a finalised register,
//   and if it also blocked the correction workflow then a locked register could
//   never be corrected at all, which is the one thing corrections are for.
//
//   That is not a bypass. The ordinary paths stay closed; this path is
//   explicit, role-restricted to the reviewers who may release a lock anyway,
//   requires a stated reason, cannot be self-approved, and writes an audit
//   entry in the same transaction as the change.
//
// THE CHANGE AND ITS AUDIT ENTRY ARE ONE TRANSACTION
//   Same reasoning as the lock service: an audit entry that survived a rolled
//   back correction would tell an investigator the register was changed when it
//   was not — confidently wrong is worse than silent.
// ============================================================================

import { Prisma } from "@/app/generated/prisma/client";
import type { AttendanceStatus } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/AppError";
import { recordAudit } from "@/lib/services/audit.service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import {
  CORRECTION_REFUSAL,
  CORRECTION_STATUS,
  decideReview,
  isRealChange,
} from "@/lib/domain/attendance-correction/decision";
import { ATTENDANCE_CORRECTION_MESSAGE } from "@/lib/constants/attendanceCorrection";

/** PostgreSQL unique violation — the partial index on one PENDING per record. */
const UNIQUE_VIOLATION = "P2002";

export interface ActorContext {
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface RaiseCorrectionInput {
  readonly attendanceId: string;
  readonly requestedStatus: AttendanceStatus;
  readonly reason: string;
}

const REQUEST_SELECT = {
  id: true,
  tenantId: true,
  attendanceId: true,
  currentStatus: true,
  requestedStatus: true,
  reason: true,
  status: true,
  requestedById: true,
  requestedAt: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNote: true,
  attendance: {
    select: {
      id: true,
      date: true,
      status: true,
      sessionType: true,
      courseId: true,
      sectionId: true,
      student: { select: { id: true, enrollmentNo: true } },
    },
  },
} as const;

/**
 * Raise a correction request against one attendance record.
 *
 * The attendance row is resolved TENANT-SCOPED, so a record id belonging to
 * another university resolves to nothing and is refused as not found —
 * disclosing nothing about what exists elsewhere.
 */
export async function raiseCorrection(
  tenantId: string,
  input: RaiseCorrectionInput,
  actor: ActorContext
) {
  const attendance = await prisma.attendance.findFirst({
    where: { id: input.attendanceId, tenantId },
    select: { id: true, status: true },
  });

  if (attendance === null) {
    throw new AppError(ATTENDANCE_CORRECTION_MESSAGE.ATTENDANCE_NOT_FOUND, 404, "NOT_FOUND");
  }

  // A no-op request would occupy the single pending slot for this record and
  // block a real correction behind it.
  if (!isRealChange(attendance.status, input.requestedStatus)) {
    throw new AppError(ATTENDANCE_CORRECTION_MESSAGE.NO_CHANGE, 422, "VALIDATION_ERROR");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.attendanceCorrectionRequest.create({
        data: {
          tenantId,
          attendanceId: attendance.id,
          // Captured as seen NOW. Reading it at approval time would show
          // whatever it had become, which is the one thing an approver must not
          // have move under them.
          currentStatus: attendance.status,
          requestedStatus: input.requestedStatus,
          reason: input.reason,
          requestedById: actor.userId,
        },
        select: REQUEST_SELECT,
      });

      await recordAudit(
        {
          tenantId,
          actor: { userId: actor.userId, ipAddress: actor.ipAddress, userAgent: actor.userAgent },
          action: AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REQUESTED,
          resource: AUDIT_RESOURCES.ATTENDANCE_CORRECTION,
          resourceId: request.id,
          after: {
            attendanceId: attendance.id,
            currentStatus: attendance.status,
            requestedStatus: input.requestedStatus,
          },
        },
        tx
      );

      return request;
    });

    return created;
  } catch (err) {
    // The partial unique index is the guarantee; this turns it into a message.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      throw new AppError(ATTENDANCE_CORRECTION_MESSAGE.ALREADY_PENDING, 409, "CONFLICT");
    }
    throw err;
  }
}

/** One page of requests, newest first. Optionally narrowed to a status. */
export async function listCorrections(
  tenantId: string,
  status?: string,
  /**
   * When set, only requests RAISED BY this user are returned.
   *
   * WHY THE CALLER DECIDES AND NOT THIS FUNCTION
   *   The queue serves two different readings. A reviewer needs every pending
   *   request in the tenant, because deciding them is their job. A lecturer
   *   needs only their own: they cannot decide any request, so a full queue
   *   would hand them every other lecturer's disputes — the student enrolment
   *   numbers, the reasons given, and which colleagues are recording the
   *   register wrongly. That is a staff-conduct record, not something read
   *   access to one's own corrections should carry with it.
   *
   *   Left undefined this returns the whole tenant, so a caller that forgets to
   *   narrow gets the reviewer's view. The route above therefore sets it from
   *   ATTENDANCE_CORRECTION_REVIEW_ROLES rather than leaving it optional in
   *   practice.
   */
  requestedById?: string
) {
  return prisma.attendanceCorrectionRequest.findMany({
    where: {
      tenantId,
      ...(status === undefined ? {} : { status: status as never }),
      ...(requestedById === undefined ? {} : { requestedById }),
    },
    select: REQUEST_SELECT,
    orderBy: { requestedAt: "desc" },
    take: 100,
  });
}

/**
 * Approve a request and APPLY it, or reject it and change nothing.
 *
 * Both outcomes are one transaction with their audit entry. The request is
 * re-read inside it and its status re-checked, so two reviewers pressing
 * approve at the same moment cannot both apply the change: the second finds it
 * no longer PENDING.
 */
export async function reviewCorrection(
  tenantId: string,
  requestId: string,
  decision: "APPROVE" | "REJECT",
  note: string | undefined,
  actor: ActorContext
) {
  // Rejecting without a reason leaves the requester with nothing to act on.
  if (decision === "REJECT" && (note === undefined || note.trim() === "")) {
    throw new AppError(ATTENDANCE_CORRECTION_MESSAGE.REJECTION_NEEDS_NOTE, 422, "VALIDATION_ERROR");
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.attendanceCorrectionRequest.findFirst({
      where: { id: requestId, tenantId },
      select: {
        id: true,
        status: true,
        requestedById: true,
        attendanceId: true,
        currentStatus: true,
        requestedStatus: true,
      },
    });

    if (request === null) {
      throw new AppError(ATTENDANCE_CORRECTION_MESSAGE.REQUEST_NOT_FOUND, 404, "NOT_FOUND");
    }

    const verdict = decideReview({
      status: request.status,
      requestedById: request.requestedById,
      reviewerId: actor.userId,
    });

    if (!verdict.allowed) {
      throw verdict.reason === CORRECTION_REFUSAL.SELF_REVIEW
        ? new AppError(ATTENDANCE_CORRECTION_MESSAGE.SELF_REVIEW, 403, "FORBIDDEN")
        : new AppError(ATTENDANCE_CORRECTION_MESSAGE.ALREADY_DECIDED, 409, "CONFLICT");
    }

    const approving = decision === "APPROVE";

    // The correction itself. Tenant-scoped again on the write, so the update
    // cannot reach another university's row even if the request were forged.
    if (approving) {
      const applied = await tx.attendance.updateMany({
        where: { id: request.attendanceId, tenantId },
        data: { status: request.requestedStatus },
      });

      // The record was deleted between the request and this approval. Refused
      // rather than silently marking the request approved with nothing applied.
      if (applied.count === 0) {
        throw new AppError(ATTENDANCE_CORRECTION_MESSAGE.ATTENDANCE_NOT_FOUND, 404, "NOT_FOUND");
      }
    }

    const updated = await tx.attendanceCorrectionRequest.update({
      where: { id: request.id },
      data: {
        status: approving ? CORRECTION_STATUS.APPROVED : CORRECTION_STATUS.REJECTED,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
      },
      select: REQUEST_SELECT,
    });

    await recordAudit(
      {
        tenantId,
        actor: { userId: actor.userId, ipAddress: actor.ipAddress, userAgent: actor.userAgent },
        action: approving
          ? AUDIT_ACTIONS.ATTENDANCE_CORRECTION_APPROVED
          : AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REJECTED,
        resource: AUDIT_RESOURCES.ATTENDANCE_CORRECTION,
        resourceId: request.id,
        // before/after describe the REGISTER, which is what an investigator is
        // asking about — not the request row's own status column.
        before: { attendanceId: request.attendanceId, status: request.currentStatus },
        after: {
          attendanceId: request.attendanceId,
          status: approving ? request.requestedStatus : request.currentStatus,
          applied: approving,
        },
      },
      tx
    );

    return updated;
  });
}

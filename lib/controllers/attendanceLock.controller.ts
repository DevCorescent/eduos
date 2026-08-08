// ============================================================================
// OWNER      : Gauransh
// MODULE     : Attendance Lock & Audit System (Phase 22)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no window arithmetic, no Prisma.
//
// THE COMPOSITION ROOT
//   The single place AttendanceLockService is wired to its repository, the
//   shared audit-log repository, and the one narrow port it needs. Every route
//   in this module — AND the two Phase 9 attendance routes that enforce the
//   lock — share this instance, so none can construct a differently-wired one
//   and no two callers can disagree about what "locked" means.
//
// THE ADAPTER BELOW READS EVIDENCE AND DECIDES NOTHING
//   `courseExists` answers whether a row is there. That a missing course is a
//   404 rather than a silently-skipped lock is the SERVICE's rule.
//   `findSectionSemesters` returns the semester each section belongs to; that a
//   section whose semester cannot be resolved is allowed through rather than
//   refused is likewise the service's decision, not a filter applied here.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { attendanceLockRepository } from "@/lib/repositories/attendanceLock.repository";
import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import {
  AttendanceLockService,
  type AttendanceWriteCandidate,
  type AuditContext,
  type TeachingUnitPort,
} from "@/lib/services/attendanceLock.service";
import type { AttendanceLockDto } from "@/lib/dto/attendanceLock.dto";
import type {
  AttendanceAuditQuery,
  LockAttendanceInput,
  LockStatusQuery,
  UnlockAttendanceInput,
} from "@/lib/validations/attendanceLock.validation";

/**
 * Existence checks over the three Phase 1-20 models a lock names, plus the one
 * resolution the enforcement path needs.
 *
 * A thin adapter over Prisma rather than a new repository: these are four
 * projections no existing repository exposes in this shape, and reaching into
 * the course, section and semester repositories would couple this module to
 * three others for four `select: { id: true }` reads. Same reasoning, and same
 * shape, as the adapters in feedback.controller.ts.
 *
 * Every read is scoped by tenantId as well as by id. A foreign key proves
 * existence, never ownership, so an id belonging to another tenant would
 * satisfy the database while breaking isolation.
 */
const unitPort: TeachingUnitPort = {
  async courseExists(tenantId, courseId) {
    const found = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true },
    });
    return found !== null;
  },

  async sectionExists(tenantId, sectionId) {
    const found = await prisma.section.findFirst({
      where: { id: sectionId, tenantId },
      select: { id: true },
    });
    return found !== null;
  },

  async semesterExists(tenantId, semesterId) {
    const found = await prisma.semester.findFirst({
      where: { id: semesterId, tenantId },
      select: { id: true },
    });
    return found !== null;
  },

  async findSectionSemesters(tenantId, sectionIds) {
    if (sectionIds.length === 0) return [];

    // One statement for every section in a batch, not one per section — this
    // sits on the attendance write path and must not become an N+1.
    return prisma.section.findMany({
      where: { id: { in: [...sectionIds] }, tenantId },
      select: { id: true, semesterId: true },
    });
  },
};

/** The single wired instance every caller in this module delegates to. */
const attendanceLockService = new AttendanceLockService(
  attendanceLockRepository,
  auditLogRepository,
  unitPort
);

export class AttendanceLockController {
  /** POST /api/attendance/lock */
  async lock(
    tenantId: string,
    input: LockAttendanceInput,
    context: AuditContext,
    now: Date
  ): Promise<AttendanceLockDto> {
    return attendanceLockService.lock(tenantId, input, context, now);
  }

  /** POST /api/attendance/unlock */
  async unlock(
    tenantId: string,
    input: UnlockAttendanceInput,
    context: AuditContext,
    now: Date
  ): Promise<AttendanceLockDto> {
    return attendanceLockService.unlock(tenantId, input, context, now);
  }

  /** GET /api/attendance/lock-status */
  async getStatus(
    tenantId: string,
    query: LockStatusQuery
  ): Promise<readonly AttendanceLockDto[]> {
    return attendanceLockService.getStatus(tenantId, query);
  }

  /** GET /api/attendance/audit */
  async getAudit(tenantId: string, query: AttendanceAuditQuery) {
    return attendanceLockService.getAudit(tenantId, query);
  }

  /**
   * The enforcement entry point, called by the Phase 9 attendance routes.
   *
   * Exposed on the controller rather than requiring those routes to construct a
   * service, so the enforcement they perform is provably the same enforcement
   * this module's own endpoints describe.
   *
   * Throws AppError(409) when a lock refuses the write; returns silently
   * otherwise. See AttendanceLockService.assertWritable.
   */
  async assertWritable(
    tenantId: string,
    candidates: readonly AttendanceWriteCandidate[]
  ): Promise<void> {
    return attendanceLockService.assertWritable(tenantId, candidates);
  }
}

export const attendanceLockController = new AttendanceLockController();

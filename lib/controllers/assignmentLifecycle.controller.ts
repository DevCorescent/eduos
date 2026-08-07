// ============================================================================
// OWNER      : Gauransh
// MODULE     : Assignment Management Enhancement (Phase 24)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no arithmetic.
//
// THE COMPOSITION ROOT
//   The single place AssignmentLifecycleService is wired to its repository and
//   its one narrow port. Every Phase 24 route shares this instance.
//
// THE ADAPTER BELOW READS EVIDENCE AND DECIDES NOTHING
//   `isRegistered` answers whether a registration row exists. That an
//   unregistered student is refused with 403 rather than silently allowed is
//   the SERVICE's rule. The registration statuses that count as real come from
//   Phase 16's own REPORTABLE_REGISTRATION_STATUSES rather than a second list —
//   "which registrations are real" was answered once and is not re-answered.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { assignmentLifecycleRepository } from "@/lib/repositories/assignmentLifecycle.repository";
import { REPORTABLE_REGISTRATION_STATUSES } from "@/lib/repositories/result.repository";
import {
  AssignmentLifecycleService,
  type AssignmentStudentPort,
} from "@/lib/services/assignmentLifecycle.service";
import type {
  AssignmentAnalyticsDto,
  RosterPageDto,
  RosterStudentDto,
  SubmissionResultDto,
  SubmittedRowDto,
} from "@/lib/dto/assignmentLifecycle.dto";
import type {
  AssignmentAnalyticsQuery,
  AssignmentRosterQuery,
  GradeAssignmentInput,
  SubmitAssignmentInput,
} from "@/lib/validations/assignmentLifecycle.validation";

/**
 * Resolves the caller to the Student they ARE, and reads their registration.
 *
 * Both reads are scoped by tenant as well as by the ids the caller named. A
 * foreign key proves existence, never ownership, so an id belonging to another
 * tenant would satisfy the database while breaking isolation.
 *
 * The section predicate is applied only when the assignment names one: an
 * assignment set for the whole course must accept a student from any section,
 * and one set for Section A must not accept a student from Section B.
 */
const studentPort: AssignmentStudentPort = {
  async findStudentByUserId(tenantId, userId) {
    return prisma.student.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
  },

  async isRegistered(tenantId, studentId, courseId, sectionId) {
    const found = await prisma.courseRegistration.findFirst({
      where: {
        tenantId,
        studentId,
        courseId,
        ...(sectionId ? { sectionId } : {}),
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
      },
      select: { id: true },
    });

    return found !== null;
  },
};

/** The single wired instance every Phase 24 route delegates to. */
const assignmentLifecycleService = new AssignmentLifecycleService(
  assignmentLifecycleRepository,
  studentPort
);

export class AssignmentLifecycleController {
  /** POST /api/assignments/[id]/submit */
  async submit(
    tenantId: string,
    userId: string,
    assignmentId: string,
    input: SubmitAssignmentInput,
    now: Date
  ): Promise<SubmissionResultDto> {
    return assignmentLifecycleService.submit(tenantId, userId, assignmentId, input, now);
  }

  /** GET /api/assignments/[id]/submit — the caller's own submission + history */
  async getOwnSubmission(
    tenantId: string,
    userId: string,
    assignmentId: string
  ): Promise<SubmissionResultDto> {
    return assignmentLifecycleService.getOwnSubmission(tenantId, userId, assignmentId);
  }

  /** PATCH /api/assignments/[id]/grade */
  async grade(
    tenantId: string,
    assignmentId: string,
    input: GradeAssignmentInput,
    gradedBy: string,
    now: Date
  ): Promise<SubmittedRowDto> {
    return assignmentLifecycleService.grade(tenantId, assignmentId, input, gradedBy, now);
  }

  /** GET /api/assignments/[id]/submitted */
  async getSubmitted(
    tenantId: string,
    assignmentId: string,
    query: AssignmentRosterQuery
  ): Promise<RosterPageDto<SubmittedRowDto>> {
    return assignmentLifecycleService.getSubmitted(tenantId, assignmentId, query);
  }

  /** GET /api/assignments/[id]/pending */
  async getPending(
    tenantId: string,
    assignmentId: string,
    query: AssignmentRosterQuery
  ): Promise<RosterPageDto<RosterStudentDto>> {
    return assignmentLifecycleService.getPending(tenantId, assignmentId, query);
  }

  /** GET /api/assignments/analytics */
  async getAnalytics(
    tenantId: string,
    query: AssignmentAnalyticsQuery
  ): Promise<AssignmentAnalyticsDto> {
    return assignmentLifecycleService.getAnalytics(tenantId, query);
  }

  /** DELETE /api/assignments/[id] */
  async deleteAssignment(tenantId: string, assignmentId: string): Promise<void> {
    return assignmentLifecycleService.deleteAssignment(tenantId, assignmentId);
  }
}

export const assignmentLifecycleController = new AssignmentLifecycleController();

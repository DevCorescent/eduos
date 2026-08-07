// ============================================================================
// OWNER      : Gauransh
// MODULE     : Faculty Feedback System
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping, no Prisma, no
//     arithmetic. Every average belongs to the domain engine and every
//     disclosure decision to anonymity.ts.
//
// THE COMPOSITION ROOT
//   The single place FeedbackService is wired to its repository and to the
//   three ports it depends on. Every route shares one instance, so none can
//   construct a differently-wired one — and the collaborators arrive as NARROW
//   PORTS, so feedback handling cannot reach anything on them beyond the one or
//   two methods each it declared.
//
// THE ADAPTERS BELOW READ EVIDENCE AND DECIDE NOTHING
//   `findAssignments` returns FacultyCourseAssignment rows; whether a null
//   semesterId means "any semester" is eligibility.ts's rule, not a filter
//   applied here. `findSessions` returns Timetable rows; that a LAB form needs
//   a LAB session is likewise the domain engine's. An adapter that pre-filtered
//   would be a business rule hiding in a data access shim.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { feedbackRepository } from "@/lib/repositories/feedback.repository";
import {
  FeedbackService,
  type FacultyLookupPort,
  type FeedbackAccess,
  type FeedbackStudentPort,
  type TeachingEvidencePort,
} from "@/lib/services/feedback.service";
import { REPORTABLE_REGISTRATION_STATUSES } from "@/lib/repositories/result.repository";
import type { AggregateSummary, FacultySummary } from "@/lib/domain/feedback/report";
import type { FeedbackSubmissionResultDto } from "@/lib/dto/feedback.dto";
import type {
  FacultyFeedbackQuery,
  FeedbackReportQuery,
  SubmitFeedbackInput,
} from "@/lib/validations/feedback.validation";

/**
 * Resolves a student, and reads what they were registered for.
 *
 * A thin adapter over Prisma rather than a new repository: these are two
 * projections no existing repository exposes in this shape, and a whole
 * repository for two reads would be more surface than the reads justify.
 *
 * The registration statuses come from result.repository's own list rather than
 * a second copy — "which registrations count as real" is one rule, and Phase 16
 * already answered it.
 */
const studentPort: FeedbackStudentPort = {
  async findStudentByUserId(tenantId, userId) {
    return prisma.student.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
  },

  async findRegistrations(tenantId, studentId, semesterId) {
    return prisma.courseRegistration.findMany({
      where: {
        tenantId,
        studentId,
        semesterId,
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
      },
      select: { courseId: true, semesterId: true, sectionId: true },
    });
  },
};

/**
 * Reads the teaching evidence eligibility is decided on.
 *
 * Both reads are deliberately UNFILTERED beyond the tenant and the two ids the
 * caller named: whether a null semesterId matches, and whether a LAB session is
 * required, are rules that live in eligibility.ts. Applying them here would put
 * the same logic in two layers and let them disagree.
 */
const evidencePort: TeachingEvidencePort = {
  async findAssignments(tenantId, facultyId, courseId) {
    return prisma.facultyCourseAssignment.findMany({
      where: { tenantId, facultyId, courseId },
      select: {
        facultyId: true,
        courseId: true,
        sectionId: true,
        semesterId: true,
        isActive: true,
      },
    });
  },

  async findSessions(tenantId, facultyId, courseId, semesterId) {
    return prisma.timetable.findMany({
      where: { tenantId, facultyId, courseId, semesterId },
      select: {
        facultyId: true,
        courseId: true,
        semesterId: true,
        sectionId: true,
        sessionType: true,
        isActive: true,
      },
    });
  },
};

/** Confirms a faculty member exists in this tenant, and nothing more. */
const facultyPort: FacultyLookupPort = {
  async facultyExists(tenantId, facultyId) {
    const found = await prisma.facultyMember.findFirst({
      where: { id: facultyId, tenantId },
      select: { id: true },
    });

    return found !== null;
  },
};

/** The single wired instance every route handler in this module delegates to. */
const feedbackService = new FeedbackService(
  feedbackRepository,
  studentPort,
  evidencePort,
  facultyPort
);

export class FeedbackController {
  /** POST /api/feedback/faculty and POST /api/feedback/lab */
  async submitFeedback(
    tenantId: string,
    userId: string,
    input: SubmitFeedbackInput,
    now: Date
  ): Promise<FeedbackSubmissionResultDto> {
    return feedbackService.submitFeedback(tenantId, userId, input, now);
  }

  /** GET /api/feedback/faculty/[facultyId] */
  async getFacultyFeedback(
    tenantId: string,
    facultyId: string,
    query: FacultyFeedbackQuery,
    access: FeedbackAccess
  ): Promise<FacultySummary> {
    return feedbackService.getFacultyFeedback(tenantId, facultyId, query, access);
  }

  /** GET /api/feedback/report */
  async getReport(
    tenantId: string,
    query: FeedbackReportQuery,
    access: FeedbackAccess
  ): Promise<AggregateSummary> {
    return feedbackService.getReport(tenantId, query, access);
  }
}

export const feedbackController = new FeedbackController();

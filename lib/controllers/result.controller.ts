// ============================================================================
// OWNER      : Gauransh
// MODULE     : Result Reporting
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping, no Prisma.
//
// The controller is the composition root: it is the single place the service is
// wired to its repository, so every route in this module shares one instance
// and no route can accidentally construct a differently-wired one.
// ============================================================================

import { resultRepository } from "@/lib/repositories/result.repository";
import { ResultService, type ResultAccess } from "@/lib/services/result.service";
import type {
  SemesterCohortResultDTO,
  StudentAnalyticsDTO,
  StudentResultDTO,
  TranscriptDTO,
} from "@/lib/dto/result.dto";

/** The single wired instance every route handler in this module delegates to. */
const resultService = new ResultService(resultRepository);

export class ResultController {
  /** GET /api/results/student/[studentId] */
  async getStudentResult(
    tenantId: string,
    studentId: string,
    access: ResultAccess,
    semesterId?: string
  ): Promise<StudentResultDTO> {
    return resultService.getStudentResult(tenantId, studentId, access, semesterId);
  }

  /** GET /api/results/semester/[semesterId] */
  async getSemesterResult(
    tenantId: string,
    semesterId: string
  ): Promise<SemesterCohortResultDTO> {
    return resultService.getSemesterResult(tenantId, semesterId);
  }

  /**
   * POST /api/results/semester/[semesterId]/approve
   *
   * `approvedById` is the authenticated subject, resolved by the route from the
   * session — there is no parameter here a client could supply to attribute the
   * sign-off to somebody else.
   */
  async approveSemesterResult(
    tenantId: string,
    semesterId: string,
    approvedById: string,
    remarks?: string
  ): Promise<SemesterCohortResultDTO> {
    return resultService.approveSemesterResult(tenantId, semesterId, approvedById, remarks);
  }

  /** GET /api/results/transcript/[studentId] */
  async getTranscript(
    tenantId: string,
    studentId: string,
    access: ResultAccess
  ): Promise<TranscriptDTO> {
    return resultService.getTranscript(tenantId, studentId, access);
  }

  /** GET /api/results/analytics/[studentId] */
  async getAnalytics(
    tenantId: string,
    studentId: string,
    access: ResultAccess
  ): Promise<StudentAnalyticsDTO> {
    return resultService.getAnalytics(tenantId, studentId, access);
  }
}

export const resultController = new ResultController();

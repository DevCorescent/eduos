// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Component Score
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping.
//
// NOTE ON `authority`
//   The two upload methods differ ONLY in the MarkUploadAuthority they hand the
//   service — which audit action to record, and whether the caller is confined
//   to sittings they conduct. Deciding WHO holds which authority is the route's
//   job, since it is the layer that ran the role guard; carrying that decision
//   through is orchestration, not logic. The service applies it.
// ============================================================================

import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { studentComponentScoreRepository } from "@/lib/repositories/studentComponentScore.repository";
import {
  StudentComponentScoreService,
  type MarkUploadAuthority,
} from "@/lib/services/studentComponentScore.service";
import type {
  MarksSheetDTO,
  MarkUploadResultDTO,
} from "@/lib/dto/studentComponentScore.dto";
import type { UploadMarksInput } from "@/lib/validations/studentComponentScore";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const studentComponentScoreService = new StudentComponentScoreService(
  studentComponentScoreRepository,
  auditLogRepository
);

export class StudentComponentScoreController {
  /** GET /api/assessment-events/[id]/marks */
  async getMarksSheet(
    tenantId: string,
    assessmentEventId: string,
    departmentId: string | null = null
  ): Promise<MarksSheetDTO> {
    return studentComponentScoreService.getMarksSheet(
      tenantId,
      assessmentEventId,
      departmentId
    );
  }

  /** POST /api/results/internal and POST /api/results/external */
  async upload(
    tenantId: string,
    input: UploadMarksInput,
    authority: MarkUploadAuthority,
    context: RequestContext
  ): Promise<MarkUploadResultDTO> {
    return studentComponentScoreService.upload(tenantId, input, authority, context);
  }
}

export const studentComponentScoreController = new StudentComponentScoreController();

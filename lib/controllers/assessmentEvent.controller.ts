// ============================================================================
// OWNER      : Gauransh
// MODULE     : Assessment Event
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates to the
//              service.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping.
//
// COMPOSITION ROOT
//   Binds the concrete repositories to the service's three ports. The
//   EvaluationScheme repository is passed whole and narrowed by the constructor
//   to a single read method, so scheduling a sitting can verify that a
//   regulation is ACTIVE and provably cannot alter one.
// ============================================================================

import { assessmentEventRepository } from "@/lib/repositories/assessmentEvent.repository";
import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { evaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";
import { AssessmentEventService } from "@/lib/services/assessmentEvent.service";
import type {
  AssessmentEventDTO,
  AssessmentEventListDTO,
} from "@/lib/dto/assessmentEvent.dto";
import type {
  AssessmentEventStatusInput,
  CreateAssessmentEventInput,
  ListAssessmentEventsQuery,
  UpdateAssessmentEventInput,
} from "@/lib/validations/assessmentEvent";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const assessmentEventService = new AssessmentEventService(
  assessmentEventRepository,
  auditLogRepository,
  evaluationSchemeRepository
);

export class AssessmentEventController {
  /** GET /api/assessment-events */
  async list(
    tenantId: string,
    query: ListAssessmentEventsQuery
  ): Promise<AssessmentEventListDTO> {
    return assessmentEventService.list(tenantId, query);
  }

  /** GET /api/assessment-events/[id] */
  async getById(tenantId: string, id: string): Promise<AssessmentEventDTO> {
    return assessmentEventService.getById(tenantId, id);
  }

  /** POST /api/assessment-events */
  async create(
    tenantId: string,
    input: CreateAssessmentEventInput,
    context: RequestContext
  ): Promise<AssessmentEventDTO> {
    return assessmentEventService.create(tenantId, input, context);
  }

  /** PATCH /api/assessment-events/[id] */
  async update(
    tenantId: string,
    id: string,
    input: UpdateAssessmentEventInput,
    context: RequestContext
  ): Promise<AssessmentEventDTO> {
    return assessmentEventService.update(tenantId, id, input, context);
  }

  /** POST /api/assessment-events/[id]/status */
  async changeStatus(
    tenantId: string,
    id: string,
    input: AssessmentEventStatusInput,
    context: RequestContext
  ): Promise<AssessmentEventDTO> {
    return assessmentEventService.changeStatus(tenantId, id, input, context);
  }
}

export const assessmentEventController = new AssessmentEventController();

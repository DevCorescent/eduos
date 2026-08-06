// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Component
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
//   As in the scheme module, this is where the concrete repositories are bound
//   to the service. Assembling an object graph takes no decision, and keeping
//   the binding here is what keeps lib/db/prisma out of the service's runtime
//   graph and the service unit-testable.
// ============================================================================

import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { evaluationComponentRepository } from "@/lib/repositories/evaluationComponent.repository";
import { EvaluationComponentService } from "@/lib/services/evaluationComponent.service";
import type {
  EvaluationComponentDTO,
  EvaluationComponentTreeDTO,
} from "@/lib/dto/evaluationComponent.dto";
import type {
  CreateEvaluationComponentInput,
  UpdateEvaluationComponentInput,
} from "@/lib/validations/evaluationComponent";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const evaluationComponentService = new EvaluationComponentService(
  evaluationComponentRepository,
  auditLogRepository
);

export class EvaluationComponentController {
  /** GET /api/evaluation-schemes/[id]/components */
  async getTree(tenantId: string, schemeId: string): Promise<EvaluationComponentTreeDTO> {
    return evaluationComponentService.getTree(tenantId, schemeId);
  }

  /** GET /api/evaluation-schemes/[id]/components/[componentId] */
  async getById(
    tenantId: string,
    schemeId: string,
    componentId: string
  ): Promise<EvaluationComponentDTO> {
    return evaluationComponentService.getById(tenantId, schemeId, componentId);
  }

  /** POST /api/evaluation-schemes/[id]/components */
  async create(
    tenantId: string,
    schemeId: string,
    input: CreateEvaluationComponentInput,
    context: RequestContext
  ): Promise<EvaluationComponentDTO> {
    return evaluationComponentService.create(tenantId, schemeId, input, context);
  }

  /** PATCH /api/evaluation-schemes/[id]/components/[componentId] */
  async update(
    tenantId: string,
    schemeId: string,
    componentId: string,
    input: UpdateEvaluationComponentInput,
    context: RequestContext
  ): Promise<EvaluationComponentDTO> {
    return evaluationComponentService.update(tenantId, schemeId, componentId, input, context);
  }

  /** DELETE /api/evaluation-schemes/[id]/components/[componentId] */
  async remove(
    tenantId: string,
    schemeId: string,
    componentId: string,
    context: RequestContext
  ): Promise<{ removedCount: number }> {
    return evaluationComponentService.remove(tenantId, schemeId, componentId, context);
  }
}

export const evaluationComponentController = new EvaluationComponentController();

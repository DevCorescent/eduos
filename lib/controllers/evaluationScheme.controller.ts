// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Scheme
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates to the
//              service.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • No auth, no tenant resolution, no request or response handling — those
//     stay in the route.
//   • No validation — that is the Zod layer.
//   • No business logic, no branching on domain state, no DTO reshaping.
//
// COMPOSITION ROOT
//   This module is where the concrete repositories are bound to the service.
//   The service declares its dependencies as ports and receives them through
//   its constructor, so SOMETHING has to supply the implementations, and the
//   controller is the outermost layer that still knows nothing about HTTP.
//   Wiring is not business logic: no decision is taken here, only an object
//   graph assembled. Keeping it out of the service is precisely what keeps
//   lib/db/prisma out of the service's runtime graph and the service unit
//   testable.
// ============================================================================

import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { evaluationComponentRepository } from "@/lib/repositories/evaluationComponent.repository";
import { evaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";
import { EvaluationSchemeService } from "@/lib/services/evaluationScheme.service";
import type {
  EvaluationSchemeDetailDTO,
  EvaluationSchemeListDTO,
} from "@/lib/dto/evaluationScheme.dto";
import type {
  CreateEvaluationSchemeInput,
  ListEvaluationSchemesQuery,
  UpdateEvaluationSchemeInput,
} from "@/lib/validations/evaluationScheme";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const evaluationSchemeService = new EvaluationSchemeService(
  evaluationSchemeRepository,
  auditLogRepository,
  // Supplied as the concrete repository; the service's constructor narrows it to
  // a single read method, so activation can verify the component tree and can do
  // nothing else with it.
  evaluationComponentRepository
);

export class EvaluationSchemeController {
  /** GET /api/evaluation-schemes */
  async list(tenantId: string, query: ListEvaluationSchemesQuery): Promise<EvaluationSchemeListDTO> {
    return evaluationSchemeService.list(tenantId, query);
  }

  /** GET /api/evaluation-schemes/[id] */
  async getById(tenantId: string, id: string): Promise<EvaluationSchemeDetailDTO> {
    return evaluationSchemeService.getById(tenantId, id);
  }

  /** POST /api/evaluation-schemes */
  async create(
    tenantId: string,
    input: CreateEvaluationSchemeInput,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return evaluationSchemeService.create(tenantId, input, context);
  }

  /** PATCH /api/evaluation-schemes/[id] */
  async update(
    tenantId: string,
    id: string,
    input: UpdateEvaluationSchemeInput,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return evaluationSchemeService.update(tenantId, id, input, context);
  }

  /** POST /api/evaluation-schemes/[id]/activate */
  async activate(
    tenantId: string,
    id: string,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return evaluationSchemeService.activate(tenantId, id, context);
  }

  /** POST /api/evaluation-schemes/[id]/archive */
  async archive(
    tenantId: string,
    id: string,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return evaluationSchemeService.archive(tenantId, id, context);
  }

  /** DELETE /api/evaluation-schemes/[id] */
  async remove(tenantId: string, id: string, context: RequestContext): Promise<void> {
    return evaluationSchemeService.remove(tenantId, id, context);
  }
}

export const evaluationSchemeController = new EvaluationSchemeController();

// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Rule
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
//   This module binds the four concrete implementations to the service's four
//   ports. The service declares its dependencies as narrow contracts and
//   receives them through its constructor, so SOMETHING must supply them, and
//   the controller is the outermost layer that still knows nothing about HTTP.
//
//   Wiring is not business logic: no decision is taken here, only an object
//   graph assembled. Keeping it out of the service is precisely what keeps
//   lib/db/prisma out of the service's runtime graph and the service unit
//   testable with no database.
//
//   Note the last two arguments. evaluationSchemeRepository and
//   evaluationComponentRepository are passed whole, and the service's
//   constructor narrows each to a SINGLE read method. The narrowing is what
//   makes it impossible for rule handling to ever mutate a scheme or a
//   component, enforced by the type system rather than by convention.
// ============================================================================

import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { evaluationComponentRepository } from "@/lib/repositories/evaluationComponent.repository";
import { evaluationRuleRepository } from "@/lib/repositories/evaluationRule.repository";
import { evaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";
import { EvaluationRuleService } from "@/lib/services/evaluationRule.service";
import type {
  EvaluationRuleDTO,
  EvaluationRuleListDTO,
} from "@/lib/dto/evaluationRule.dto";
import type {
  CreateEvaluationRuleInput,
  UpdateEvaluationRuleInput,
} from "@/lib/validations/evaluationRule";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const evaluationRuleService = new EvaluationRuleService(
  evaluationRuleRepository,
  auditLogRepository,
  evaluationSchemeRepository,
  evaluationComponentRepository
);

export class EvaluationRuleController {
  /** GET /api/evaluation-schemes/[id]/rules */
  async getAll(tenantId: string, schemeId: string): Promise<EvaluationRuleListDTO> {
    return evaluationRuleService.getAll(tenantId, schemeId);
  }

  /** GET /api/evaluation-schemes/[id]/rules/[ruleId] */
  async getById(
    tenantId: string,
    schemeId: string,
    ruleId: string
  ): Promise<EvaluationRuleDTO> {
    return evaluationRuleService.getById(tenantId, schemeId, ruleId);
  }

  /** POST /api/evaluation-schemes/[id]/rules */
  async create(
    tenantId: string,
    schemeId: string,
    input: CreateEvaluationRuleInput,
    context: RequestContext
  ): Promise<EvaluationRuleDTO> {
    return evaluationRuleService.create(tenantId, schemeId, input, context);
  }

  /** PATCH /api/evaluation-schemes/[id]/rules/[ruleId] */
  async update(
    tenantId: string,
    schemeId: string,
    ruleId: string,
    input: UpdateEvaluationRuleInput,
    context: RequestContext
  ): Promise<EvaluationRuleDTO> {
    return evaluationRuleService.update(tenantId, schemeId, ruleId, input, context);
  }

  /** DELETE /api/evaluation-schemes/[id]/rules/[ruleId] */
  async remove(
    tenantId: string,
    schemeId: string,
    ruleId: string,
    context: RequestContext
  ): Promise<void> {
    return evaluationRuleService.remove(tenantId, schemeId, ruleId, context);
  }
}

export const evaluationRuleController = new EvaluationRuleController();

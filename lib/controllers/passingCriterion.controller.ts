// ============================================================================
// OWNER      : Gauransh
// MODULE     : Passing Criterion
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
//   Identical in shape to the rule controller, and deliberately so: the two
//   modules have the same four dependencies because they answer the same two
//   questions about aggregates they do not own — is this regulation still a
//   draft, and does this component exist within it.
//
//   The scheme and component repositories are passed whole and narrowed by the
//   service's constructor to one read method each, so criterion handling
//   provably cannot mutate either.
// ============================================================================

import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { evaluationComponentRepository } from "@/lib/repositories/evaluationComponent.repository";
import { evaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";
import { passingCriterionRepository } from "@/lib/repositories/passingCriterion.repository";
import { PassingCriterionService } from "@/lib/services/passingCriterion.service";
import type {
  PassingCriterionDTO,
  PassingCriterionListDTO,
} from "@/lib/dto/passingCriterion.dto";
import type {
  CreatePassingCriterionInput,
  UpdatePassingCriterionInput,
} from "@/lib/validations/passingCriterion";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const passingCriterionService = new PassingCriterionService(
  passingCriterionRepository,
  auditLogRepository,
  evaluationSchemeRepository,
  evaluationComponentRepository
);

export class PassingCriterionController {
  /** GET /api/evaluation-schemes/[id]/passing-criteria */
  async getAll(tenantId: string, schemeId: string): Promise<PassingCriterionListDTO> {
    return passingCriterionService.getAll(tenantId, schemeId);
  }

  /** GET /api/evaluation-schemes/[id]/passing-criteria/[criterionId] */
  async getById(
    tenantId: string,
    schemeId: string,
    criterionId: string
  ): Promise<PassingCriterionDTO> {
    return passingCriterionService.getById(tenantId, schemeId, criterionId);
  }

  /** POST /api/evaluation-schemes/[id]/passing-criteria */
  async create(
    tenantId: string,
    schemeId: string,
    input: CreatePassingCriterionInput,
    context: RequestContext
  ): Promise<PassingCriterionDTO> {
    return passingCriterionService.create(tenantId, schemeId, input, context);
  }

  /** PATCH /api/evaluation-schemes/[id]/passing-criteria/[criterionId] */
  async update(
    tenantId: string,
    schemeId: string,
    criterionId: string,
    input: UpdatePassingCriterionInput,
    context: RequestContext
  ): Promise<PassingCriterionDTO> {
    return passingCriterionService.update(tenantId, schemeId, criterionId, input, context);
  }

  /** DELETE /api/evaluation-schemes/[id]/passing-criteria/[criterionId] */
  async remove(
    tenantId: string,
    schemeId: string,
    criterionId: string,
    context: RequestContext
  ): Promise<void> {
    return passingCriterionService.remove(tenantId, schemeId, criterionId, context);
  }
}

export const passingCriterionController = new PassingCriterionController();

// ============================================================================
// OWNER      : Gauransh
// MODULE     : AI Assisted Internal Assessment (Phase 25)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no arithmetic, no Prisma of its own.
//
// THE COMPOSITION ROOT
//   The single place InternalAssessmentService is wired to its repository, the
//   shared audit-log repository, and the provider adapter. Every route shares
//   this instance.
//
// THE PROVIDER ADAPTER FAILS QUIETLY, BY DESIGN
//   groqCompletion returns a discriminated result rather than throwing, and
//   this adapter maps every failure — missing key, timeout, provider error — to
//   null. The service then records a null rationale and keeps the suggestion,
//   which is already computed and final before this is ever called.
//
//   A rationale is decoration. A mark that disappeared because a remote model
//   was briefly unavailable would be unreproducible and unfair, so nothing
//   about the numeric outcome depends on this adapter succeeding.
// ============================================================================

import { internalAssessmentRepository } from "@/lib/repositories/internalAssessment.repository";
import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { groqCompletion } from "@/lib/services/groq";
import {
  InternalAssessmentService,
  type InternalAssessmentContext,
  type RationalePort,
} from "@/lib/services/internalAssessment.service";
import type {
  GenerateSuggestionsResultDto,
  InternalAssessmentAuditDto,
  InternalAssessmentSuggestionDto,
  MarkingRulesDto,
} from "@/lib/dto/internalAssessment.dto";
import type {
  DecideInternalAssessmentInput,
  GenerateSuggestionsInput,
  InternalAssessmentQuery,
  InternalAssessmentRulesQuery,
} from "@/lib/validations/internalAssessment.validation";

/**
 * The model name reported alongside a rationale.
 *
 * lib/services/groq.ts holds the model as a private constant and does not
 * expose it, so it is restated here for attribution only — it never selects a
 * model and never reaches the provider. If that module ever exports its
 * constant, this should read it instead.
 */
const RATIONALE_MODEL = "llama-3.3-70b-versatile";

/**
 * Asks Groq for a written rationale, or returns null.
 *
 * Every failure mode collapses to null: no API key, a timeout, a non-2xx
 * response, an unparseable body. The caller cannot distinguish them and does
 * not need to — in all four cases there is no rationale, and the suggestion
 * stands regardless.
 */
const rationalePort: RationalePort = {
  async explain(prompt) {
    const result = await groqCompletion(prompt);

    if (!result.ok) return null;

    const text = result.content.trim();

    return text.length > 0 ? { text, model: RATIONALE_MODEL } : null;
  },
};

/** The single wired instance every route in this module delegates to. */
const internalAssessmentService = new InternalAssessmentService(
  internalAssessmentRepository,
  auditLogRepository,
  rationalePort
);

export class InternalAssessmentController {
  /** GET /api/internal-assessment/rules */
  async getRules(
    tenantId: string,
    query: InternalAssessmentRulesQuery,
    departmentId: string | null = null
  ): Promise<MarkingRulesDto> {
    return internalAssessmentService.getRules(tenantId, query, departmentId);
  }

  /** POST /api/internal-assessment/generate */
  async generate(
    tenantId: string,
    input: GenerateSuggestionsInput,
    context: InternalAssessmentContext,
    now: Date
  ): Promise<GenerateSuggestionsResultDto> {
    return internalAssessmentService.generate(tenantId, input, context, now);
  }

  /** GET /api/internal-assessment/student/[studentId] */
  async getForStudent(
    tenantId: string,
    studentId: string,
    query: InternalAssessmentQuery,
    departmentId: string | null = null
  ): Promise<readonly InternalAssessmentSuggestionDto[]> {
    return internalAssessmentService.getForStudent(tenantId, studentId, query, departmentId);
  }

  /** PATCH /api/internal-assessment/[studentId] */
  async decide(
    tenantId: string,
    studentId: string,
    input: DecideInternalAssessmentInput,
    context: InternalAssessmentContext,
    now: Date
  ): Promise<InternalAssessmentSuggestionDto> {
    return internalAssessmentService.decide(tenantId, studentId, input, context, now);
  }

  /** GET /api/internal-assessment/audit/[studentId] */
  async getAudit(
    tenantId: string,
    studentId: string,
    query: InternalAssessmentQuery,
    departmentId: string | null = null
  ): Promise<readonly InternalAssessmentAuditDto[]> {
    return internalAssessmentService.getAudit(tenantId, studentId, query, departmentId);
  }
}

export const internalAssessmentController = new InternalAssessmentController();

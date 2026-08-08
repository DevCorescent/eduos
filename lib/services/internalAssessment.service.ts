// ============================================================================
// OWNER      : Gauransh
// MODULE     : AI Assisted Internal Assessment (Phase 25)
// LAYER      : Service
// PURPOSE    : Own every rule this phase has — which components form the
//              marking rules, how evidence becomes a suggestion, and what a
//              faculty override must record.
// ARCHITECTURE:
//   • Service owns ALL orchestration and every decision.
//   • It calculates NOTHING. Normalisation, weighting, renormalisation and
//     confidence all live in lib/domain/internal-assessment/evidence.ts, so the
//     figure a faculty member sees is the figure a test pins.
//
// THE SUGGESTION IS DETERMINISTIC. THE AI IS THE EXPLANATION.
//   The numeric suggestion is computed from the university's OWN Phase 16
//   component weightages before any provider is contacted. Groq is asked only
//   for a written rationale, only when the caller requests one, and a provider
//   failure leaves the suggestion completely intact with a null rationale.
//
//   That ordering is the whole design. A mark that depended on a remote model's
//   availability would be unreproducible, unauditable and unfair — two students
//   assessed minutes apart could be judged by different reasoning. Here the
//   arithmetic is fixed and the prose is decoration.
//
// THE FACULTY MEMBER DECIDES, AND NOTHING HERE AWARDS A MARK
//   No method in this service writes into StudentComponentScore. A suggestion
//   is a proposal; `finalMarks` is NULL until a human sets it through
//   PATCH /api/internal-assessment/[studentId]. Publishing an accepted mark into
//   a student's result remains Phase 16's operation, untouched.
//
// QUERY BUDGET, STATED HONESTLY
//   generate  1 (scheme) + 1 (cohort) + 4 (evidence, all GROUPED across the
//             whole cohort) + 1 upsert per student + 1 audit write, the last
//             two inside one transaction. A three-hundred-student run costs six
//             reads, not twelve hundred.
//   getRules  1
//   getStudent 1
//   decide    1 (suggestion) + 1 (component) + 1 update + 1 audit
//   getAudit  1
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { EvaluationComponentType } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  COMPONENT_TYPE_SIGNAL,
  INTERNAL_ASSESSMENT_ACTION,
  INTERNAL_ASSESSMENT_GENERATE_LIMIT,
  INTERNAL_ASSESSMENT_MESSAGE,
  INTERNAL_ASSESSMENT_RESOURCE,
} from "@/lib/constants/internalAssessment";
import {
  blend,
  toMarks,
  toSignals,
  type EvidenceDetail,
  type SignalKey,
  type WeightedInput,
} from "@/lib/domain/internal-assessment/evidence";
import {
  toAuditDto,
  toSuggestionDto,
  type GenerateSuggestionsResultDto,
  type InternalAssessmentAuditDto,
  type InternalAssessmentSuggestionDto,
  type MarkingRulesDto,
  type SuggestionRow,
} from "@/lib/dto/internalAssessment.dto";
import type {
  InternalAssessmentRepositoryPort,
  MarksTotal,
} from "@/lib/repositories/internalAssessment.repository";
import type { AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  DecideInternalAssessmentInput,
  GenerateSuggestionsInput,
  InternalAssessmentQuery,
  InternalAssessmentRulesQuery,
} from "@/lib/validations/internalAssessment.validation";

/**
 * Asks the provider for a written rationale.
 *
 * A NARROW PORT over lib/services/groq.ts, so this service can be unit-tested
 * with no network and no API key. It returns text or null; that a null leaves
 * the suggestion intact is this service's decision, not the adapter's.
 */
export interface RationalePort {
  explain(prompt: string): Promise<{ text: string; model: string } | null>;
}

/** Request metadata carried into the audit entry. Never business input. */
export interface InternalAssessmentContext {
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

const EMPTY_TOTAL = { graded: 0, obtained: 0, available: 0 };

function indexTotals(totals: readonly MarksTotal[]): Map<string, MarksTotal> {
  return new Map(totals.map((entry) => [entry.studentId, entry]));
}

export class InternalAssessmentService {
  constructor(
    private readonly repository: InternalAssessmentRepositoryPort,
    private readonly auditLog: AuditLogRepositoryPort,
    private readonly rationale: RationalePort
  ) {}

  /**
   * GET /api/internal-assessment/rules
   *
   * REPORTS : The ACTIVE evaluation scheme's components with the university's
   *           own weightages — the README's "University marking rules". No
   *           weight is invented and no parallel rules store exists.
   *
   *           Components that map to no observable signal are listed in
   *           `unmappedComponents`, because they are the reason a confidence
   *           figure may be lower than a faculty member expects.
   */
  async getRules(
    tenantId: string,
    query: InternalAssessmentRulesQuery
  ): Promise<MarkingRulesDto> {
    const scheme = await this.repository.findActiveSchemeComponents(
      tenantId,
      query.courseId,
      query.semesterId
    );

    if (!scheme) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.NO_ACTIVE_SCHEME,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const components = scheme.components.map((component) => {
      const signal = COMPONENT_TYPE_SIGNAL[component.type] ?? null;

      return {
        componentId: component.id,
        code: component.code,
        name: component.name,
        type: component.type,
        sourceType: component.sourceType,
        maxMarks: component.maxMarks === null ? null : Number(component.maxMarks),
        weightage: component.weightage === null ? null : Number(component.weightage),
        isMandatory: component.isMandatory,
        evidenceSignal: signal,
      };
    });

    return {
      courseId: query.courseId,
      semesterId: query.semesterId,
      scheme: {
        id: scheme.id,
        code: scheme.code,
        name: scheme.name,
        version: scheme.version,
        status: scheme.status,
      },
      components,
      unmappedComponents: components
        .filter((component) => component.evidenceSignal === null)
        .map((component) => component.code),
    };
  }

  /**
   * POST /api/internal-assessment/generate
   *
   * RULES   : The named component must belong to the ACTIVE scheme for the
   *           course-semester (404 otherwise). The evidence weights come from
   *           the scheme's OTHER components — a component contributes its own
   *           weightage to the signal its type maps onto.
   *
   *           A student for whom NO configured input had data receives a
   *           suggestion row with a NULL suggestedMarks and zero confidence,
   *           not a zero mark. Recommending zero for a student the system knows
   *           nothing about would be the single most damaging thing this
   *           feature could do.
   *
   * ATOMICITY: every upsert and the audit entry share ONE transaction, so a
   *           partially-generated cohort cannot be recorded as complete.
   */
  async generate(
    tenantId: string,
    input: GenerateSuggestionsInput,
    context: InternalAssessmentContext,
    now: Date
  ): Promise<GenerateSuggestionsResultDto> {
    const scheme = await this.repository.findActiveSchemeComponents(
      tenantId,
      input.courseId,
      input.semesterId
    );

    if (!scheme) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.NO_ACTIVE_SCHEME,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const target = scheme.components.find((component) => component.id === input.componentId);

    if (!target) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.COMPONENT_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    // The weighted inputs, taken from the university's own configuration. The
    // TARGET component is excluded: including it would let the thing being
    // suggested contribute to its own suggestion.
    const inputs: WeightedInput[] = [];
    const evidenceComponentIds: Record<SignalKey, string[]> = {
      attendance: [],
      assignment: [],
      quiz: [],
      practical: [],
      priorPerformance: [],
    };

    for (const component of scheme.components) {
      if (component.id === target.id) continue;

      const key = COMPONENT_TYPE_SIGNAL[component.type];
      if (!key) continue;

      inputs.push({ key, weight: Number(component.weightage ?? 0) });
      evidenceComponentIds[key].push(component.id);
    }

    // Prior performance is never a configured component — it is a cross-semester
    // reading. It is added as an input only when the scheme leaves room for it,
    // i.e. when at least one other input exists; a scheme with no mappable
    // components would otherwise be judged entirely on past semesters.
    if (inputs.length > 0) {
      inputs.push({ key: "priorPerformance", weight: PRIOR_PERFORMANCE_WEIGHT });
    }

    const registrations = await this.repository.findRegisteredStudents(
      tenantId,
      input.courseId,
      input.semesterId,
      input.studentIds,
      INTERNAL_ASSESSMENT_GENERATE_LIMIT + 1
    );

    if (registrations.length === 0) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.NO_REGISTRATIONS,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const truncated = registrations.length > INTERNAL_ASSESSMENT_GENERATE_LIMIT;
    const cohort = registrations.slice(0, INTERNAL_ASSESSMENT_GENERATE_LIMIT);
    const studentIds = cohort.map((registration) => registration.studentId);

    // Four GROUPED reads across the whole cohort. Not one per student.
    const [attendance, assignments, quizzes, practicals, prior] = await Promise.all([
      this.repository.findAttendanceTotals(tenantId, input.courseId, studentIds),
      this.repository.findAssignmentTotals(tenantId, input.courseId, studentIds),
      this.repository.findComponentScoreTotals(
        tenantId,
        studentIds,
        evidenceComponentIds.quiz
      ),
      this.repository.findComponentScoreTotals(
        tenantId,
        studentIds,
        evidenceComponentIds.practical
      ),
      this.repository.findPriorPerformance(tenantId, studentIds, input.semesterId),
    ]);

    const attendanceBy = new Map(attendance.map((entry) => [entry.studentId, entry]));
    const assignmentBy = indexTotals(assignments);
    const quizBy = indexTotals(quizzes);
    const practicalBy = indexTotals(practicals);
    const priorBy = indexTotals(prior);

    const maxMarks = Number(target.maxMarks ?? 0);

    const computed = cohort.map((registration) => {
      const studentId = registration.studentId;

      const detail: EvidenceDetail = {
        attendance: attendanceBy.get(studentId) ?? { held: 0, attended: 0 },
        assignment: assignmentBy.get(studentId) ?? EMPTY_TOTAL,
        quiz: quizBy.get(studentId) ?? EMPTY_TOTAL,
        practical: practicalBy.get(studentId) ?? EMPTY_TOTAL,
        priorPerformance: priorBy.get(studentId) ?? EMPTY_TOTAL,
      };

      const signals = toSignals(detail);
      const basis = blend(signals, inputs);

      return {
        studentId,
        detail,
        signals,
        basis,
        suggestedMarks: toMarks(basis.score, maxMarks),
      };
    });

    // The provider is contacted ONCE for the whole run, not once per student —
    // and only if a rationale was asked for. The numeric suggestions above are
    // already final at this point and do not depend on the outcome.
    let rationaleText: string | null = null;
    let aiModel: string | null = null;

    if (input.withRationale) {
      const explained = await this.rationale.explain(
        buildRationalePrompt(target.code, target.name, inputs, computed.length)
      );

      if (explained) {
        rationaleText = explained.text;
        aiModel = explained.model;
      }
    }

    const stored = await this.repository.transaction(async (client) => {
      const rows: SuggestionRow[] = [];

      for (const entry of computed) {
        const row = await this.repository.upsertSuggestion(
          {
            tenantId,
            studentId: entry.studentId,
            courseId: input.courseId,
            semesterId: input.semesterId,
            componentId: input.componentId,
            suggestedMarks: entry.suggestedMarks,
            confidence: entry.basis.confidence,
            factors: {
              attendance: { ...entry.detail.attendance, signal: entry.signals.attendance },
              assignment: { ...entry.detail.assignment, signal: entry.signals.assignment },
              quiz: { ...entry.detail.quiz, signal: entry.signals.quiz },
              practical: { ...entry.detail.practical, signal: entry.signals.practical },
              priorPerformance: {
                ...entry.detail.priorPerformance,
                signal: entry.signals.priorPerformance,
              },
              used: entry.basis.used,
              missing: entry.basis.missing,
            } as Prisma.InputJsonValue,
            rationale: rationaleText,
            aiModel,
            generatedById: context.userId,
            generatedAt: now,
          },
          client
        );

        rows.push(row as unknown as SuggestionRow);
      }

      await this.auditLog.record(
        {
          tenantId,
          userId: context.userId,
          action: INTERNAL_ASSESSMENT_ACTION.GENERATE,
          resource: INTERNAL_ASSESSMENT_RESOURCE,
          resourceId: input.componentId,
          after: {
            courseId: input.courseId,
            semesterId: input.semesterId,
            componentId: input.componentId,
            studentCount: computed.length,
            aiModel,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        client
      );

      return rows;
    });

    return {
      courseId: input.courseId,
      semesterId: input.semesterId,
      componentId: input.componentId,
      generated: stored.length,
      withoutEvidence: computed.filter((entry) => entry.suggestedMarks === null).length,
      truncated,
      aiModel,
      suggestions: stored.map(toSuggestionDto),
    };
  }

  /** GET /api/internal-assessment/student/[studentId] */
  async getForStudent(
    tenantId: string,
    studentId: string,
    query: InternalAssessmentQuery
  ): Promise<readonly InternalAssessmentSuggestionDto[]> {
    const rows = await this.repository.findSuggestions(tenantId, studentId, query);

    return rows.map((row) => toSuggestionDto(row as unknown as SuggestionRow));
  }

  /**
   * PATCH /api/internal-assessment/[studentId] — the faculty decision.
   *
   * RULES   : A suggestion must exist for the named student, course, semester
   *           and component (404 otherwise) — a decision with no proposal
   *           behind it is not an override, and this phase's whole premise is
   *           that the two travel together.
   *
   *           `finalMarks` may not exceed the component's maximum. The bound is
   *           a stored value the validation layer cannot read, so it is
   *           enforced here.
   *
   *           A reason is REQUIRED when the awarded mark DIFFERS from the
   *           suggestion, and optional when it matches. That is the README's
   *           "Faculty Override ... Remarks" read literally: accepting a
   *           proposal needs no justification, departing from one does. The
   *           schema cannot express "required only when they differ", so the
   *           rule lives here — stated in the model's own comment as a known
   *           structural gap.
   *
   * ATOMICITY: the update and its audit entry share ONE transaction.
   */
  async decide(
    tenantId: string,
    studentId: string,
    input: DecideInternalAssessmentInput,
    context: InternalAssessmentContext,
    now: Date
  ): Promise<InternalAssessmentSuggestionDto> {
    const existing = await this.repository.findSuggestion({
      tenantId,
      studentId,
      courseId: input.courseId,
      semesterId: input.semesterId,
      componentId: input.componentId,
    });

    if (!existing) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.SUGGESTION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const scheme = await this.repository.findActiveSchemeComponents(
      tenantId,
      input.courseId,
      input.semesterId
    );

    const component = scheme?.components.find((entry) => entry.id === input.componentId);

    if (!component) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.COMPONENT_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const maxMarks = Number(component.maxMarks ?? 0);

    if (maxMarks > 0 && input.finalMarks > maxMarks) {
      throw new AppError(
        `${INTERNAL_ASSESSMENT_MESSAGE.MARKS_EXCEED_MAX} (${maxMarks})`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODE.VALIDATION
      );
    }

    const suggested =
      existing.suggestedMarks === null ? null : Number(existing.suggestedMarks);

    const differs = suggested === null || input.finalMarks !== suggested;

    if (differs && !input.overrideReason) {
      throw new AppError(
        INTERNAL_ASSESSMENT_MESSAGE.OVERRIDE_REASON_REQUIRED,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODE.VALIDATION
      );
    }

    const decided = await this.repository.transaction(async (client) => {
      const row = await this.repository.recordDecision(
        {
          id: existing.id,
          finalMarks: input.finalMarks,
          overrideReason: input.overrideReason ?? null,
          decidedById: context.userId,
          decidedAt: now,
        },
        client
      );

      await this.auditLog.record(
        {
          tenantId,
          userId: context.userId,
          action: INTERNAL_ASSESSMENT_ACTION.DECIDE,
          resource: INTERNAL_ASSESSMENT_RESOURCE,
          resourceId: existing.id,
          before: { suggestedMarks: suggested, finalMarks: null },
          after: {
            studentId,
            courseId: input.courseId,
            semesterId: input.semesterId,
            componentId: input.componentId,
            suggestedMarks: suggested,
            finalMarks: input.finalMarks,
            overrideReason: input.overrideReason ?? null,
            remarks: input.remarks ?? null,
            isOverride: differs,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        client
      );

      return row;
    });

    return toSuggestionDto(decided as unknown as SuggestionRow);
  }

  /** GET /api/internal-assessment/audit/[studentId] */
  async getAudit(
    tenantId: string,
    studentId: string,
    query: InternalAssessmentQuery
  ): Promise<readonly InternalAssessmentAuditDto[]> {
    const rows = await this.repository.findAudit(tenantId, studentId, query);

    return rows.map(toAuditDto);
  }
}

/**
 * The weight prior performance carries when the scheme leaves room for it.
 *
 * A SMALL, NAMED, DEFENSIBLE NUMBER. The README lists "previous academic
 * performance" among the inputs but no university configures it as an
 * evaluation component — it is a cross-semester reading, not a piece of
 * coursework. It is therefore weighted deliberately low relative to the
 * component weightages (which conventionally total 100), so that current work
 * dominates and history only breaks ties.
 *
 * Stated here as a constant, and reported in every response's `factors`, so it
 * is visible and adjustable rather than buried in an expression.
 */
const PRIOR_PERFORMANCE_WEIGHT = 10;

/**
 * The prompt sent to the provider when a rationale is requested.
 *
 * It carries NO student identifier, NO name and NO mark — only the shape of the
 * scheme and the size of the cohort. A rationale explains the METHOD, not an
 * individual, so nothing identifying a student ever leaves the process.
 */
function buildRationalePrompt(
  componentCode: string,
  componentName: string,
  inputs: readonly WeightedInput[],
  cohortSize: number
): string {
  const weights = inputs
    .map((input) => `${input.key} (weight ${input.weight})`)
    .join(", ");

  return [
    "You are assisting a university faculty member with internal assessment.",
    `Component: ${componentCode} — ${componentName}.`,
    `Cohort size: ${cohortSize}.`,
    `The suggestion for each student is a weighted blend of: ${weights || "no configured inputs"}.`,
    "Inputs with no data for a student are excluded and the remaining weights renormalised.",
    "In at most 120 words, explain to the faculty member how to interpret these",
    "suggestions and what to check before accepting them. Do not invent marks or",
    "refer to any individual student.",
  ].join(" ");
}

/** Re-exported so the controller can name the type it maps onto. */
export type { EvaluationComponentType };

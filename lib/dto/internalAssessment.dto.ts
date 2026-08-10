// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : DTO
// PURPOSE: The shapes the five Phase 25 endpoints return.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   suggestedMarks, confidence and finalMarks are all Decimal columns. A
//   Decimal instance does not serialise honestly — it prints its internal
//   representation — so each is converted to a plain number here, explicitly,
//   once.
//
// THE SUGGESTION AND THE DECISION ARE REPORTED SIDE BY SIDE
//   A reader must be able to see what was proposed, what was awarded, and
//   whether they differ, without arithmetic of their own. `isOverridden` is
//   derived for exactly that reason — an appeal against an internal mark asks
//   precisely this question.
// ============================================================================

/** Anything Prisma hands back as a Decimal. */
type DecimalLike = { toString(): string } | null;

function toNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value.toString());

  return Number.isFinite(parsed) ? parsed : null;
}

/** One evaluation component, as the rules endpoint reports it. */
export interface MarkingRuleDto {
  readonly componentId: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly sourceType: string;
  readonly maxMarks: number | null;
  /** The university's own configured weightage. Never invented here. */
  readonly weightage: number | null;
  readonly isMandatory: boolean;
  /**
   * Which evidence signal this component contributes, or null.
   *
   * Null means the system observes nothing that corresponds to it — a VIVA or a
   * SEMINAR has no table to read. Reported rather than omitted so a faculty
   * member can see which parts of their scheme the suggestion could not account
   * for, instead of wondering why the confidence is low.
   */
  readonly evidenceSignal: string | null;
}

/** The rules response. */
export interface MarkingRulesDto {
  readonly courseId: string;
  readonly semesterId: string;
  readonly scheme: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly version: number;
    readonly status: string;
  };
  readonly components: readonly MarkingRuleDto[];
  /**
   * Components that carry weight but map to no observable signal.
   *
   * Surfaced explicitly because they are the reason a confidence figure may be
   * lower than a faculty member expects.
   */
  readonly unmappedComponents: readonly string[];
}

/** The evidence one suggestion was computed from. */
export interface SuggestionFactorsDto {
  readonly attendance: { held: number; attended: number; signal: number | null };
  readonly assignment: { graded: number; obtained: number; available: number; signal: number | null };
  readonly quiz: { graded: number; obtained: number; available: number; signal: number | null };
  readonly practical: { graded: number; obtained: number; available: number; signal: number | null };
  readonly priorPerformance: {
    graded: number;
    obtained: number;
    available: number;
    signal: number | null;
  };
  /** Inputs that contributed, and inputs that were configured but had no data. */
  readonly used: readonly string[];
  readonly missing: readonly string[];
}

/** One suggestion and the decision taken on it. */
export interface InternalAssessmentSuggestionDto {
  readonly id: string;
  readonly studentId: string;
  readonly enrollmentNo: string | null;
  readonly courseId: string;
  readonly semesterId: string;
  readonly componentId: string;
  readonly suggestedMarks: number | null;
  /**
   * Data completeness in [0, 1] — the share of configured inputs this student
   * had any data for.
   *
   * NOT a probability that the suggestion is correct. No such quantity is
   * defined anywhere in the README and none could honestly be computed.
   */
  readonly confidence: number | null;
  readonly factors: unknown;
  readonly rationale: string | null;
  readonly aiModel: string | null;
  readonly generatedAt: string;
  readonly finalMarks: number | null;
  readonly overrideReason: string | null;
  readonly decidedAt: string | null;
  /** True once a faculty member has awarded a mark. */
  readonly isDecided: boolean;
  /** True when the awarded mark differs from what was proposed. */
  readonly isOverridden: boolean;
}

/** The row shape SUGGESTION_SELECT produces. */
export interface SuggestionRow {
  id: string;
  studentId: string;
  courseId: string;
  semesterId: string;
  componentId: string;
  suggestedMarks: DecimalLike;
  confidence: DecimalLike;
  factors: unknown;
  rationale: string | null;
  aiModel: string | null;
  generatedAt: Date;
  finalMarks: DecimalLike;
  overrideReason: string | null;
  decidedAt: Date | null;
  student: { id: string; enrollmentNo: string } | null;
}

export function toSuggestionDto(row: SuggestionRow): InternalAssessmentSuggestionDto {
  const suggested = toNumber(row.suggestedMarks);
  const final = toNumber(row.finalMarks);

  return {
    id: row.id,
    studentId: row.studentId,
    enrollmentNo: row.student?.enrollmentNo ?? null,
    courseId: row.courseId,
    semesterId: row.semesterId,
    componentId: row.componentId,
    suggestedMarks: suggested,
    confidence: toNumber(row.confidence),
    factors: row.factors ?? null,
    rationale: row.rationale,
    aiModel: row.aiModel,
    generatedAt: row.generatedAt.toISOString(),
    finalMarks: final,
    overrideReason: row.overrideReason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    isDecided: final !== null,
    // Only meaningful once a decision exists; an undecided row is not an
    // override of anything.
    isOverridden: final !== null && suggested !== null && final !== suggested,
  };
}

/** What a generate run produced. */
export interface GenerateSuggestionsResultDto {
  readonly courseId: string;
  readonly semesterId: string;
  readonly componentId: string;
  readonly generated: number;
  /** Students covered but for whom no input had data, so no mark was proposed. */
  readonly withoutEvidence: number;
  /** True when the cohort exceeded the per-run bound. */
  readonly truncated: boolean;
  readonly aiModel: string | null;
  readonly suggestions: readonly InternalAssessmentSuggestionDto[];
}

/** One audit entry, as GET /api/internal-assessment/audit/[studentId] reports it. */
export interface InternalAssessmentAuditDto {
  readonly id: string;
  readonly action: string;
  readonly resourceId: string | null;
  /**
   * A bare id. AuditLog.userId carries no foreign key and AuditLog declares no
   * `user` relation, so there is nothing to traverse — a caller resolves the
   * name through GET /api/users/[id].
   */
  readonly actorId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: string;
}

/** The AuditLog row shape this module reads. */
export interface InternalAssessmentAuditRow {
  id: string;
  action: string;
  resourceId: string | null;
  userId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export function toAuditDto(row: InternalAssessmentAuditRow): InternalAssessmentAuditDto {
  return {
    id: row.id,
    action: row.action,
    resourceId: row.resourceId,
    actorId: row.userId,
    // Reported exactly as stored. An audit record rewritten on the way out is
    // evidence of what the reader wanted rather than of what happened.
    before: row.before ?? null,
    after: row.after ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

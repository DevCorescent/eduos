// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Orchestrator
// LAYER  : Domain (pure)
// PURPOSE: Run the whole pipeline, once, in the one order that is correct.
//
//   configuration ──> prepareScheme  (ONCE per scheme, reused by every student)
//                        │
//   marks ─────────────> ├─ session rules      per sitting
//                        ├─ aggregation        sittings -> component
//                        ├─ component rules    on the component's own figure
//                        ├─ rollup             tree -> course percentage
//                        ├─ course rules       on the whole
//                        ├─ grade resolution   percentage -> band
//                        ├─ criteria           thresholds, fail override
//                        └─ credits            outcome -> credit earned
//                              │
//                              └──> SGPA ──> CGPA ──> ranking hooks
//
// EACH STAGE RUNS EXACTLY ONCE
//   The tree is indexed once per scheme, not once per student. The rules are
//   indexed once per scheme. The band table is validated once per scheme. A
//   1000-student cohort on a 100-course programme therefore pays the O(c + r)
//   preparation cost ONCE, and each student pays only their own O(c + m). This
//   is the difference between a batch that finishes and one that does not.
//
// NOTHING IS RECALCULATED AND NOTHING IS MUTATED
//   Component results are written into a Map as they are produced and read from
//   it by their parents. Because the evaluation order is deepest-first, every
//   child is finished before its parent looks for it — so no value is ever
//   computed twice and no stage needs to walk back up.
//
// FAILURE IS DATA, NOT AN EXCEPTION
//   A batch of a thousand students must record which one could not be computed
//   and carry on. Every stage returns an outcome; this module collects errors
//   and warnings and always returns a CourseComputation, never throws.
//
// COMPLEXITY
//   prepareScheme  O(c + r + b log b) once per scheme.
//   per course     O(c + m) — one pass over components, one over marks.
//   per semester   O(n) in courses.
//   ranking        O(n log n), delegated.
// ============================================================================

import { COURSE_OUTCOME, MARK_SCALE } from "@/lib/constants/resultEngine";
import { aggregateSessions, AGGREGATION_ERROR } from "@/lib/domain/result-engine/aggregation";
import {
  divideRounded,
  roundToPrecision,
  weightedContribution,
} from "@/lib/domain/result-engine/decimal";
import {
  CriterionOutcome,
  PassingMetric,
  ThresholdUnit,
  type CourseOutcome,
} from "@/lib/domain/result-engine/enums";
import {
  applyFailOverride,
  evaluateCriteria,
  findBand,
  prepareBandTable,
  resolveGrade,
  worstOutcome,
  RELATIVE_GRADING_PENDING,
  type BandTable,
} from "@/lib/domain/result-engine/grading";
import {
  computeGpa,
  gpaAsPercentage,
  selectAttempts,
  summariseCredits,
  type CreditSummary,
  type GpaCourseEntry,
} from "@/lib/domain/result-engine/gpa";
import {
  applyRules,
  indexComponents,
  indexRules,
  isLeaf,
  rollupChildren,
  rollupRoots,
  rulesFor,
  unreachableComponents,
  COURSE_SCOPE,
  ROLLUP_ERROR,
  type ComponentIndex,
  type RuleIndex,
} from "@/lib/domain/result-engine/rollup";
import type {
  AssessmentValue,
  CalculatorContext,
  ComponentDefinition,
  ComponentResult,
  CourseCalculationInput,
  CourseResultValue,
  CriterionFailure,
  EngineOutcome,
  EvaluationContext,
  EvaluationFailure,
  GpaResult,
  GradeResolution,
  RoundingPolicy,
  Scaled,
  SemesterResultValue,
  TranscriptRow,
} from "@/lib/domain/result-engine/types";
import { RulePhase } from "@/lib/domain/result-engine/enums";
import type { AttemptPolicy } from "@/app/generated/prisma/enums";

/** The course total's scale: a percentage out of 100. */
const COURSE_MAX_SCALED: Scaled = 100 * 10 ** MARK_SCALE;

/**
 * A scheme, indexed and checked, ready to compute any number of students.
 *
 * Built ONCE and treated as immutable thereafter. Holding it per-student would
 * rebuild the tree and re-validate the band table a thousand times to get a
 * thousand identical answers.
 */
export interface PreparedScheme {
  readonly evaluationSchemeId: string;
  readonly components: ComponentIndex;
  readonly rules: RuleIndex;
  readonly bands: BandTable;
  readonly policy: RoundingPolicy;
  readonly isRelativeGrading: boolean;
  /** Criteria that apply to the whole course, checked per student. */
  readonly criteria: CalculatorContext["criteria"];
  /**
   * Each component's own pass mark on its OWN scale, for GRACE.
   *
   * A course-level pass mark is a percentage and a component's figure is not,
   * so handing the former to a component-level GRACE would lift marks toward a
   * number that means nothing on that scale. Derived from the component's own
   * PassingCriterion where one exists, and absent where none does.
   */
  readonly componentPassMarks: ReadonlyMap<string, Scaled>;
}

/** What one course computation produced, including everything it could not do. */
export interface CourseComputation {
  /** Null only when the pipeline could not reach a result at all. */
  readonly result: CourseResultValue | null;
  readonly warnings: readonly string[];
  readonly errors: readonly EvaluationFailure[];
  /** Cohort-scoped work a second pass must do — CURVE, MODERATION, RELATIVE. */
  readonly pendingOperations: readonly string[];
  /** The rule codes behind those pending operations. */
  readonly deferredCodes: readonly string[];
}

/** One semester, computed, with everything outstanding carried up. */
export interface SemesterComputation {
  readonly result: SemesterResultValue;
  readonly credits: CreditSummary;
  readonly warnings: readonly string[];
  readonly errors: readonly EvaluationFailure[];
  readonly pendingOperations: readonly string[];
}

/** A whole student record across every semester computed so far. */
export interface StudentResult {
  readonly studentId: string;
  readonly semesters: readonly SemesterResultValue[];
  readonly cgpa: GpaResult;
  readonly credits: CreditSummary;
  readonly transcript: readonly TranscriptRow[];
  readonly standing: AcademicStanding;
  readonly pendingOperations: readonly string[];
}

/** A transcript line. `TranscriptRow` is its declared shape; this is the alias. */
export type TranscriptEntry = TranscriptRow;

/** One semester's publishable summary, as a grade card renders it. */
export interface GradeCard {
  readonly studentId: string;
  readonly semesterId: string;
  readonly lines: readonly GradeCardLine[];
  readonly sgpa: GpaResult;
  readonly credits: CreditSummary;
  readonly backlogCount: number;
  readonly isPromoted: boolean;
  /** True while any cohort operation is outstanding — do not publish. */
  readonly isProvisional: boolean;
}

/** One course's row on a grade card. */
export interface GradeCardLine {
  readonly courseRegistrationId: string;
  readonly creditsScaled: Scaled;
  readonly percentageScaled: Scaled;
  readonly grade: string | null;
  readonly label: string | null;
  readonly gradePointScaled: Scaled | null;
  readonly outcome: CourseOutcome;
  readonly creditsEarnedScaled: Scaled;
}

/**
 * Where a student stands overall.
 *
 * `classification` is read from the tenant's own bands by expressing the CGPA
 * as a percentage of the scale's ceiling — 8.5 of 10 and 3.4 of 4 both being
 * 85% — and looking that up. It is NOT computed from a threshold in this file,
 * because "first class" is a regulation's word and not the engine's.
 */
export interface AcademicStanding {
  readonly cgpaScaled: Scaled | null;
  readonly cgpaPercentScaled: Scaled | null;
  readonly classification: string | null;
  readonly grade: string | null;
  readonly creditsEarnedScaled: Scaled;
  readonly backlogCount: number;
  /** True when nothing is outstanding — no backlog and no pending cohort work. */
  readonly isClear: boolean;
}

/**
 * Index and validate a scheme once.
 *
 * Refuses a scheme whose tree cannot be walked — an orphaned component or a
 * cycle — rather than silently computing a course total that omits it. A
 * missing component is not a smaller course; it is a wrong one.
 *
 * COMPLEXITY : O(c + r + b log b).
 */
export function prepareScheme(
  context: CalculatorContext,
  maxGradePointScaled: Scaled
): EngineOutcome<PreparedScheme> {
  const components = indexComponents(context.components);
  const unreachable = unreachableComponents(context.components, components);

  if (unreachable.length > 0) {
    return {
      ok: false,
      failure: {
        code: ROLLUP_ERROR.ORPHANED_COMPONENT,
        message: "The component tree contains a cycle or a component with no root",
        subject: unreachable.join(", "),
      },
    };
  }

  const bands = prepareBandTable(context.gradeBands, maxGradePointScaled);

  if (!bands.ok) {
    return bands;
  }

  return {
    ok: true,
    value: {
      evaluationSchemeId: context.evaluationSchemeId,
      components,
      rules: indexRules(context.rules),
      bands: bands.value,
      policy: context.policy,
      isRelativeGrading: context.isRelativeGrading,
      criteria: context.criteria,
      componentPassMarks: buildComponentPassMarks(context, components),
    },
  };
}

/**
 * Derive each component's own pass mark from its passing criterion.
 *
 * A criterion in MARKS is already on the component's scale. One in PERCENT is a
 * proportion of the component's own maximum, so it is converted here — once,
 * during preparation — rather than on every student.
 */
function buildComponentPassMarks(
  context: CalculatorContext,
  components: ComponentIndex
): ReadonlyMap<string, Scaled> {
  const passMarks = new Map<string, Scaled>();

  for (const criterion of context.criteria) {
    if (criterion.metric !== PassingMetric.COMPONENT_SCORE || criterion.componentId === null) {
      continue;
    }

    const component = components.byId.get(criterion.componentId);

    if (component === undefined) {
      continue;
    }

    const threshold =
      criterion.unit === ThresholdUnit.PERCENT
        ? divideRounded(
            criterion.thresholdScaled * component.maxMarksScaled,
            100 * 10 ** MARK_SCALE,
            context.policy.marksRounding
          )
        : criterion.thresholdScaled;

    // The strictest criterion wins when a component carries more than one:
    // clearing the lower one would not clear the higher.
    const held = passMarks.get(criterion.componentId);

    if (held === undefined || threshold > held) {
      passMarks.set(criterion.componentId, threshold);
    }
  }

  return passMarks;
}

/** Accumulates everything a single course computation learns along the way. */
interface Collector {
  readonly warnings: string[];
  readonly errors: EvaluationFailure[];
  readonly deferred: string[];
  readonly pending: Set<string>;
}

/** Build the evaluation context one stage runs under. */
function contextFor(
  prepared: PreparedScheme,
  input: CourseCalculationInput,
  passMarkScaled: Scaled | null
): EvaluationContext {
  return {
    rounding: prepared.policy.marksRounding,
    policy: prepared.policy,
    passMarkScaled,
    bindings:
      input.attendancePercentScaled === null
        ? {}
        : { ATTENDANCE_PERCENT: input.attendancePercentScaled },
  };
}

/**
 * Compute one course for one student.
 *
 * The single entry point for the per-student pipeline. Always returns; a
 * failure anywhere becomes an entry in `errors` and, where the failure is a
 * recognised academic condition rather than a misconfiguration, a result whose
 * outcome says so.
 *
 * COMPLEXITY : O(c + m). Every component visited once, every mark bucketed once.
 */
export function calculateCourse(
  prepared: PreparedScheme,
  input: CourseCalculationInput
): CourseComputation {
  const collector: Collector = { warnings: [], errors: [], deferred: [], pending: new Set() };

  const sessionsByComponent = bucketMarks(input.marks, prepared, collector);
  const results = new Map<string, ComponentResult>();
  const values = new Map<string, Scaled>();

  let blockedOutcome: CourseOutcome | null = null;

  for (const componentId of prepared.components.evaluationOrder) {
    const definition = prepared.components.byId.get(componentId);

    if (definition === undefined) {
      continue;
    }

    const computed = computeComponent(
      prepared,
      input,
      definition,
      sessionsByComponent.get(componentId) ?? [],
      results,
      values,
      collector
    );

    if (computed.blocked !== null) {
      // A withheld or unfinished component decides the whole course; there is
      // no partial result worth publishing.
      blockedOutcome = escalate(blockedOutcome, computed.blocked);
      continue;
    }

    if (computed.result === null) {
      continue;
    }

    results.set(componentId, computed.result);
    values.set(componentId, computed.result.adjustedScaled);
  }

  if (blockedOutcome !== null) {
    return finish(
      collector,
      blockedResult(prepared, input, [...results.values()], blockedOutcome, collector)
    );
  }

  const rootValues = prepared.components.roots.map((definition) => ({
    definition,
    valueScaled: values.get(definition.id) ?? 0,
  }));

  const rolled = rollupRoots(rootValues, contextFor(prepared, input, null));

  if (!rolled.ok) {
    collector.errors.push(rolled.failure);
    return finish(collector, null);
  }

  const courseRules = rulesFor(prepared.rules, COURSE_SCOPE, RulePhase.COURSE_ADJUSTMENT);
  const adjusted = applyRules(
    courseRules,
    rolled.value,
    COURSE_MAX_SCALED,
    contextFor(prepared, input, prepared.bands.passMarkScaled)
  );

  if (!adjusted.ok) {
    collector.errors.push(adjusted.failure);
    return finish(collector, null);
  }

  record(collector, adjusted.value.deferredCodes);

  const percentageScaled = adjusted.value.valueScaled;
  const componentResults = [...results.values()];

  const criteriaOutcome = checkCriteria(prepared, input, componentResults, collector);

  if (prepared.isRelativeGrading) {
    // A relative scale has no answer for one student. Reporting a provisional
    // grade computed from an absolute lookup would be a fabrication that a
    // later cohort pass would silently contradict.
    collector.pending.add(RELATIVE_GRADING_PENDING);

    return finish(collector, {
      courseRegistrationId: input.courseRegistrationId,
      evaluationSchemeId: prepared.evaluationSchemeId,
      components: componentResults,
      percentageScaled,
      grade: null,
      outcome: COURSE_OUTCOME.INCOMPLETE,
      creditsScaled: input.creditsScaled,
      creditsEarnedScaled: 0,
      failedCriteria: criteriaOutcome.failures,
      pendingCohortRules: [...collector.pending],
    });
  }

  const resolved = resolveGrade(prepared.bands, percentageScaled, prepared.policy);

  if (!resolved.ok) {
    collector.errors.push(resolved.failure);
    return finish(collector, null);
  }

  const overridden =
    criteriaOutcome.worst === null
      ? resolved.value
      : applyFailOverride(prepared.bands, resolved.value);

  const outcome = decideOutcome(overridden, criteriaOutcome.worst);
  const earnsCredit = outcome === COURSE_OUTCOME.PASS && collector.pending.size === 0;

  return finish(collector, {
    courseRegistrationId: input.courseRegistrationId,
    evaluationSchemeId: prepared.evaluationSchemeId,
    components: componentResults,
    percentageScaled,
    grade: overridden,
    outcome,
    creditsScaled: input.creditsScaled,
    creditsEarnedScaled: earnsCredit ? input.creditsScaled : 0,
    failedCriteria: criteriaOutcome.failures,
    pendingCohortRules: [...collector.pending],
  });
}

/** Group marks by component, reporting any that cite a component off the tree. */
function bucketMarks(
  marks: readonly AssessmentValue[],
  prepared: PreparedScheme,
  collector: Collector
): ReadonlyMap<string, AssessmentValue[]> {
  const buckets = new Map<string, AssessmentValue[]>();

  for (const mark of marks) {
    if (!prepared.components.byId.has(mark.componentId)) {
      // Not fatal: a scheme may have been revised after the mark was recorded.
      // Silently including it would corrupt the total, so it is dropped loudly.
      collector.warnings.push(
        `A mark cites component ${mark.componentId}, which this scheme does not contain`
      );
      continue;
    }

    const bucket = buckets.get(mark.componentId);

    if (bucket === undefined) {
      buckets.set(mark.componentId, [mark]);
    } else {
      bucket.push(mark);
    }
  }

  return buckets;
}

/** One component's figure: leaf by aggregation, branch by rollup. */
function computeComponent(
  prepared: PreparedScheme,
  input: CourseCalculationInput,
  definition: ComponentDefinition,
  sessions: readonly AssessmentValue[],
  results: ReadonlyMap<string, ComponentResult>,
  values: ReadonlyMap<string, Scaled>,
  collector: Collector
): { readonly result: ComponentResult | null; readonly blocked: CourseOutcome | null } {
  const leaf = isLeaf(prepared.components, definition.id);
  const passMark = prepared.componentPassMarks.get(definition.id) ?? null;
  const evaluation = contextFor(prepared, input, passMark);

  let rawScaled: Scaled;
  let sessionCount = 0;

  if (leaf) {
    const sittings = applySessionRules(prepared, definition, sessions, evaluation, collector);

    if (sittings === null) {
      return { result: null, blocked: null };
    }

    const aggregated = aggregateSessions({
      component: definition,
      sessions: sittings,
      rounding: prepared.policy.marksRounding,
    });

    if (!aggregated.ok) {
      const blocked = blockedBy(aggregated.failure.code);

      if (blocked === null) {
        collector.errors.push(aggregated.failure);
        return { result: null, blocked: null };
      }

      return { result: null, blocked };
    }

    rawScaled = aggregated.value.valueScaled;
    sessionCount = aggregated.value.sessionsUsed;
  } else {
    const children = (prepared.components.childrenOf.get(definition.id) ?? []).map(
      (child) => ({ definition: child, valueScaled: values.get(child.id) ?? 0 })
    );

    const rolled = rollupChildren(definition, children, evaluation);

    if (!rolled.ok) {
      collector.errors.push(rolled.failure);
      return { result: null, blocked: null };
    }

    rawScaled = rolled.value;

    for (const child of children) {
      sessionCount += results.get(child.definition.id)?.sessionCount ?? 0;
    }
  }

  const componentRules = rulesFor(
    prepared.rules,
    definition.id,
    RulePhase.COMPONENT_ADJUSTMENT
  );

  const adjusted = applyRules(
    componentRules,
    rawScaled,
    definition.maxMarksScaled,
    evaluation
  );

  if (!adjusted.ok) {
    collector.errors.push(adjusted.failure);
    return { result: null, blocked: null };
  }

  record(collector, adjusted.value.deferredCodes);

  return {
    blocked: null,
    result: {
      componentId: definition.id,
      code: definition.code,
      isLeaf: leaf,
      rawScaled,
      adjustedScaled: adjusted.value.valueScaled,
      maxMarksScaled: definition.maxMarksScaled,
      // What this component adds to whatever contains it, in that container's
      // percentage points.
      contributionScaled: weightedContribution(
        adjusted.value.valueScaled,
        definition.maxMarksScaled,
        definition.weightageScaled,
        prepared.policy.marksRounding
      ),
      sessionCount,
    },
  };
}

/**
 * Apply SESSION_ADJUSTMENT rules to each sitting, before they combine.
 *
 * Returns NEW AssessmentValue objects; the caller's marks are never touched.
 * A sitting with no mark is passed through untouched — there is nothing to
 * scale, and inventing a zero to scale would turn an absence into a score.
 */
function applySessionRules(
  prepared: PreparedScheme,
  definition: ComponentDefinition,
  sessions: readonly AssessmentValue[],
  evaluation: EvaluationContext,
  collector: Collector
): readonly AssessmentValue[] | null {
  const rules = rulesFor(prepared.rules, definition.id, RulePhase.SESSION_ADJUSTMENT);

  if (rules.length === 0) {
    return sessions;
  }

  const adjusted: AssessmentValue[] = [];

  for (const session of sessions) {
    if (session.marksScaled === null) {
      adjusted.push(session);
      continue;
    }

    const applied = applyRules(
      rules,
      session.marksScaled,
      session.maxMarksScaled,
      evaluation
    );

    if (!applied.ok) {
      collector.errors.push(applied.failure);
      return null;
    }

    record(collector, applied.value.deferredCodes);
    adjusted.push({ ...session, marksScaled: applied.value.valueScaled });
  }

  return adjusted;
}

/**
 * Note the cohort rules a stage recognised and refused to apply.
 *
 * `deferred` is the running log — a code appears once per stage that met it —
 * while `pending` is the SET a caller acts on. Both are kept because they answer
 * different questions: how many times moderation was skipped, and whether this
 * result may be published at all.
 */
function record(collector: Collector, deferredCodes: readonly string[]): void {
  for (const code of deferredCodes) {
    collector.deferred.push(code);
    collector.pending.add(code);
  }
}

/** Which aggregation failures are academic conditions rather than errors. */
function blockedBy(code: string): CourseOutcome | null {
  switch (code) {
    case AGGREGATION_ERROR.WITHHELD_BLOCKED:
      return COURSE_OUTCOME.WITHHELD;
    case AGGREGATION_ERROR.MANDATORY_MISSING:
      return COURSE_OUTCOME.INCOMPLETE;
    case AGGREGATION_ERROR.ABSENT_FAILS:
      return COURSE_OUTCOME.FAIL;
    default:
      return null;
  }
}

/**
 * The more serious of two blocking outcomes.
 *
 * WITHHELD outranks INCOMPLETE outranks FAIL. A course that is both withheld
 * and unfinished is withheld: the student may not be told anything at all.
 */
function escalate(held: CourseOutcome | null, candidate: CourseOutcome): CourseOutcome {
  if (held === null || candidate === COURSE_OUTCOME.WITHHELD) {
    return candidate;
  }

  if (held === COURSE_OUTCOME.WITHHELD) {
    return held;
  }

  return candidate === COURSE_OUTCOME.INCOMPLETE ? candidate : held;
}

/** A result for a course that could not be totalled, stating why. */
function blockedResult(
  prepared: PreparedScheme,
  input: CourseCalculationInput,
  components: readonly ComponentResult[],
  outcome: CourseOutcome,
  collector: Collector
): CourseResultValue {
  return {
    courseRegistrationId: input.courseRegistrationId,
    evaluationSchemeId: prepared.evaluationSchemeId,
    components,
    percentageScaled: 0,
    grade: null,
    outcome,
    creditsScaled: input.creditsScaled,
    creditsEarnedScaled: 0,
    failedCriteria: [],
    pendingCohortRules: [...collector.pending],
  };
}

/** Run the passing criteria for this course. */
function checkCriteria(
  prepared: PreparedScheme,
  input: CourseCalculationInput,
  components: readonly ComponentResult[],
  collector: Collector
): {
  readonly failures: readonly CriterionFailure[];
  readonly worst: CriterionOutcome | null;
} {
  const componentScores = new Map<
    string,
    { valueScaled: Scaled; maxScaled: Scaled }
  >();

  for (const component of components) {
    componentScores.set(component.componentId, {
      valueScaled: component.adjustedScaled,
      maxScaled: component.maxMarksScaled,
    });
  }

  const { failures, unevaluated } = evaluateCriteria(prepared.criteria, {
    componentScores,
    attendancePercentScaled: input.attendancePercentScaled,
    // A semester-scoped criterion cannot be answered from one course, and is
    // checked by the semester stage instead.
    semesterCreditsEarnedScaled: null,
    rounding: prepared.policy.marksRounding,
  });

  for (const code of unevaluated) {
    collector.warnings.push(`Criterion ${code} could not be evaluated from what was supplied`);
  }

  return { failures, worst: worstOutcome(failures) };
}

/** The course's verdict, once the band and the criteria have both spoken. */
function decideOutcome(
  grade: GradeResolution,
  criterionOutcome: CriterionOutcome | null
): CourseOutcome {
  if (criterionOutcome === CriterionOutcome.INELIGIBLE) {
    return COURSE_OUTCOME.INELIGIBLE;
  }

  if (criterionOutcome === CriterionOutcome.FAIL || !grade.isPass) {
    return COURSE_OUTCOME.FAIL;
  }

  return COURSE_OUTCOME.PASS;
}

/** Assemble the computation's report. */
function finish(
  collector: Collector,
  result: CourseResultValue | null
): CourseComputation {
  return {
    result,
    warnings: collector.warnings,
    errors: collector.errors,
    pendingOperations: [...collector.pending],
    deferredCodes: collector.deferred,
  };
}

// --- Semester and degree ----------------------------------------------------

/** One course's result paired with the registration facts a GPA needs. */
export interface SemesterCourseInput {
  readonly entry: GpaCourseEntry;
  readonly computation: CourseComputation;
}

/**
 * Reduce a semester's course computations to an SGPA and a promotion verdict.
 *
 * Promotion is NOT decided here by a hardcoded rule. A student is promoted when
 * they carry no backlog and nothing is outstanding; any further condition —
 * a minimum credit count, a maximum permitted backlog — is a PassingCriterion
 * with the SEMESTER_CREDITS_EARNED metric, and is supplied by the caller as
 * `additionalFailures`. The engine does not invent one.
 *
 * COMPLEXITY : O(n) in the courses.
 */
export function calculateSemester(
  semesterId: string,
  courses: readonly SemesterCourseInput[],
  policy: RoundingPolicy,
  additionalFailures: readonly CriterionFailure[] = []
): SemesterComputation {
  const entries = courses.map((course) => course.entry);
  const results: CourseResultValue[] = [];
  const warnings: string[] = [];
  const errors: EvaluationFailure[] = [];
  const pending = new Set<string>();

  for (const course of courses) {
    warnings.push(...course.computation.warnings);
    errors.push(...course.computation.errors);

    for (const operation of course.computation.pendingOperations) {
      pending.add(operation);
    }

    if (course.computation.result !== null) {
      results.push(course.computation.result);
    }
  }

  const credits = summariseCredits(entries);
  const sgpa = computeGpa(entries, policy);

  return {
    result: {
      semesterId,
      courses: results,
      sgpa,
      backlogCount: credits.backlogCount,
      isPromoted:
        credits.backlogCount === 0 && pending.size === 0 && additionalFailures.length === 0,
    },
    credits,
    warnings,
    errors,
    pendingOperations: [...pending],
  };
}

/**
 * Reduce every semester of a degree to a CGPA, a transcript and a standing.
 *
 * The CGPA is computed from the COURSES of the whole degree, not by averaging
 * the SGPAs — see `computeCgpa` for why that distinction is not pedantry. The
 * running CGPA on each transcript line is computed the same way, over the
 * courses up to and including that semester.
 *
 * COMPLEXITY : O(n) in the courses, plus O(s) in the semesters.
 */
export function calculateStudent(
  studentId: string,
  semesters: readonly SemesterComputation[],
  entriesBySemester: readonly (readonly GpaCourseEntry[])[],
  attemptPolicy: AttemptPolicy,
  policy: RoundingPolicy,
  bands: BandTable
): StudentResult {
  const transcript: TranscriptRow[] = [];
  const pending = new Set<string>();
  const cumulative: GpaCourseEntry[] = [];

  for (let index = 0; index < semesters.length; index += 1) {
    const semester = semesters[index];
    const entries = entriesBySemester[index] ?? [];

    cumulative.push(...entries);

    for (const operation of semester.pendingOperations) {
      pending.add(operation);
    }

    // Recomputed per line rather than carried forward, because the attempt
    // policy can change which earlier attempt counts once a later re-sit lands.
    const running = computeGpa(selectAttempts(cumulative, attemptPolicy), policy);

    transcript.push({
      semesterId: semester.result.semesterId,
      creditsRegisteredScaled: semester.credits.creditsRegisteredScaled,
      creditsEarnedScaled: semester.credits.creditsEarnedScaled,
      sgpaScaled: semester.result.sgpa.valueScaled,
      cgpaScaled: running.valueScaled,
      backlogCount: semester.result.backlogCount,
    });
  }

  const reconciled = selectAttempts(cumulative, attemptPolicy);
  const cgpa = computeGpa(reconciled, policy);
  const credits = summariseCredits(reconciled);

  return {
    studentId,
    semesters: semesters.map((semester) => semester.result),
    cgpa,
    credits,
    transcript,
    standing: buildStanding(cgpa, credits, bands, policy, pending.size === 0),
    pendingOperations: [...pending],
  };
}

/**
 * Read a standing off the tenant's own bands.
 *
 * The CGPA is expressed as a percentage of the scale's ceiling and looked up in
 * the same band table that graded every course. That reuse is the point: a
 * university's idea of "first class" is stated once, in its bands, and both a
 * course grade and a degree classification read it from there.
 */
function buildStanding(
  cgpa: GpaResult,
  credits: CreditSummary,
  bands: BandTable,
  policy: RoundingPolicy,
  nothingPending: boolean
): AcademicStanding {
  const percent = gpaAsPercentage(cgpa.valueScaled, bands.maxGradePointScaled, policy);

  const band =
    percent === null
      ? null
      : findBand(
          bands,
          roundToPrecision(percent, MARK_SCALE, policy.marksPrecision, policy.marksRounding)
        );

  return {
    cgpaScaled: cgpa.valueScaled,
    cgpaPercentScaled: percent,
    classification: band?.label ?? null,
    grade: band?.grade ?? null,
    creditsEarnedScaled: credits.creditsEarnedScaled,
    backlogCount: credits.backlogCount,
    isClear: credits.backlogCount === 0 && nothingPending,
  };
}

/**
 * Render one semester as a grade card.
 *
 * A pure projection — it computes nothing. Every figure on it was decided by an
 * earlier stage, which is what makes a grade card and the stored result
 * incapable of disagreeing.
 *
 * `isProvisional` is the publication gate: while any cohort operation is
 * outstanding the marks on the card are not final, and a card that did not say
 * so would be a promise the engine cannot keep.
 *
 * COMPLEXITY : O(n) in the courses.
 */
export function buildGradeCard(
  studentId: string,
  semester: SemesterComputation
): GradeCard {
  return {
    studentId,
    semesterId: semester.result.semesterId,
    lines: semester.result.courses.map((course) => ({
      courseRegistrationId: course.courseRegistrationId,
      creditsScaled: course.creditsScaled,
      percentageScaled: course.percentageScaled,
      grade: course.grade?.grade ?? null,
      label: course.grade?.label ?? null,
      gradePointScaled: course.grade?.gradePointScaled ?? null,
      outcome: course.outcome,
      creditsEarnedScaled: course.creditsEarnedScaled,
    })),
    sgpa: semester.result.sgpa,
    credits: semester.credits,
    backlogCount: semester.result.backlogCount,
    isPromoted: semester.result.isPromoted,
    isProvisional: semester.pendingOperations.length > 0,
  };
}

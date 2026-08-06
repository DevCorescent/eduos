// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Batch Processing
// LAYER  : Domain (pure)
// PURPOSE: Compute a whole cohort, and run the passes that only a cohort can.
//
// TWO PASSES, AND WHY THERE MUST BE TWO
//   Pass one computes every student independently. Pass two applies the rules
//   that need the cohort to exist first — MODERATION shifts a cohort onto a
//   target mean, CURVE assigns grades by position, and a RELATIVE grade scale
//   does the same. None of them can be evaluated for one student, and C7.1
//   deliberately refuses to guess: it reports them as pending. THIS module is
//   the second pass those pendings were reported to.
//
// A FAILURE NEVER STOPS THE BATCH
//   One student's marks citing a retired component must not abandon the other
//   nine hundred and ninety-nine. Every student is wrapped in an EngineOutcome
//   and a thrown error is caught and converted — the batch always completes and
//   always reports exactly which students it could not compute.
//
// SHARED PREPARATION IS THE WHOLE PERFORMANCE STORY
//   `prepareScheme` indexes the component tree, indexes the rules and validates
//   the band table. Doing that per student on a 1000-student cohort would be a
//   thousand identical computations. The caller prepares each scheme ONCE and
//   passes the map in; this module never prepares anything itself, so it cannot
//   accidentally do it in a loop.
//
// COMPLEXITY
//   Pass one : O(s · (c + m)) — every student once, nothing repeated.
//   Pass two : O(n log n) per moderated or curved group, dominated by the sort.
//   Memory   : O(s) results plus ONE prepared scheme per regulation.
// ============================================================================

import { MARK_SCALE } from "@/lib/constants/resultEngine";
import { divideRounded, roundToPrecision } from "@/lib/domain/result-engine/decimal";
import {
  COURSE_OUTCOME,
  RuleOperation,
  type RegistrationType,
} from "@/lib/domain/result-engine/enums";
import {
  applyFailOverride,
  resolveGrade,
  RELATIVE_GRADING_PENDING,
  type BandTable,
} from "@/lib/domain/result-engine/grading";
import type { GpaCourseEntry } from "@/lib/domain/result-engine/gpa";
import {
  calculateCourse,
  calculateSemester,
  type CourseComputation,
  type PreparedScheme,
  type SemesterComputation,
  type SemesterCourseInput,
} from "@/lib/domain/result-engine/calculator";
import type {
  CourseCalculationInput,
  EngineOutcome,
  EvaluationFailure,
  RoundingPolicy,
  Scaled,
} from "@/lib/domain/result-engine/types";

/** Machine-readable reasons a student could not be processed. */
export const BATCH_ERROR = {
  UNKNOWN_SCHEME: "UNKNOWN_SCHEME",
  STUDENT_FAILED: "STUDENT_FAILED",
  NO_COHORT: "NO_COHORT",
} as const;

/** One course a student is registered for, with the facts a GPA needs. */
export interface BatchCourseInput {
  readonly courseId: string;
  readonly evaluationSchemeId: string;
  readonly attemptNumber: number;
  readonly registrationType: RegistrationType;
  readonly calculation: CourseCalculationInput;
}

/** One student's whole semester, as the batch consumes it. */
export interface BatchStudentInput {
  readonly studentId: string;
  readonly semesterId: string;
  readonly courses: readonly BatchCourseInput[];
}

/** One student, computed. */
export interface BatchStudentResult {
  readonly studentId: string;
  readonly semester: SemesterComputation;
  /** The GPA projections, kept so a CGPA pass need not rebuild them. */
  readonly entries: readonly GpaCourseEntry[];
  /** Cohort work still outstanding for this student. */
  readonly pendingOperations: readonly string[];
}

/** A whole cohort, computed. */
export interface BatchOutcome {
  /** One entry per student, in the order they were supplied. */
  readonly students: readonly {
    readonly studentId: string;
    readonly outcome: EngineOutcome<BatchStudentResult>;
  }[];
  readonly succeeded: number;
  readonly failed: number;
}

/**
 * Compute one student, converting anything thrown into a reported failure.
 *
 * The try/catch is not defensive clutter. Every stage below returns an outcome
 * rather than throwing, so reaching the catch means a genuine defect — and in a
 * batch, a defect that abandons the run is far worse than one that is recorded
 * against the student who triggered it.
 *
 * COMPLEXITY : O(c + m) in the student's own components and marks.
 */
export function processStudent(
  schemes: ReadonlyMap<string, PreparedScheme>,
  input: BatchStudentInput,
  policy: RoundingPolicy
): EngineOutcome<BatchStudentResult> {
  try {
    const courses: SemesterCourseInput[] = [];
    const entries: GpaCourseEntry[] = [];
    const pending = new Set<string>();

    for (const course of input.courses) {
      const prepared = schemes.get(course.evaluationSchemeId);

      if (prepared === undefined) {
        return {
          ok: false,
          failure: {
            code: BATCH_ERROR.UNKNOWN_SCHEME,
            message: "A registration cites a regulation the batch was not prepared for",
            subject: course.evaluationSchemeId,
          },
        };
      }

      const computation = calculateCourse(prepared, course.calculation);

      for (const operation of computation.pendingOperations) {
        pending.add(operation);
      }

      const entry = toGpaEntry(course, computation);

      entries.push(entry);
      courses.push({ entry, computation });
    }

    const semester = calculateSemester(input.semesterId, courses, policy);

    return {
      ok: true,
      value: {
        studentId: input.studentId,
        semester,
        entries,
        pendingOperations: [...pending],
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: BATCH_ERROR.STUDENT_FAILED,
        message: error instanceof Error ? error.message : "The student could not be computed",
        subject: input.studentId,
      },
    };
  }
}

/**
 * Project a computed course onto what the GPA stage needs.
 *
 * Declared once here rather than at each call site, because a second copy that
 * decided `countsForGpa` differently would silently produce two SGPAs for one
 * student depending on which path computed them.
 */
export function toGpaEntry(
  course: BatchCourseInput,
  computation: CourseComputation
): GpaCourseEntry {
  const result = computation.result;

  return {
    courseId: course.courseId,
    courseRegistrationId: course.calculation.courseRegistrationId,
    attemptNumber: course.attemptNumber,
    registrationType: course.registrationType,
    creditsScaled: course.calculation.creditsScaled,
    gradePointScaled: result?.grade?.gradePointScaled ?? null,
    countsForGpa: result?.grade?.countsForGpa ?? false,
    outcome: result?.outcome ?? COURSE_OUTCOME.INCOMPLETE,
  };
}

/**
 * Compute a whole cohort.
 *
 * Students are processed in the order given and the order is preserved, so two
 * runs over the same roster produce identical output — which is what makes a
 * merit list computed from this reproducible.
 *
 * COMPLEXITY : O(s · (c + m)). No student's work depends on another's, and
 *              nothing is prepared inside the loop.
 */
export function processCohort(
  schemes: ReadonlyMap<string, PreparedScheme>,
  students: readonly BatchStudentInput[],
  policy: RoundingPolicy
): BatchOutcome {
  const results: { studentId: string; outcome: EngineOutcome<BatchStudentResult> }[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const student of students) {
    const outcome = processStudent(schemes, student, policy);

    if (outcome.ok) {
      succeeded += 1;
    } else {
      failed += 1;
    }

    results.push({ studentId: student.studentId, outcome });
  }

  return { students: results, succeeded, failed };
}

/** Every student the batch could not compute, and why. */
export function batchFailures(outcome: BatchOutcome): readonly EvaluationFailure[] {
  const failures: EvaluationFailure[] = [];

  for (const student of outcome.students) {
    if (!student.outcome.ok) {
      failures.push(student.outcome.failure);
    }
  }

  return failures;
}

/** Every student the batch did compute. */
export function batchResults(outcome: BatchOutcome): readonly BatchStudentResult[] {
  const results: BatchStudentResult[] = [];

  for (const student of outcome.students) {
    if (student.outcome.ok) {
      results.push(student.outcome.value);
    }
  }

  return results;
}

// --- Pass two: the cohort operations ---------------------------------------

/** One course result as the cohort passes see it. */
export interface CohortEntry {
  readonly courseRegistrationId: string;
  readonly percentageScaled: Scaled;
}

/** What a cohort pass decided for one registration. */
export interface CohortAdjustment {
  readonly courseRegistrationId: string;
  readonly percentageScaled: Scaled;
  /** Set only by CURVE, which assigns a letter directly rather than a mark. */
  readonly grade: string | null;
}

/** Whether an operation is one this module can settle. */
export function isCohortOperation(code: string): boolean {
  return (
    code === RuleOperation.MODERATION ||
    code === RuleOperation.CURVE ||
    code === RELATIVE_GRADING_PENDING
  );
}

/** The arithmetic mean of a cohort's percentages, exactly. */
export function cohortMean(
  entries: readonly CohortEntry[],
  policy: RoundingPolicy
): Scaled | null {
  if (entries.length === 0) {
    return null;
  }

  let total = 0;

  for (const entry of entries) {
    total += entry.percentageScaled;
  }

  return divideRounded(total, entries.length, policy.marksRounding);
}

/**
 * Shift a cohort onto a target mean.
 *
 * The classic moderation: when a paper proves harder than intended, every
 * candidate is lifted by the same amount rather than individually re-marked.
 * A UNIFORM SHIFT is used rather than a rescaling because it preserves the
 * gaps between candidates — rescaling would compress or stretch them, changing
 * the relative standing of students whose marks nobody disputed.
 *
 * `maxShift` bounds it, so a regulation can permit moderation without permitting
 * an unlimited one. Absent, the shift is whatever reaching the target requires.
 *
 * Results are clamped to [0, 100]: a shift that would push a candidate above
 * full marks stops at full marks.
 *
 * COMPLEXITY : O(n), two passes — one to find the mean, one to shift.
 */
export function moderateCohort(
  entries: readonly CohortEntry[],
  config: unknown,
  policy: RoundingPolicy
): readonly CohortAdjustment[] {
  const target = readNumber(config, "targetMean");
  const mean = cohortMean(entries, policy);

  if (target === null || mean === null) {
    return entries.map((entry) => unchanged(entry));
  }

  const targetScaled = Math.round(target * 10 ** MARK_SCALE);
  const maxShift = readNumber(config, "maxShift");

  let shift = targetScaled - mean;

  if (maxShift !== null) {
    const bound = Math.abs(Math.round(maxShift * 10 ** MARK_SCALE));
    shift = Math.max(-bound, Math.min(bound, shift));
  }

  return entries.map((entry) => ({
    courseRegistrationId: entry.courseRegistrationId,
    percentageScaled: clampPercent(entry.percentageScaled + shift),
    grade: null,
  }));
}

/**
 * Assign grades by cohort position.
 *
 * The distribution names each grade and the share of the cohort that receives
 * it: `[{ grade: "O", topPercent: 10 }, { grade: "A", topPercent: 25 }, …]`,
 * where topPercent is CUMULATIVE — the top 10% get O, the next 15% get A. The
 * marks themselves are untouched; only the letter changes, because a curve is
 * a statement about rank rather than about score.
 *
 * Ties are handled explicitly: candidates on the same percentage receive the
 * same grade even when the cut-off falls between them. Splitting a tie would
 * award two different letters for one identical performance, which is
 * indefensible however the cohort was sorted.
 *
 * Anyone past the last band keeps whatever the absolute pass produced, so a
 * distribution that does not cover the cohort degrades to no change rather than
 * to an ungraded student.
 *
 * COMPLEXITY : O(n log n) for the sort, O(n) to assign.
 */
export function curveCohort(
  entries: readonly CohortEntry[],
  config: unknown
): readonly CohortAdjustment[] {
  const distribution = readDistribution(config);

  if (distribution.length === 0 || entries.length === 0) {
    return entries.map((entry) => unchanged(entry));
  }

  // Copied before sorting; descending by mark, then by id so the order is total
  // and two runs cannot disagree.
  const ordered = [...entries].sort((left, right) => {
    if (left.percentageScaled !== right.percentageScaled) {
      return right.percentageScaled - left.percentageScaled;
    }

    return left.courseRegistrationId < right.courseRegistrationId ? -1 : 1;
  });

  const assigned = new Map<string, string>();
  let position = 0;

  for (const slice of distribution) {
    const upTo = Math.ceil((slice.topPercent / 100) * ordered.length);

    while (position < ordered.length && position < upTo) {
      assigned.set(ordered[position].courseRegistrationId, slice.grade);
      position += 1;
    }

    // Extend across a tie: an identical mark cannot receive a different letter.
    while (
      position < ordered.length &&
      ordered[position].percentageScaled === ordered[position - 1]?.percentageScaled
    ) {
      assigned.set(ordered[position].courseRegistrationId, slice.grade);
      position += 1;
    }
  }

  return entries.map((entry) => ({
    courseRegistrationId: entry.courseRegistrationId,
    percentageScaled: entry.percentageScaled,
    grade: assigned.get(entry.courseRegistrationId) ?? null,
  }));
}

/**
 * Re-resolve a grade after a cohort pass moved the mark.
 *
 * Runs the SAME band lookup and the SAME fail override the first pass ran, so a
 * moderated result and an unmoderated one are graded by one rule rather than
 * two. A criterion the student already missed still overrides: moderation lifts
 * a mark, it does not excuse a shortfall in a component minimum.
 *
 * COMPLEXITY : O(log b).
 */
export function regradeAfterCohortPass(
  bands: BandTable,
  percentageScaled: Scaled,
  policy: RoundingPolicy,
  hadCriterionFailure: boolean
): EngineOutcome<{ readonly grade: ReturnType<typeof applyFailOverride>; readonly outcome: string }> {
  const resolved = resolveGrade(bands, percentageScaled, policy);

  if (!resolved.ok) {
    return resolved;
  }

  const grade = hadCriterionFailure
    ? applyFailOverride(bands, resolved.value)
    : resolved.value;

  return {
    ok: true,
    value: {
      grade,
      outcome: grade.isPass ? COURSE_OUTCOME.PASS : COURSE_OUTCOME.FAIL,
    },
  };
}

/** Hold a percentage inside [0.00, 100.00]. */
function clampPercent(value: Scaled): Scaled {
  const ceiling = 100 * 10 ** MARK_SCALE;

  return value < 0 ? 0 : value > ceiling ? ceiling : value;
}

/** An entry a pass declined to change. */
function unchanged(entry: CohortEntry): CohortAdjustment {
  return {
    courseRegistrationId: entry.courseRegistrationId,
    percentageScaled: entry.percentageScaled,
    grade: null,
  };
}

/** Read a numeric parameter from a rule's JSON config, defensively. */
function readNumber(config: unknown, key: string): number | null {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return null;
  }

  const value = (config as Record<string, unknown>)[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a curve distribution, discarding anything malformed. */
function readDistribution(
  config: unknown
): readonly { readonly grade: string; readonly topPercent: number }[] {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return [];
  }

  const raw = (config as Record<string, unknown>).distribution;

  if (!Array.isArray(raw)) {
    return [];
  }

  const slices: { grade: string; topPercent: number }[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const grade = (item as Record<string, unknown>).grade;
    const topPercent = (item as Record<string, unknown>).topPercent;

    if (
      typeof grade === "string" &&
      grade.length > 0 &&
      typeof topPercent === "number" &&
      Number.isFinite(topPercent) &&
      topPercent > 0
    ) {
      slices.push({ grade, topPercent });
    }
  }

  // Ascending, so the smallest top slice is filled first. A distribution
  // declared out of order is a configuration slip, not a reason to refuse.
  return slices.sort((left, right) => left.topPercent - right.topPercent);
}

/** Round a percentage to the regulation's precision. Exposed for reporting. */
export function presentPercent(value: Scaled, policy: RoundingPolicy): Scaled {
  return roundToPrecision(value, MARK_SCALE, policy.marksPrecision, policy.marksRounding);
}

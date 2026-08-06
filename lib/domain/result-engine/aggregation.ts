// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Aggregation
// LAYER  : Domain (pure)
// PURPOSE: Reduce one component's repeated sittings to a single figure on that
//          component's own scale.
//
// THE UNIFORM RULE
//   Every strategy computes a PROPORTION and expresses it as that proportion of
//   the component's maxMarks. Nothing returns raw marks.
//
//   This matters because sittings may carry different maxima — a paper set out
//   of 25 and a quiz out of 10 are both sittings of the same component. Under a
//   raw comparison, BEST_N would pick 18/25 over 9/10, which is the worse
//   performance. Comparing proportions is the only way "best of" means what a
//   regulation means by it.
//
//   Concretely: SUM and the selection strategies divide the selected marks by
//   the selected maxima; AVERAGE, MAX and LATEST work on per-sitting
//   proportions. All of them end on the component's scale, so the rollup that
//   consumes them never has to ask which strategy produced the number.
//
// NO UNIVERSITY POLICY IS HARDCODED
//   What an absent or withheld sitting means is read from the component's own
//   parameter bag. Universities genuinely disagree — one scores absence as
//   zero, another discounts the sitting, a third fails the component outright —
//   so the engine reads the choice rather than making it.
//
// COMPLEXITY
//   O(n log n) for the two selection strategies, which must order the sittings;
//   O(n) for every other strategy and for the status pass. n is the number of
//   sittings of ONE component — three or four in practice. Zero queries.
// ============================================================================

import {
  ABSENCE_POLICY,
  DEFAULT_ABSENCE_POLICY,
  DEFAULT_WITHHELD_POLICY,
  WITHHELD_POLICY,
  type AbsencePolicy,
  type WithheldPolicy,
} from "@/lib/constants/evaluationComponent";
import { RESULT_ENGINE_MESSAGE } from "@/lib/constants/resultEngine";
import { divideRounded, weightedContribution } from "@/lib/domain/result-engine/decimal";
import { ComponentAggregation, MarkStatus } from "@/lib/domain/result-engine/enums";
import type {
  AggregationContext,
  EngineOutcome,
  Scaled,
} from "@/lib/domain/result-engine/types";

/** Machine-readable reasons an aggregation could not produce a value. */
export const AGGREGATION_ERROR = {
  WITHHELD_BLOCKED: "WITHHELD_BLOCKED",
  ABSENT_FAILS: "ABSENT_FAILS",
  MANDATORY_MISSING: "MANDATORY_MISSING",
  MISSING_AGGREGATION: "MISSING_AGGREGATION",
  INVALID_COUNT: "INVALID_COUNT",
  IMPOSSIBLE_SELECTION: "IMPOSSIBLE_SELECTION",
} as const;

export type AggregationErrorCode =
  (typeof AGGREGATION_ERROR)[keyof typeof AGGREGATION_ERROR];

/** How a component's sittings should be treated when they are not RECORDED. */
export interface AggregationPolicy {
  readonly absent: AbsencePolicy;
  readonly withheld: WithheldPolicy;
  readonly averageWeighted: boolean;
  /** Sittings kept by BEST_N, or discarded by DROP_LOWEST_N. */
  readonly count: number | null;
}

/** What an aggregation produced, and what it had to work with. */
export interface AggregationResult {
  /** On the component's own maxMarks scale. */
  readonly valueScaled: Scaled;
  readonly sessionsUsed: number;
  readonly sessionsIgnored: number;
}

/** One sitting reduced to the two numbers a strategy needs. */
interface Candidate {
  readonly marksScaled: Scaled;
  readonly maxScaled: Scaled;
  readonly sequenceNumber: number;
  /** marks/max as a scaled proportion, for comparison across different maxima. */
  readonly proportionScaled: Scaled;
}

function failure(code: AggregationErrorCode, message: string): EngineOutcome<never> {
  return { ok: false, failure: { code, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the aggregation policy from a component's parameter bag.
 *
 * Defensive throughout: `ruleConfig` is a JSON column, so a value written
 * before a rule tightened may not match today's shape. An unrecognised value
 * falls back to the documented default rather than throwing inside a grade
 * computation — a malformed policy must not be able to stop a cohort.
 */
export function readAggregationPolicy(ruleConfig: unknown): AggregationPolicy {
  const config = isPlainObject(ruleConfig) ? ruleConfig : {};

  const absent = config.absentPolicy;
  const withheld = config.withheldPolicy;
  const count = config.count;

  return {
    absent:
      typeof absent === "string" && absent in ABSENCE_POLICY
        ? (absent as AbsencePolicy)
        : DEFAULT_ABSENCE_POLICY,
    withheld:
      typeof withheld === "string" && withheld in WITHHELD_POLICY
        ? (withheld as WithheldPolicy)
        : DEFAULT_WITHHELD_POLICY,
    averageWeighted: config.averageWeighted === true,
    count: typeof count === "number" && Number.isInteger(count) && count > 0 ? count : null,
  };
}

/**
 * Reduce the sittings to the candidates a strategy will actually see.
 *
 * This is where the whole status vocabulary is resolved, and it is the only
 * place that reads it — every strategy below works on plain numbers and has no
 * idea a sitting could have been absent.
 */
function selectCandidates(
  context: AggregationContext,
  policy: AggregationPolicy
): EngineOutcome<{ candidates: Candidate[]; ignored: number }> {
  const componentMax = context.component.maxMarksScaled;
  const candidates: Candidate[] = [];
  let ignored = 0;

  for (const session of context.sessions) {
    if (session.status === MarkStatus.WITHHELD) {
      if (policy.withheld === WITHHELD_POLICY.BLOCK) {
        return failure(
          AGGREGATION_ERROR.WITHHELD_BLOCKED,
          RESULT_ENGINE_MESSAGE.WITHHELD_MARK
        );
      }

      ignored += 1;
      continue;
    }

    if (session.status === MarkStatus.ABSENT) {
      if (policy.absent === ABSENCE_POLICY.FAIL) {
        return failure(
          AGGREGATION_ERROR.ABSENT_FAILS,
          "A sitting was missed and this component does not permit absence"
        );
      }

      if (policy.absent === ABSENCE_POLICY.IGNORE) {
        ignored += 1;
        continue;
      }

      // ZERO: the sitting still occupies its place, scoring nothing. Its
      // maximum still counts, which is what makes an average divide by three
      // rather than two.
      candidates.push({
        marksScaled: 0,
        maxScaled: session.maxMarksScaled,
        sequenceNumber: session.sequenceNumber,
        proportionScaled: 0,
      });
      continue;
    }

    // RECORDED. A null mark here would contradict the invariant C6.2 enforces,
    // so it is treated as a zero rather than trusted.
    const marksScaled = session.marksScaled ?? 0;

    candidates.push({
      marksScaled,
      maxScaled: session.maxMarksScaled,
      sequenceNumber: session.sequenceNumber,
      // Expressed against the COMPONENT's scale so two sittings with different
      // maxima are directly comparable.
      proportionScaled: weightedContribution(
        marksScaled,
        session.maxMarksScaled,
        componentMax,
        context.rounding
      ),
    });
  }

  return { ok: true, value: { candidates, ignored } };
}

/**
 * Order candidates by performance, then by sitting number.
 *
 * The second key is what makes BEST_N and DROP_LOWEST_N DETERMINISTIC when two
 * sittings score identically: without it, which one survives would depend on
 * the order rows came back in, and two runs of the same computation could
 * disagree. Ties resolve toward the earlier sitting.
 */
function byPerformance(left: Candidate, right: Candidate): number {
  if (left.proportionScaled !== right.proportionScaled) {
    return left.proportionScaled - right.proportionScaled;
  }

  return left.sequenceNumber - right.sequenceNumber;
}

/** Total the selected sittings and express them on the component's scale. */
function totalOf(
  selected: readonly Candidate[],
  componentMax: Scaled,
  rounding: AggregationContext["rounding"]
): Scaled {
  let marks = 0;
  let maximum = 0;

  for (const candidate of selected) {
    marks += candidate.marksScaled;
    maximum += candidate.maxScaled;
  }

  return weightedContribution(marks, maximum, componentMax, rounding);
}

/** The mean of the selected sittings' proportions. */
function meanOf(
  selected: readonly Candidate[],
  rounding: AggregationContext["rounding"]
): Scaled {
  let sum = 0;

  for (const candidate of selected) {
    sum += candidate.proportionScaled;
  }

  return divideRounded(sum, selected.length, rounding);
}

/**
 * Reduce a component's sittings to one figure.
 *
 * Returns an outcome rather than throwing, so a batch records which student
 * could not be computed and carries on.
 */
export function aggregateSessions(
  context: AggregationContext
): EngineOutcome<AggregationResult> {
  const { component, sessions, rounding } = context;
  const policy = readAggregationPolicy(component.ruleConfig);

  if (sessions.length === 0) {
    if (component.isMandatory) {
      return failure(
        AGGREGATION_ERROR.MANDATORY_MISSING,
        RESULT_ENGINE_MESSAGE.MISSING_MANDATORY
      );
    }

    // Optional and unattempted contributes nothing, which is what not doing an
    // optional assignment means.
    return { ok: true, value: { valueScaled: 0, sessionsUsed: 0, sessionsIgnored: 0 } };
  }

  if (component.aggregation === null) {
    return failure(
      AGGREGATION_ERROR.MISSING_AGGREGATION,
      "A component with sittings declares no aggregation"
    );
  }

  const selected = selectCandidates(context, policy);

  if (!selected.ok) {
    return selected;
  }

  const { candidates, ignored } = selected.value;

  if (candidates.length === 0) {
    // Every sitting was discounted by policy. Not a failure — the component
    // simply carries nothing, exactly as if it had not been attempted.
    return { ok: true, value: { valueScaled: 0, sessionsUsed: 0, sessionsIgnored: ignored } };
  }

  const componentMax = component.maxMarksScaled;

  switch (component.aggregation) {
    case ComponentAggregation.SUM:
      return {
        ok: true,
        value: {
          valueScaled: totalOf(candidates, componentMax, rounding),
          sessionsUsed: candidates.length,
          sessionsIgnored: ignored,
        },
      };

    case ComponentAggregation.AVERAGE:
      return {
        ok: true,
        value: {
          valueScaled: policy.averageWeighted
            ? // Weighted: a 50-mark paper counts for more than a 10-mark quiz,
              // which is exactly what totalling marks over totalled maxima does.
              totalOf(candidates, componentMax, rounding)
            : meanOf(candidates, rounding),
          sessionsUsed: candidates.length,
          sessionsIgnored: ignored,
        },
      };

    case ComponentAggregation.MAX: {
      const best = [...candidates].sort(byPerformance)[candidates.length - 1];

      return {
        ok: true,
        value: {
          valueScaled: best.proportionScaled,
          sessionsUsed: 1,
          sessionsIgnored: ignored + candidates.length - 1,
        },
      };
    }

    case ComponentAggregation.LATEST: {
      // By SITTING NUMBER, never by array order. The repository's ordering is a
      // presentation choice; the sitting number is the fact.
      const latest = candidates.reduce((furthest, candidate) =>
        candidate.sequenceNumber > furthest.sequenceNumber ? candidate : furthest
      );

      return {
        ok: true,
        value: {
          valueScaled: latest.proportionScaled,
          sessionsUsed: 1,
          sessionsIgnored: ignored + candidates.length - 1,
        },
      };
    }

    case ComponentAggregation.BEST_N: {
      if (policy.count === null) {
        return failure(
          AGGREGATION_ERROR.INVALID_COUNT,
          "BEST_N requires a positive integer ruleConfig.count"
        );
      }

      // Keeping more than exist is not an error — "best 3 of however many sat"
      // is a coherent instruction when only two sittings happened.
      const keep = Math.min(policy.count, candidates.length);
      const ordered = [...candidates].sort(byPerformance);
      const kept = ordered.slice(ordered.length - keep);

      return {
        ok: true,
        value: {
          valueScaled: totalOf(kept, componentMax, rounding),
          sessionsUsed: kept.length,
          sessionsIgnored: ignored + candidates.length - kept.length,
        },
      };
    }

    case ComponentAggregation.DROP_LOWEST_N: {
      if (policy.count === null) {
        return failure(
          AGGREGATION_ERROR.INVALID_COUNT,
          "DROP_LOWEST_N requires a positive integer ruleConfig.count"
        );
      }

      if (policy.count >= candidates.length) {
        // Dropping everything leaves nothing to grade. Unlike BEST_N, this
        // cannot be clamped into something sensible — a component that
        // discarded all its own marks is a misconfiguration, not a result.
        return failure(
          AGGREGATION_ERROR.IMPOSSIBLE_SELECTION,
          `Dropping ${policy.count} of ${candidates.length} sittings would leave nothing to grade`
        );
      }

      const ordered = [...candidates].sort(byPerformance);
      const survivors = ordered.slice(policy.count);

      return {
        ok: true,
        value: {
          valueScaled: totalOf(survivors, componentMax, rounding),
          sessionsUsed: survivors.length,
          sessionsIgnored: ignored + policy.count,
        },
      };
    }

    default:
      // Unreachable while ComponentAggregation holds only the members above.
      // If a member is added to the schema, this is where it surfaces — as a
      // reported failure rather than a silently wrong grade.
      return failure(
        AGGREGATION_ERROR.MISSING_AGGREGATION,
        `Unsupported aggregation: ${String(component.aggregation)}`
      );
  }
}

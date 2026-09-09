// ============================================================================
// MODULE : Evaluation Scheme — Management Form Fields
// PURPOSE: The field lists behind every Scheme management dialog: the
//          regulation itself, and the three sub-collections beneath it.
//
// WHY THESE EXIST AT ALL
//   The Evaluation Scheme API has been complete since Phase 16 — create,
//   amend, discard, activate, archive, and full CRUD over components, rules and
//   passing criteria, every mutation gated on EVALUATION_SCHEME_MANAGE_ROLES.
//   None of it was ever reachable: services/evaluation.ts exposed only reads,
//   there were no server actions, and neither the list page nor the detail page
//   rendered a single control. These field lists are what let the existing
//   endpoints be driven from the existing dialog component.
//
// WHY PLAIN DATA AND NOT COMPONENTS
//   EntityFormModal generates its inputs from a field array precisely so this
//   costs functions rather than wrapper components. No "use client" directive
//   is needed: these export functions returning serialisable arrays, which a
//   Server Component builds and hands to EntityCreateButton / EntityRowActions
//   like any other prop. Same shape as scheduleClassFields.ts.
//
// NONE OF THIS IS THE AUTHORIZATION
//   Every dialog these feed posts to an endpoint that re-applies
//   EVALUATION_SCHEME_MANAGE_ROLES and re-resolves the tenant from the session.
//   The pages withhold the controls from a reader; the API refuses the reader
//   regardless of what was rendered.
//
// THE BOUNDS ARE IMPORTED, NEVER RETYPED
//   Every min/max below comes from the same constants the Zod schemas use, so a
//   value the browser accepts is one the schema will accept. A hand-copied
//   bound would drift and turn a client-side guard into a lie.
// ============================================================================

import type { FormField, FormValues } from "@/components/shared/EntityFormModal";
import type { SelectOption } from "@/components/ui/Select";
import {
  EVALUATION_SCHEME_CODE_MAX_LENGTH,
  EVALUATION_SCHEME_NAME_MAX_LENGTH,
  PRECISION_MAX,
  PRECISION_MIN,
} from "@/lib/constants/evaluationScheme";
import {
  EVALUATION_COMPONENT_CODE_MAX_LENGTH,
  EVALUATION_COMPONENT_NAME_MAX_LENGTH,
  MAX_MARKS_MAX,
  MAX_MARKS_MIN,
  SEQUENCE_MAX,
  SEQUENCE_MIN,
  WEIGHTAGE_MAX,
  WEIGHTAGE_MIN,
} from "@/lib/constants/evaluationComponent";
import {
  PASSING_CRITERION_CODE_MAX_LENGTH,
  PASSING_CRITERION_NAME_MAX_LENGTH,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
} from "@/lib/constants/passingCriterion";
import {
  EVALUATION_RULE_CODE_MAX_LENGTH,
  EVALUATION_RULE_NAME_MAX_LENGTH,
  RULE_AMOUNT_MAX,
  RULE_AMOUNT_MIN,
  RULE_FACTOR_MAX,
  RULE_FACTOR_MIN,
  RULE_LIMIT_MAX,
  RULE_LIMIT_MIN,
  RULE_PERCENT_MAX,
  RULE_PERCENT_MIN,
  RULE_SEQUENCE_MAX,
  RULE_SEQUENCE_MIN,
  RULE_STDDEV_MAX,
  RULE_STDDEV_MIN,
} from "@/lib/constants/evaluationRule";
import {
  AttemptPolicy,
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  CriterionOutcome,
  EvaluationComponentType,
  PassingMetric,
  RoundingMode,
  RulePhase,
  ThresholdUnit,
} from "@/app/generated/prisma/enums";
import type { EvaluationSchemeDTO } from "@/lib/dto/evaluationScheme.dto";
import type { EvaluationComponentDTO } from "@/lib/dto/evaluationComponent.dto";
import type { EvaluationRuleDTO } from "@/lib/dto/evaluationRule.dto";
import type { PassingCriterionDTO } from "@/lib/dto/passingCriterion.dto";

/** Enum members as select options, in declaration order. */
function options(members: Record<string, string>): SelectOption[] {
  return Object.values(members).map((value) => ({ value, label: value }));
}

/**
 * The sentinel a nullable reference select uses for "none".
 *
 * FormValues holds strings, so "no parent" and "not yet chosen" would otherwise
 * both be "" and be indistinguishable. The actions translate this back to an
 * explicit null, which is what promotes a nested component to the top level.
 */
export const NONE_VALUE = "__none__";

// --- The regulation itself --------------------------------------------------

/**
 * The Scheme create/edit dialog.
 *
 * `code` is offered on CREATE only. It is the identity a revision shares with
 * its siblings and is omitted from updateEvaluationSchemeSchema entirely, so
 * rendering it on an edit form would present a field the endpoint silently
 * discards.
 *
 * `gradeScaleId` is a select over GET /api/grade-scales rather than a text
 * input: it is required, it is an opaque cuid, and before that route existed
 * there was no way for any client to discover a legal value — which is why
 * creating a scheme was unreachable regardless of role.
 */
export function schemeFields(
  gradeScales: SelectOption[],
  mode: "create" | "edit"
): FormField[] {
  return [
    ...(mode === "create"
      ? ([
          {
            kind: "text",
            name: "code",
            label: "Code",
            required: true,
            maxLength: EVALUATION_SCHEME_CODE_MAX_LENGTH,
            placeholder: "BTECH-R2025",
            helperText:
              "Upper-case letters, digits, dashes and underscores. Permanent — a revision keeps its code for life.",
          },
        ] as FormField[])
      : []),
    {
      kind: "text",
      name: "name",
      label: "Name",
      required: true,
      maxLength: EVALUATION_SCHEME_NAME_MAX_LENGTH,
      placeholder: "B.Tech Regulation 2025",
    },
    {
      kind: "textarea",
      name: "description",
      label: "Description",
      rows: 3,
      helperText: "Optional.",
    },
    {
      kind: "select",
      name: "gradeScaleId",
      label: "Grade scale",
      required: true,
      options: gradeScales,
      placeholder: "Select a grade scale",
      helperText: "The scale must be active before this scheme can be activated.",
    },
    {
      kind: "select",
      name: "attemptPolicy",
      label: "Attempt policy",
      required: true,
      options: options(AttemptPolicy),
    },
    {
      kind: "select",
      name: "marksRounding",
      label: "Marks rounding",
      required: true,
      options: options(RoundingMode),
    },
    {
      kind: "number",
      name: "marksPrecision",
      label: "Marks precision",
      required: true,
      min: PRECISION_MIN,
      max: PRECISION_MAX,
      helperText: "Decimal places kept on a computed mark.",
    },
    {
      kind: "select",
      name: "gpaRounding",
      label: "GPA rounding",
      required: true,
      options: options(RoundingMode),
    },
    {
      kind: "number",
      name: "gpaPrecision",
      label: "GPA precision",
      required: true,
      min: PRECISION_MIN,
      max: PRECISION_MAX,
      helperText: "Decimal places kept on SGPA and CGPA.",
    },
  ];
}

/** The empty Scheme form, so a create dialog opens on defined values. */
export const SCHEME_DEFAULTS: FormValues = {
  code: "",
  name: "",
  description: "",
  gradeScaleId: "",
  attemptPolicy: AttemptPolicy.BEST_ATTEMPT,
  marksRounding: RoundingMode.HALF_UP,
  marksPrecision: 2,
  gpaRounding: RoundingMode.HALF_UP,
  gpaPrecision: 2,
};

/**
 * One stored scheme as edit-form values.
 *
 * Takes the LIST DTO rather than the detail one: every field the edit form
 * carries is on the base shape, so the schemes table can raise the same dialog
 * without a second read per row.
 */
export function schemeEditValues(scheme: EvaluationSchemeDTO): FormValues {
  return {
    name: scheme.name,
    description: scheme.description ?? "",
    gradeScaleId: scheme.gradeScaleId,
    attemptPolicy: scheme.attemptPolicy,
    marksRounding: scheme.marksRounding,
    marksPrecision: scheme.marksPrecision,
    gpaRounding: scheme.gpaRounding,
    gpaPrecision: scheme.gpaPrecision,
  };
}

// --- Components -------------------------------------------------------------

/**
 * The Component create/edit dialog.
 *
 * `aggregation` and `rollup` are mutually exclusive — the schema refuses a
 * component declaring both — so each carries a "none" option and the refusal is
 * explained in the helper text rather than discovered from a 400.
 *
 * `ruleConfig` is NOT offered. It is a nested, per-aggregation JSON object
 * (BEST_N's n, DROP_LOWEST_N's n), optional and nullable on the schema, and a
 * flat generated form cannot express it. Omitting an optional field is a
 * smaller lie than rendering one that cannot be filled in correctly.
 */
export function componentFields(parents: SelectOption[]): FormField[] {
  return [
    {
      kind: "text",
      name: "code",
      label: "Code",
      required: true,
      maxLength: EVALUATION_COMPONENT_CODE_MAX_LENGTH,
      placeholder: "INTERNAL",
    },
    {
      kind: "text",
      name: "name",
      label: "Name",
      required: true,
      maxLength: EVALUATION_COMPONENT_NAME_MAX_LENGTH,
      placeholder: "Internal Assessment",
    },
    {
      kind: "textarea",
      name: "description",
      label: "Description",
      rows: 2,
      helperText: "Optional.",
    },
    {
      kind: "select",
      name: "parentComponentId",
      label: "Parent component",
      required: true,
      options: [{ value: NONE_VALUE, label: "None — top level" }, ...parents],
      helperText: "A child's weightage is a share of its parent, not of the course.",
    },
    {
      kind: "select",
      name: "type",
      label: "Type",
      required: true,
      options: options(EvaluationComponentType),
    },
    {
      kind: "select",
      name: "sourceType",
      label: "Source",
      required: true,
      options: options(ComponentSource),
      helperText: "Where this component's marks come from.",
    },
    {
      kind: "number",
      name: "maxMarks",
      label: "Maximum marks",
      required: true,
      min: MAX_MARKS_MIN,
      max: MAX_MARKS_MAX,
    },
    {
      kind: "number",
      name: "weightage",
      label: "Weightage (%)",
      required: true,
      min: WEIGHTAGE_MIN,
      max: WEIGHTAGE_MAX,
    },
    {
      kind: "select",
      name: "aggregation",
      label: "Aggregation",
      required: true,
      options: [{ value: NONE_VALUE, label: "None" }, ...options(ComponentAggregation)],
      helperText: "How this component's own sittings reduce to one figure.",
    },
    {
      kind: "select",
      name: "rollup",
      label: "Rollup",
      required: true,
      options: [{ value: NONE_VALUE, label: "None" }, ...options(ComponentRollup)],
      helperText: "How its children reduce to its figure. A component cannot have both.",
    },
    {
      kind: "number",
      name: "sequence",
      label: "Sequence",
      required: true,
      min: SEQUENCE_MIN,
      max: SEQUENCE_MAX,
    },
    { kind: "switch", name: "isMandatory", label: "Mandatory" },
  ];
}

export const COMPONENT_DEFAULTS: FormValues = {
  code: "",
  name: "",
  description: "",
  parentComponentId: NONE_VALUE,
  type: EvaluationComponentType.THEORY,
  sourceType: ComponentSource.MANUAL_ENTRY,
  maxMarks: 100,
  weightage: 100,
  aggregation: NONE_VALUE,
  rollup: NONE_VALUE,
  sequence: 1,
  isMandatory: true,
};

/** One stored component as edit-form values. */
export function componentEditValues(component: EvaluationComponentDTO): FormValues {
  return {
    code: component.code,
    name: component.name,
    description: component.description ?? "",
    parentComponentId: component.parentComponentId ?? NONE_VALUE,
    type: component.type,
    sourceType: component.sourceType,
    maxMarks: component.maxMarks,
    weightage: component.weightage,
    aggregation: component.aggregation ?? NONE_VALUE,
    rollup: component.rollup ?? NONE_VALUE,
    sequence: component.sequence,
    isMandatory: component.isMandatory,
  };
}

// --- Passing criteria -------------------------------------------------------

/**
 * The Passing Criterion create/edit dialog.
 *
 * `componentId` is nullable: COMPONENT_SCORE names a component,
 * ATTENDANCE_PERCENT and SEMESTER_CREDITS_EARNED do not. The service checks
 * that coherence against the merged values, so the form offers both and lets
 * the endpoint be the arbiter rather than encoding a second copy of the rule.
 */
export function criterionFields(components: SelectOption[]): FormField[] {
  return [
    {
      kind: "text",
      name: "code",
      label: "Code",
      required: true,
      maxLength: PASSING_CRITERION_CODE_MAX_LENGTH,
      placeholder: "MIN-INTERNAL",
    },
    {
      kind: "text",
      name: "name",
      label: "Name",
      required: true,
      maxLength: PASSING_CRITERION_NAME_MAX_LENGTH,
      placeholder: "Minimum internal marks",
    },
    {
      kind: "textarea",
      name: "description",
      label: "Description",
      rows: 2,
      helperText: "Optional.",
    },
    {
      kind: "select",
      name: "metric",
      label: "Metric",
      required: true,
      options: options(PassingMetric),
    },
    {
      kind: "select",
      name: "componentId",
      label: "Component",
      required: true,
      options: [{ value: NONE_VALUE, label: "None — applies to the whole course" }, ...components],
      helperText: "Required for a component score; leave as None for the other metrics.",
    },
    {
      kind: "number",
      name: "threshold",
      label: "Threshold",
      required: true,
      min: THRESHOLD_MIN,
      max: THRESHOLD_MAX,
    },
    {
      kind: "select",
      name: "unit",
      label: "Unit",
      required: true,
      options: options(ThresholdUnit),
    },
    {
      kind: "select",
      name: "failureOutcome",
      label: "Failure outcome",
      required: true,
      options: options(CriterionOutcome),
    },
  ];
}

export const CRITERION_DEFAULTS: FormValues = {
  code: "",
  name: "",
  description: "",
  metric: PassingMetric.COMPONENT_SCORE,
  componentId: NONE_VALUE,
  threshold: 40,
  unit: ThresholdUnit.PERCENT,
  failureOutcome: CriterionOutcome.FAIL,
};

/** One stored criterion as edit-form values. */
export function criterionEditValues(criterion: PassingCriterionDTO): FormValues {
  return {
    code: criterion.code,
    name: criterion.name,
    description: criterion.description ?? "",
    metric: criterion.metric,
    componentId: criterion.componentId ?? NONE_VALUE,
    threshold: criterion.threshold,
    unit: criterion.unit,
    failureOutcome: criterion.failureOutcome,
  };
}

// --- Rules ------------------------------------------------------------------

/**
 * The rule operations this generated form can author.
 *
 * SEVEN OF THE NINE. Each of these takes a config of one or two bounded
 * numbers, which a flat form expresses exactly.
 *
 * CURVE and CUSTOM_FORMULA are deliberately absent. CURVE's config is an array
 * of {grade, topPercent} bands; CUSTOM_FORMULA's is a RECURSIVE expression tree
 * validated by validateFormulaExpression. Neither is expressible as a flat
 * field list, and building an expression editor would be inventing a workflow
 * rather than exposing the existing one. They remain fully supported by the
 * API — a rule of either kind created there is listed, edited for its scalar
 * fields and deleted through this UI like any other; only authoring their
 * config is out of reach here. This is recorded rather than hidden.
 */
export const FORM_AUTHORABLE_RULE_OPERATIONS = [
  "ADD_CONSTANT",
  "ADD_PERCENTAGE",
  "SCALE",
  "CAP",
  "FLOOR",
  "GRACE",
  "MODERATION",
] as const;

export type FormAuthorableRuleOperation =
  (typeof FORM_AUTHORABLE_RULE_OPERATIONS)[number];

/** The config key each authorable operation carries, and its bounds. */
const RULE_CONFIG_FIELDS: Record<
  FormAuthorableRuleOperation,
  ReadonlyArray<{ name: string; label: string; min: number; max: number }>
> = {
  ADD_CONSTANT: [
    { name: "amount", label: "Amount", min: RULE_AMOUNT_MIN, max: RULE_AMOUNT_MAX },
  ],
  ADD_PERCENTAGE: [
    { name: "percent", label: "Percent", min: RULE_PERCENT_MIN, max: RULE_PERCENT_MAX },
  ],
  SCALE: [{ name: "factor", label: "Factor", min: RULE_FACTOR_MIN, max: RULE_FACTOR_MAX }],
  CAP: [{ name: "limit", label: "Limit", min: RULE_LIMIT_MIN, max: RULE_LIMIT_MAX }],
  FLOOR: [{ name: "limit", label: "Limit", min: RULE_LIMIT_MIN, max: RULE_LIMIT_MAX }],
  GRACE: [
    { name: "maxAward", label: "Maximum award", min: RULE_LIMIT_MIN, max: RULE_LIMIT_MAX },
  ],
  MODERATION: [
    { name: "targetMean", label: "Target mean", min: RULE_LIMIT_MIN, max: RULE_LIMIT_MAX },
    {
      name: "targetStdDev",
      label: "Target standard deviation",
      min: RULE_STDDEV_MIN,
      max: RULE_STDDEV_MAX,
    },
  ],
};

/**
 * Every config input, each shown only for the operation that owns it.
 *
 * Conditional visibility is what makes one dialog serve seven operations: a
 * hidden field is skipped by validation AND left out of the payload, so
 * switching the operation cannot leave a stale required field blocking
 * submission or a stale value being sent.
 *
 * `visibleWhenIn` — the DATA form of the rule — rather than the `visibleWhen`
 * predicate, because this array is built in a Server Component and handed to a
 * Client one. A function cannot cross that boundary: React refuses to serialise
 * it and the page fails to render, which is exactly what the first version of
 * this did.
 *
 * Two operations share the key `limit`, which is correct — CAP and FLOOR take
 * the same parameter — so that field lists both and its bounds stay defined
 * once.
 */
function ruleConfigFields(): FormField[] {
  const owners = new Map<string, { label: string; min: number; max: number; ops: string[] }>();

  for (const operation of FORM_AUTHORABLE_RULE_OPERATIONS) {
    for (const field of RULE_CONFIG_FIELDS[operation]) {
      const existing = owners.get(field.name);

      if (existing) {
        existing.ops.push(operation);
        continue;
      }

      owners.set(field.name, {
        label: field.label,
        min: field.min,
        max: field.max,
        ops: [operation],
      });
    }
  }

  return [...owners.entries()].map(([name, field]) => ({
    kind: "number",
    name,
    label: field.label,
    required: true,
    min: field.min,
    max: field.max,
    visibleWhenIn: { field: "operation", values: field.ops },
  }));
}

/**
 * The Rule create/edit dialog.
 *
 * A rule's phase decides whether it may name a component: the schema's
 * checkRuleScope refuses a COURSE_ADJUSTMENT rule that names one, and requires
 * one where the phase is component-scoped. That rule is not re-implemented
 * here — the endpoint reports it against the right field — but the helper text
 * says which way round it goes.
 */
export function ruleFields(components: SelectOption[]): FormField[] {
  return [
    {
      kind: "text",
      name: "code",
      label: "Code",
      required: true,
      maxLength: EVALUATION_RULE_CODE_MAX_LENGTH,
      placeholder: "GRACE-5",
    },
    {
      kind: "text",
      name: "name",
      label: "Name",
      required: true,
      maxLength: EVALUATION_RULE_NAME_MAX_LENGTH,
      placeholder: "Grace up to 5 marks",
    },
    {
      kind: "textarea",
      name: "description",
      label: "Description",
      rows: 2,
      helperText: "Optional.",
    },
    {
      kind: "select",
      name: "phase",
      label: "Phase",
      required: true,
      options: options(RulePhase),
      helperText: "Where in the pipeline this runs.",
    },
    {
      kind: "select",
      name: "componentId",
      label: "Component",
      required: true,
      options: [
        { value: NONE_VALUE, label: "None — applies to the course total" },
        ...components,
      ],
      helperText: "A course-adjustment rule must leave this as None.",
    },
    {
      kind: "select",
      name: "operation",
      label: "Operation",
      required: true,
      options: FORM_AUTHORABLE_RULE_OPERATIONS.map((value) => ({ value, label: value })),
      helperText:
        "Curve and custom-formula rules carry a nested configuration and are managed through the API.",
    },
    ...ruleConfigFields(),
    {
      kind: "number",
      name: "sequence",
      label: "Sequence",
      required: true,
      min: RULE_SEQUENCE_MIN,
      max: RULE_SEQUENCE_MAX,
      helperText: "Rules compose, so order changes the result.",
    },
  ];
}

export const RULE_DEFAULTS: FormValues = {
  code: "",
  name: "",
  description: "",
  phase: RulePhase.COMPONENT_ADJUSTMENT,
  componentId: NONE_VALUE,
  operation: "ADD_CONSTANT",
  amount: 0,
  percent: 0,
  factor: 1,
  limit: 0,
  maxAward: 0,
  targetMean: 0,
  targetStdDev: 1,
  sequence: 1,
};

/**
 * Whether this stored rule's operation can be authored by the generated form.
 *
 * A CURVE or CUSTOM_FORMULA rule is still listed and still deletable; it is its
 * EDIT dialog that is withheld, because saving one through this form would have
 * to send a config the form cannot represent.
 */
export function isFormAuthorableRule(rule: EvaluationRuleDTO): boolean {
  return (FORM_AUTHORABLE_RULE_OPERATIONS as readonly string[]).includes(rule.operation);
}

/** One stored rule as edit-form values. */
export function ruleEditValues(rule: EvaluationRuleDTO): FormValues {
  // Config is a per-operation union; the reads below are narrowed by the
  // operation the row carries, and every key absent from it keeps its default.
  const config = (rule.config ?? {}) as Record<string, unknown>;

  const numeric = (key: string, fallback: number): number => {
    const value = config[key];
    return typeof value === "number" ? value : fallback;
  };

  return {
    ...RULE_DEFAULTS,
    code: rule.code,
    name: rule.name,
    description: rule.description ?? "",
    phase: rule.phase,
    componentId: rule.componentId ?? NONE_VALUE,
    operation: rule.operation,
    amount: numeric("amount", 0),
    percent: numeric("percent", 0),
    factor: numeric("factor", 1),
    limit: numeric("limit", 0),
    maxAward: numeric("maxAward", 0),
    targetMean: numeric("targetMean", 0),
    targetStdDev: numeric("targetStdDev", 1),
    sequence: rule.sequence,
  };
}

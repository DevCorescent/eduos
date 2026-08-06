// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Vocabulary
// LAYER  : Domain (pure)
// PURPOSE: The single import surface for every enumerated vocabulary the engine
//          speaks.
//
// THIS FILE DEFINES NOTHING NEW, AND THAT IS DELIBERATE
//   Every vocabulary the engine reasons about is already declared exactly once:
//   the assessment and configuration enums in the Prisma schema, and the
//   engine's own outcome vocabulary in lib/constants/resultEngine.ts. Declaring
//   domain copies here would create a second definition that drifts the moment
//   a member is added to the schema — a RoundingMode the database accepts and
//   the engine has never heard of is precisely the failure this re-export
//   prevents.
//
//   What it buys is one import line for the rest of the engine instead of
//   three, and one place to read what the engine's vocabulary actually is.
//
// ON "NO PRISMA DEPENDENCY"
//   These come from the generated `enums` module, which is nothing but frozen
//   const objects — no client, no connection, no query builder. The engine can
//   be evaluated with no database and no environment, which its tests
//   demonstrate. Re-declaring them to avoid the import would trade a real
//   guarantee for the appearance of one.
// ============================================================================

export {
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  CriterionOutcome,
  EvaluationComponentType,
  GradeCalculationMethod,
  MarkStatus,
  PassingMetric,
  RegistrationType,
  RoundingMode,
  RulePhase,
  RuleOperation,
  ThresholdUnit,
} from "@/app/generated/prisma/enums";

export {
  COURSE_OUTCOME,
  CREDIT_BEARING_OUTCOMES,
  UNRESOLVED_OUTCOMES,
  type CourseOutcome,
} from "@/lib/constants/resultEngine";

export {
  FORMULA_NODE_KIND,
  FORMULA_OPERATOR,
  FORMULA_VARIABLE,
  CONDITION_COMPARATOR,
  type ConditionComparator,
  type FormulaNodeKind,
  type FormulaOperator,
  type FormulaVariable,
} from "@/lib/constants/evaluationRule";

// ============================================================================
// OWNER      : Gauransh
// MODULE     : Identifier Engine (PRD §9)
// LAYER      : Domain
// PURPOSE    : Turn a sequence configuration plus an issued number into the
//              printed identifier. Pure — no database, no clock, no randomness.
//
// WHY THIS IS A SEPARATE, PURE MODULE
//   Formatting is the part a university administrator configures and previews,
//   and it is the part that must be provably identical between the preview
//   screen and the number actually issued. A preview that formats differently
//   from the generator is worse than no preview: it promises a shape the
//   register will not contain. Keeping it pure means the preview endpoint and
//   the generator call the same function with the same arguments, and it can be
//   exhaustively unit-tested without a database.
//
// THE CLOCK IS AN INPUT, NEVER READ HERE
//   `year` and `month` are passed in. The generator reads them from the
//   DATABASE's clock in the same statement that issues the number, so a
//   server with a skewed clock cannot stamp a number with a year the reset
//   logic disagrees about. A pure function that called Date.now() would also be
//   untestable across year boundaries.
// ============================================================================

/** The configuration fields that affect the printed form. */
export interface FormatConfig {
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly format: string;
  readonly padding: number;
}

/**
 * Values the caller resolves and the format may reference.
 *
 * PRD §9.2 lists university, campus, department, programme, batch-year,
 * admission-year, calendar-year, course and role tokens. Those that name
 * another record — campus, department, programme, course, batch — cannot be
 * looked up here without turning a pure function into a query, so the caller
 * supplies the codes it already holds. A token with no supplied value renders
 * as empty rather than as the literal token: an identifier reading
 * "EMP-{CAMPUS}-0001" would be a bug printed onto an ID card.
 */
export interface FormatContext {
  /** Four-digit calendar year, from the database clock. */
  readonly year: number;
  /** 1–12, from the database clock. */
  readonly month: number;
  readonly universityCode?: string;
  readonly campusCode?: string;
  readonly departmentCode?: string;
  readonly programmeCode?: string;
  readonly courseCode?: string;
  readonly batchYear?: number;
  readonly admissionYear?: number;
  readonly roleCode?: string;
}

/**
 * Every token the engine understands.
 *
 * Declared as data rather than as a chain of replaces so the configuration
 * screen can list exactly what is available, and so an unknown token can be
 * REJECTED at save time rather than silently rendering empty forever.
 */
export const FORMAT_TOKENS = [
  "PREFIX",
  "SUFFIX",
  "SEQ",
  "YEAR",
  "YY",
  "MONTH",
  "UNIV",
  "CAMPUS",
  "DEPT",
  "PROGRAMME",
  "COURSE",
  "BATCH",
  "ADMYEAR",
  "ROLE",
] as const;

export type FormatToken = (typeof FORMAT_TOKENS)[number];

/**
 * PRD §9.2 also lists "Random secure string" and "Check digit".
 *
 * Neither is implemented, and neither is silently dropped — they are recorded
 * here and in the completion matrix. A random component would make an
 * identifier unpredictable but also unreproducible, so a preview could never
 * show the value that will be issued; a check digit needs a stated algorithm,
 * and the PRD names none. Both need a product decision before they can be
 * built honestly, and no consumer in the MVP requires either.
 */
export const UNIMPLEMENTED_TOKENS = ["RAND", "CHECK"] as const;

/** `{TOKEN}` occurrences, captured so unknown ones can be reported by name. */
const TOKEN_PATTERN = /\{([A-Z_]+)\}/g;

/** Tokens a format string references that this engine does not understand. */
export function unknownTokens(format: string): string[] {
  const known = new Set<string>(FORMAT_TOKENS);
  const found = new Set<string>();

  for (const match of format.matchAll(TOKEN_PATTERN)) {
    if (!known.has(match[1])) found.add(match[1]);
  }

  return [...found];
}

/**
 * Render one identifier.
 *
 * `sequence` is the number the database issued. Padding applies ONLY to {SEQ} —
 * padding a year or a campus code would corrupt it.
 *
 * @example
 * // format "{PREFIX}{YEAR}{SEQ}", prefix "STU-", padding 6, seq 123, year 2026
 * // -> "STU-2026000123"
 */
export function formatIdentifier(
  config: FormatConfig,
  sequence: number,
  context: FormatContext
): string {
  const values: Record<FormatToken, string> = {
    PREFIX: config.prefix ?? "",
    SUFFIX: config.suffix ?? "",
    // Math.max guards a padding of 0 or a negative one; String.padStart would
    // simply not pad, but the intent is clearer stated.
    SEQ: String(sequence).padStart(Math.max(0, config.padding), "0"),
    YEAR: String(context.year),
    YY: String(context.year % 100).padStart(2, "0"),
    MONTH: String(context.month).padStart(2, "0"),
    UNIV: context.universityCode ?? "",
    CAMPUS: context.campusCode ?? "",
    DEPT: context.departmentCode ?? "",
    PROGRAMME: context.programmeCode ?? "",
    COURSE: context.courseCode ?? "",
    BATCH: context.batchYear === undefined ? "" : String(context.batchYear),
    ADMYEAR:
      context.admissionYear === undefined ? "" : String(context.admissionYear),
    ROLE: context.roleCode ?? "",
  };

  const rendered = config.format.replace(TOKEN_PATTERN, (whole, token: string) =>
    token in values ? values[token as FormatToken] : whole
  );

  // A suffix configured but never referenced by the format would otherwise be
  // silently ignored, which reads as a saved setting that does nothing.
  return config.format.includes("{SUFFIX}")
    ? rendered
    : rendered + (config.suffix ?? "");
}

/**
 * Whether a reset is due, given the cycle and when the counter last reset.
 *
 * Pure so the boundary cases — first ever use, a year rollover, a month
 * rollover within the same year — are unit-testable without waiting for a
 * calendar. SEMESTERLY is treated as two cycles a year, splitting at July:
 * the schema offers the value and nothing else defines it, so the rule is
 * stated here rather than left to whichever caller guesses first.
 */
export function needsReset(
  cycle: "NEVER" | "YEARLY" | "MONTHLY" | "SEMESTERLY",
  lastResetYear: number | null,
  lastResetMonth: number | null,
  now: { year: number; month: number }
): boolean {
  if (cycle === "NEVER") return false;

  // Never issued. The first number starts a cycle rather than continuing one.
  if (lastResetYear === null) return true;

  if (cycle === "YEARLY") return now.year !== lastResetYear;

  if (cycle === "MONTHLY") {
    return now.year !== lastResetYear || now.month !== lastResetMonth;
  }

  // SEMESTERLY: January–June is one half, July–December the other.
  const half = (month: number) => (month <= 6 ? 1 : 2);
  return (
    now.year !== lastResetYear ||
    lastResetMonth === null ||
    half(now.month) !== half(lastResetMonth)
  );
}

// ============================================================================
// MODULE : Constants — Enum Filter Options
// PURPOSE: Turn a Prisma enum into the option list a <ListFilter> renders.
//
// WHY THIS EXISTS RATHER THAN HAND-WRITTEN OPTION ARRAYS
//   A filter sends its value straight to the API, where a Zod `z.enum(...)`
//   rejects anything outside the enum with a 400. A hand-written list is
//   therefore not a cosmetic choice — a typo or a stale member is a filter that
//   fails the request, and nothing in the type system catches it because the
//   value is a string on both sides.
//
//   Deriving the options from the generated enum object makes that class of
//   bug impossible: the list cannot contain a member the backend does not
//   accept, and it cannot omit one that is added later.
// ============================================================================

/** An option as <ListFilter> and <Select> consume it. */
export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Render an enum member as a label.
 *
 * SCREAMING_SNAKE_CASE is how these read in the database and nowhere else.
 * "OPEN_ELECTIVE" becomes "Open elective" — capitalised once, not once per
 * word, because a filter list is prose and not a set of proper nouns.
 */
export function humaniseEnum(member: string): string {
  const spaced = member.toLowerCase().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Every member of a Prisma enum, as filter options.
 *
 * @example
 * import { RegistrationStatus } from "@/app/generated/prisma/enums"
 * <ListFilter options={enumOptions(RegistrationStatus)} … />
 */
export function enumOptions(
  enumObject: Record<string, string>,
  labels?: Record<string, string>
): SelectOption[] {
  return Object.values(enumObject).map((value) => ({
    value,
    label: labels?.[value] ?? humaniseEnum(value),
  }));
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Console Accent
// LAYER  : Constants
// PURPOSE: The closed set of accents a platform operator may choose, and the
//          single place that decides what an unrecognised value means.
//
// WHY AN ENUM AND NOT A COLOUR STRING
//   The value is written into the DOM as a data attribute and selects a block
//   of CSS custom properties. Accepting an arbitrary string would mean either
//   injecting caller-controlled text into a style, or storing something the
//   stylesheet has no rule for and rendering an unstyled console. A closed set
//   makes both impossible: anything outside it is refused on the way in by Zod
//   and, if it somehow reached the column anyway, normalised to the default on
//   the way out by resolveAccent().
//
// WHICH COLOURS, AND WHY THESE
//   GREEN and ORANGE are the design system's own secondary and tertiary scales,
//   referenced as variables rather than restated as hex. DEFAULT is the absence
//   of an override — the console renders exactly as it does today. BLUE, PURPLE
//   and RED are new, defined once in globals.css beside the scales they sit
//   with and matched to their muted character rather than picked as pure hues.
//
//   RED is an ACCENT and is deliberately not the error colour. --color-error is
//   #ba1a1a and is never redefined by any accent; the red accent is a muted
//   #a54a4a. Nothing here touches success, warning, error, destructive or
//   informational tokens — those carry meaning, and an operator's preference
//   must not be able to change what a colour means.
// ============================================================================

/**
 * Accents an operator may pick.
 *
 * DEFAULT is first because it is the fallback, and it is a real member rather
 * than `null` so the UI has something to render as selected.
 */
export const PLATFORM_ACCENTS = [
  "DEFAULT",
  "BLUE",
  "PURPLE",
  "GREEN",
  "ORANGE",
  "RED",
] as const;

export type PlatformAccent = (typeof PLATFORM_ACCENTS)[number];

/** Human labels for the selector. */
export const PLATFORM_ACCENT_LABELS: Record<PlatformAccent, string> = {
  DEFAULT: "Default",
  BLUE: "Blue",
  PURPLE: "Purple",
  GREEN: "Green",
  ORANGE: "Orange",
  RED: "Red",
};

/**
 * A swatch colour for the selector, so the control can show what it offers.
 *
 * Presentation only — the accent that actually gets applied comes from the
 * stylesheet block keyed on the same name, never from this map. Kept in sync by
 * being the same six keys, which the accompanying test asserts.
 */
export const PLATFORM_ACCENT_SWATCHES: Record<PlatformAccent, string> = {
  DEFAULT: "#4a4e52",
  BLUE: "#3a6ea5",
  PURPLE: "#6f5aa5",
  GREEN: "#55875b",
  ORANGE: "#c25319",
  RED: "#a54a4a",
};

/**
 * Normalise anything at all to an accent this application can render.
 *
 * INPUT   : the raw column — a recognised name, a name retired in a later
 *           release, null for an operator who never chose, or a value written
 *           by something other than this application.
 * RETURNS : always a member of PLATFORM_ACCENTS. Never throws.
 *
 * This is the "must never fail because of a malformed preference" rule, stated
 * once. Both the API and the layout call it, so a value cannot be trusted in
 * one place and normalised in the other.
 */
export function resolveAccent(value: string | null | undefined): PlatformAccent {
  return (PLATFORM_ACCENTS as readonly string[]).includes(value ?? "")
    ? (value as PlatformAccent)
    : "DEFAULT";
}

/**
 * The value to put on the console wrapper's `data-platform-accent`.
 *
 * DEFAULT returns undefined rather than "DEFAULT": the default is the absence
 * of an override, so the attribute is omitted entirely and the console inherits
 * :root exactly as it always has. That keeps "no preference" and "the preference
 * happens to match the default" indistinguishable in the rendered DOM, which is
 * what makes this feature invisible to every user who never touches it.
 */
export function accentAttribute(accent: PlatformAccent): string | undefined {
  return accent === "DEFAULT" ? undefined : accent;
}

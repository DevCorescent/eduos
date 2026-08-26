// ============================================================================
// OWNER  : Gauransh
// MODULE : Utils — Colour input
// PURPOSE: Turn a stored brand colour into something <input type="color"> can
//          actually display, WITHOUT changing what is stored.
//
// THE PROBLEM THIS SOLVES
//   The branding API accepts what HEX_COLOUR accepts: #rgb or #rrggbb, or null
//   for "unset". A native colour input accepts only #rrggbb — it has no way to
//   express an empty value and no way to parse a three-digit hex. Given either,
//   it silently falls back to black, which reads as "this university's brand
//   colour is black" rather than "nothing is set".
//
// THE RULE THAT MATTERS
//   The value returned here is for DISPLAY ONLY and must never be written back
//   into the form or sent to the API. Expanding #abc to #aabbcc for the swatch
//   is a rendering detail; persisting that expansion would rewrite a value the
//   operator typed and the backend already accepts, changing their brand colour
//   into a different string without telling them. Only actually operating the
//   picker writes a value.
// ============================================================================

/** Matches the backend's HEX_COLOUR — the two forms branding may store. */
const SIX = /^#[0-9a-fA-F]{6}$/;
const THREE = /^#[0-9a-fA-F]{3}$/;

/**
 * A neutral grey for "nothing set, or not a colour yet".
 *
 * Deliberately NOT black (which is what the control defaults to and would be
 * indistinguishable from a deliberate choice) and not a brand colour (which
 * would suggest a value that is not stored).
 */
export const SWATCH_FALLBACK = "#d4d4d4";

/**
 * The #rrggbb a colour input should show for a stored branding value.
 *
 * INPUT   : whatever is in the text field — a six-digit hex, a three-digit hex,
 *           an empty string while the operator is typing, or a partial value.
 * RETURNS : always a six-digit hex the control can render. Never throws.
 *
 * @example
 * swatchFor("#1d4ed8") // "#1d4ed8"  — already displayable
 * swatchFor("#abc")    // "#aabbcc"  — expanded for DISPLAY; "#abc" stays stored
 * swatchFor("")        // "#d4d4d4"  — nothing set
 * swatchFor("#12")     // "#d4d4d4"  — mid-typing, not yet a colour
 */
export function swatchFor(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();

  if (SIX.test(trimmed)) return trimmed;

  if (THREE.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return SWATCH_FALLBACK;
}

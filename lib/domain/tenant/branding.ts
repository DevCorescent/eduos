// ============================================================================
// OWNER      : Gauransh
// MODULE     : Tenant Branding (WP-3, PRD §45)
// LAYER      : Domain
// PURPOSE    : Decide whether a tenant-supplied colour is safe to interpolate
//              into a stylesheet, and turn a tenant's branding into CSS custom
//              properties. Pure.
//
// THE INJECTION THIS EXISTS TO PREVENT
//   Branding colours are written by a university administrator and rendered
//   into a <style> block on every page of that university's portal. A value
//   like
//
//       #fff;} body{background:url(https://attacker/x)
//
//   would close the declaration and open another. Anything that reaches a
//   stylesheet must therefore be validated against a shape that CANNOT contain
//   a brace, a semicolon, a parenthesis or the string "url" — and a strict hex
//   pattern is exactly such a shape.
//
//   Validation is an ALLOW-LIST, not an escape. Escaping asks "have I thought
//   of every dangerous character"; an allow-list asks "is this one of the
//   handful of forms I accept", which is the question with a safe default.
//
// WHY HEX ONLY
//   The PRD (§45 "Brand colours") names no format. The columns are free TEXT.
//   Hex is the smallest form that expresses every colour a brand needs, is what
//   every brand guideline publishes, and is trivially validated. rgb() and
//   hsl() are refused because they contain parentheses — the same character an
//   injected url() needs — and named colours are refused because the set is
//   large, browser-dependent, and buys nothing hex does not. The choice is
//   documented rather than assumed, per the brief.
// ============================================================================

/**
 * #RGB, #RRGGBB, or the 4- and 8-digit forms that carry alpha.
 *
 * Anchored at both ends, so nothing may precede or follow. This pattern admits
 * no brace, semicolon, parenthesis, quote or whitespace.
 */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isValidBrandColour(value: string): boolean {
  return HEX_COLOUR.test(value.trim());
}

/**
 * The branding a tenant carries. Every field optional — a tenant that has
 * configured nothing renders the product's own design system unchanged, which
 * is the correct default and not a fallback worth apologising for.
 */
export interface TenantBranding {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly primaryColor: string | null;
  readonly accentColor: string | null;
}

/**
 * The CSS custom properties a tenant's colours override.
 *
 * ONLY TWO VARIABLES, DELIBERATELY. The design system defines forty generated
 * steps across four palettes, and letting a tenant set arbitrary ones would let
 * them produce unreadable combinations — white text on white, a "success" state
 * in red. Two brand accents layered over an intact system is the trade that
 * keeps every screen legible whatever a university chooses.
 *
 * Invalid values are DROPPED rather than substituted. A tenant whose colour
 * fails validation gets the design system's own, which is always legible;
 * silently correcting their value to something near it would be a worse
 * surprise than ignoring it.
 */
export function brandingCssVariables(
  branding: Pick<TenantBranding, "primaryColor" | "accentColor">
): string {
  const declarations: string[] = [];

  if (branding.primaryColor && isValidBrandColour(branding.primaryColor)) {
    declarations.push(`--brand-primary:${branding.primaryColor.trim()}`);
  }

  if (branding.accentColor && isValidBrandColour(branding.accentColor)) {
    declarations.push(`--brand-accent:${branding.accentColor.trim()}`);
  }

  return declarations.join(";");
}

/**
 * Whether a stored asset URL is safe to render in an <img> or <link rel=icon>.
 *
 * Accepts https and same-origin relative paths. Refuses:
 *   · http — a mixed-content warning on every page of a paid product
 *   · data: — an arbitrary payload rendered under the institution's name
 *   · javascript: — the obvious one
 *   · protocol-relative "//host" — resolves to http on an http page
 *
 * NOT AN SSRF DEFENCE, and not claimed as one. The URL is handed to the
 * BROWSER, which fetches it directly; the server never requests it. If a future
 * change makes the server fetch these — thumbnailing, proxying — that change
 * needs its own allow-list and this comment is where to start.
 */
export function isSafeAssetUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  // Protocol-relative. Rejected before the URL parser, which would accept it.
  if (trimmed.startsWith("//")) return false;

  if (trimmed.startsWith("/")) return true;

  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

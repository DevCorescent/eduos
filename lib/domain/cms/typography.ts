// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Typography Controls (W4c, PRD §7.3, §45)
// LAYER  : Domain (pure — no React, no Prisma, no fetch)
// PURPOSE: Let an editor set text colour, size and weight for a whole site and
//          for one section, without letting them write CSS.
//
// A CLOSED VOCABULARY, NOT FREE CSS
//   "Font size" as a free number produces a 96px body paragraph and a homepage
//   nobody can read; "font family" as a free string produces a page that renders
//   in Times on every machine that lacks the font. So size is a five-step
//   RELATIVE scale and weight is a six-step named scale, both mapped to real
//   values here in code. An editor picks "Larger"; the design system decides
//   what larger means for a hero headline versus a card title.
//
//   Colour IS free — a brand colour cannot be an enum — which is why it is
//   validated against the same strict hex allow-list tenant branding uses. See
//   lib/domain/tenant/branding.ts for the stylesheet injection that pattern
//   exists to prevent; the same reasoning applies here, and the same function
//   does the checking so the two cannot drift.
//
// WHY CSS CUSTOM PROPERTIES AND NOT CLASS NAMES
//   These values cascade. A site-wide setting goes on the page wrapper, a
//   section override goes on that section's own element, and the browser's own
//   cascade resolves which wins — with no code anywhere merging two settings
//   together. Adding a third level (a per-block-item override, say) would need
//   no change to the resolution logic, because there is none.
//
//   They are emitted as an OBJECT for React's `style` prop, never as a string
//   interpolated into a <style> block. An attribute value cannot close a
//   declaration and open another, so the injection surface is the hex check
//   alone.
// ============================================================================

import { z } from "zod";
import { isValidBrandColour } from "@/lib/domain/tenant/branding";

// --- The vocabularies -------------------------------------------------------

/**
 * A relative size step. `md` is the design system's own size — an editor who
 * touches nothing gets exactly the page they had.
 *
 * RELATIVE, NOT ABSOLUTE, and that is the whole reason this reads well at every
 * breakpoint. A hero headline at `lg` is 1.1× of whatever the hero headline is
 * at that viewport, so the responsive steps the design system already defines
 * keep working. An absolute px value would have to pick one viewport and be
 * wrong on the others.
 */
export const TEXT_SCALES = ["xs", "sm", "md", "lg", "xl"] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export const FONT_WEIGHTS = [
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/** Multipliers, applied to every size the site's type scale defines. */
const SCALE_VALUES = {
  xs: "0.85",
  sm: "0.93",
  md: "1",
  lg: "1.1",
  xl: "1.22",
} satisfies Record<TextScale, string>;

const WEIGHT_VALUES = {
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
} satisfies Record<FontWeight, string>;

/** Human labels for the editor's dropdowns, derived so they cannot go stale. */
export const SCALE_LABELS = {
  xs: "Much smaller",
  sm: "Smaller",
  md: "Default",
  lg: "Larger",
  xl: "Much larger",
} satisfies Record<TextScale, string>;

export const WEIGHT_LABELS = {
  light: "Light",
  normal: "Normal",
  medium: "Medium",
  semibold: "Semi-bold",
  bold: "Bold",
  extrabold: "Extra bold",
} satisfies Record<FontWeight, string>;

// --- The schema -------------------------------------------------------------

/**
 * A colour an editor may set.
 *
 * Refined rather than regex-ed inline so the rule lives in exactly one place —
 * `isValidBrandColour` — which is also what the tenant branding screen enforces.
 * Two hex patterns in one codebase is one pattern too many.
 */
const colour = z
  .string()
  .trim()
  .refine(isValidBrandColour, {
    message: "Must be a hex colour, e.g. #1e3a8a",
  });

/**
 * The six settings, all optional.
 *
 * ABSENT MEANS "INHERIT", NOT "DEFAULT" — the distinction matters. A section
 * that sets only `headingColor` still picks up the site's chosen body weight,
 * because the unset properties are simply not emitted and the cascade carries
 * the outer value through. Writing defaults into every level would flatten that
 * and make a site-wide change stop reaching sections that had been touched.
 */
export const typographySchema = z
  .object({
    headingColor: colour.optional(),
    headingScale: z.enum(TEXT_SCALES).optional(),
    headingWeight: z.enum(FONT_WEIGHTS).optional(),
    bodyColor: colour.optional(),
    bodyScale: z.enum(TEXT_SCALES).optional(),
    bodyWeight: z.enum(FONT_WEIGHTS).optional(),
  })
  .strict();

export type Typography = z.infer<typeof typographySchema>;

/**
 * Read a stored Json column, falling back to "no overrides".
 *
 * Same rule as parseStoredBlocks: this runs while rendering a public page, and
 * an unparseable typography row must cost the institution its custom lettering,
 * not its homepage.
 */
export function parseTypography(value: unknown): Typography {
  if (value == null) return {};
  const parsed = typographySchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

// --- Emitting -----------------------------------------------------------------

/**
 * The custom properties for one level of the cascade.
 *
 * Returns an object suitable for React's `style` prop — cast at the call site,
 * because React's CSSProperties type does not admit custom properties and this
 * module stays free of React types.
 *
 * An EMPTY object when nothing is set, so a caller can spread it
 * unconditionally and a section with no overrides carries no style attribute
 * worth speaking of.
 */
export function typographyCssVars(typography?: Typography | null): Record<string, string> {
  if (!typography) return {};

  const vars: Record<string, string> = {};

  // Re-validated on the way out. This is the last point before a value reaches
  // the DOM, and a row written before a schema change — or by hand — must not
  // be able to skip the check that a route ran on the way in.
  if (typography.headingColor && isValidBrandColour(typography.headingColor)) {
    vars["--site-heading-color"] = typography.headingColor.trim();
  }
  if (typography.headingScale) {
    vars["--site-heading-scale"] = SCALE_VALUES[typography.headingScale];
  }
  if (typography.headingWeight) {
    vars["--site-heading-weight"] = WEIGHT_VALUES[typography.headingWeight];
  }
  if (typography.bodyColor && isValidBrandColour(typography.bodyColor)) {
    vars["--site-body-color"] = typography.bodyColor.trim();
  }
  if (typography.bodyScale) {
    vars["--site-body-scale"] = SCALE_VALUES[typography.bodyScale];
  }
  if (typography.bodyWeight) {
    vars["--site-body-weight"] = WEIGHT_VALUES[typography.bodyWeight];
  }

  return vars;
}

/** Whether an editor has set anything at all — for "reset" affordances. */
export function hasTypography(typography?: Typography | null): boolean {
  return Boolean(typography && Object.values(typography).some(Boolean));
}

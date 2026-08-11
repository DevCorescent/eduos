// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Site Chrome Schemas (W4b, PRD §7.1)
// LAYER  : Domain (pure)
// PURPOSE: Validate the navigation, footer and social links stored on CmsSite.
//
// SAME CONTRACT AS blocks.ts, SAME REASON
//   These are Json columns, so Postgres accepts any shape. Every write parses
//   against these schemas and every read parses again, which is what lets the
//   header and footer be plain rendering functions with no defensive branching.
// ============================================================================

import { z } from "zod";

/**
 * A link an editor may type. Relative paths, https and mailto only.
 *
 * Duplicated from blocks.ts rather than shared, deliberately: navigation links
 * and block links are edited in different screens and may diverge — a footer
 * may one day allow tel: — and a shared rule would make that a change to both.
 */
const href = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      if (value.startsWith("//")) return false;
      if (value.startsWith("/") || value.startsWith("#")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "mailto:";
      } catch {
        return false;
      }
    },
    { message: "Must be a relative path, an https:// URL, or a mailto: link" }
  );

const label = z.string().trim().min(1).max(60);

/**
 * One entry inside a navigation dropdown.
 *
 * `description` is the second line the reference university sites put under
 * each menu entry ("Undergraduate — four-year degrees"). Optional, because a
 * menu of six one-word links reads better without it.
 */
export const navChildSchema = z.object({
  label,
  href,
  description: z.string().trim().max(120).optional(),
});

/**
 * One navigation entry, with an optional dropdown beneath it.
 *
 * ONE LEVEL OF NESTING, AND NO MORE
 *   A child cannot itself have children. Two levels is a menu; three is a
 *   sitemap that has to be operated with a mouse held very still, and every
 *   university site in the reference set stops at two. Making it
 *   unrepresentable is cheaper than making it work.
 *
 * A PARENT STILL NEEDS AN href
 *   The dropdown opens on hover and on keyboard focus, but the parent itself
 *   stays a real link. On a touch screen there is no hover, so a parent whose
 *   only job was to open a menu would simply do nothing when tapped.
 */
export const navItemSchema = z.object({
  label,
  href,
  children: z.array(navChildSchema).max(8).optional(),
});

/** The whole menu. Bounded so a bar cannot be given more links than it can show. */
export const navItemsSchema = z.array(navItemSchema).max(10);

/** One footer column: a heading and its links. Flat — a footer has no hover. */
export const footerColumnSchema = z.object({
  heading: label,
  links: z.array(z.object({ label, href })).min(1).max(10),
});

export const footerColumnsSchema = z.array(footerColumnSchema).max(4);

/**
 * The social platforms the footer can show.
 *
 * A closed set for the same reason block icons are: the renderer maps this to a
 * component, and a free string would mean stored content choosing what to draw.
 */
export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "x",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  href,
});

export const socialLinksSchema = z.array(socialLinkSchema).max(6);

/**
 * Icons the enquire dock may show.
 *
 * Closed set for the same reason block icons are: the renderer maps this to a
 * component, and a free string would mean stored content choosing what to draw.
 */
export const ENQUIRE_ICONS = [
  "whatsapp",
  "apply",
  "phone",
  "message",
  "document",
  "calendar",
  "chart",
  "link",
] as const;

export type EnquireIcon = (typeof ENQUIRE_ICONS)[number];

export const enquireItemSchema = z.object({
  label,
  href,
  icon: z.enum(ENQUIRE_ICONS).optional(),
});

/**
 * The optional enquire dock on the public site.
 *
 * `enabled: false` (or an empty items list) means the dock is not rendered at
 * all — which is the default, so a university that never opens the chrome
 * editor does not suddenly grow a floating button.
 */
export const enquireRailSchema = z.object({
  enabled: z.boolean().default(false),
  label: label.default("Enquire Now"),
  items: z.array(enquireItemSchema).max(8).default([]),
});

export type NavItem = z.infer<typeof navItemSchema>;
export type NavChild = z.infer<typeof navChildSchema>;
export type FooterColumn = z.infer<typeof footerColumnSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;
export type EnquireItem = z.infer<typeof enquireItemSchema>;
export type EnquireRail = z.infer<typeof enquireRailSchema>;

/**
 * Site-wide typography, re-exported through this module.
 *
 * It lives in typography.ts because BLOCKS use the same shape for their
 * per-section override, and the two must be identical or the cascade would be
 * resolving two different vocabularies against each other. Re-exported here so
 * a caller reading "the site chrome" finds all of it in one import.
 */
export { typographySchema, parseTypography, type Typography } from "./typography";

/**
 * Parse each stored column, falling back to empty rather than throwing.
 *
 * Same rule as parseStoredBlocks: this runs while rendering a public page, and
 * a navigation bar that fails to parse must cost the visitor a menu, not the
 * institution its homepage.
 */
export function parseNavItems(value: unknown): NavItem[] {
  const parsed = navItemsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseFooterColumns(value: unknown): FooterColumn[] {
  const parsed = footerColumnsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseSocialLinks(value: unknown): SocialLink[] {
  const parsed = socialLinksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** A disabled empty dock when the column is missing or unparseable. */
export function parseEnquireRail(value: unknown): EnquireRail {
  const parsed = enquireRailSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { enabled: false, label: "Enquire Now", items: [] };
}

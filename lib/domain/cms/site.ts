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

/** One navigation entry. Flat — no dropdowns; see the schema note on CmsSite. */
export const navItemSchema = z.object({ label, href });

/** The whole menu. Bounded so a bar cannot be given more links than it can show. */
export const navItemsSchema = z.array(navItemSchema).max(10);

/** One footer column: a heading and its links. */
export const footerColumnSchema = z.object({
  heading: label,
  links: z.array(navItemSchema).min(1).max(10),
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

export type NavItem = z.infer<typeof navItemSchema>;
export type FooterColumn = z.infer<typeof footerColumnSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;

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

import { z } from "zod";
import { identifier } from "@/lib/validations/shared";
import { DomainType } from "@/app/generated/prisma/enums";
import { normaliseHost } from "@/lib/domain/tenant/host";
import { isSafeAssetUrl, isValidBrandColour } from "@/lib/domain/tenant/branding";

// ============================================================================
// MODULE : Validations — Tenant Domains and Branding (WP-3, PRD §5.2, §45)
// PURPOSE: Refuse a hostname or a brand value that would break resolution or
//          escape a stylesheet, at the boundary.
// ============================================================================

/**
 * A hostname, stored exactly as resolution will look it up.
 *
 * The transform is the point: it runs normaliseHost, so "AKTU.Eduos.com:3000"
 * is STORED as "aktu.eduos.com". Storing the raw value and normalising only on
 * read would mean a domain that looks configured and never resolves — and the
 * unique index would fail to catch the duplicate, because the two strings
 * differ.
 *
 * The shape check is deliberately minimal: at least one dot, no scheme, no
 * path, no whitespace. It is not an RFC-complete hostname grammar, because a
 * value that passes this and does not exist in DNS simply never verifies, while
 * an over-strict pattern would reject a legitimate internationalised domain.
 */
const hostname = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .refine((v) => !/^[a-z]+:\/\//i.test(v), { message: "Enter a hostname, not a URL." })
  .refine((v) => !/[/\s?#]/.test(v), { message: "A hostname contains no path, spaces or query." })
  .transform((v) => normaliseHost(v))
  .refine((v): v is string => v !== null, { message: "That is not a usable hostname." })
  .refine((v) => v.includes("."), { message: "A domain needs at least one dot." });

export const createDomainSchema = z
  .object({
    domain: hostname,
    type: z.enum(DomainType).default(DomainType.CUSTOM),
    /**
     * `verified` is accepted ONLY from the platform operator's own endpoint.
     * PRD §5.2 asks for automated DNS verification but names no mechanism, so
     * until that is specified the flag is set by an operator rather than by a
     * protocol this file would have had to invent.
     */
    verified: z.boolean().default(false),
    isPrimary: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * `domain` is absent from the update contract.
 *
 * Renaming a live hostname silently breaks every bookmark, every emailed link
 * and every certificate QR code pointing at it. Adding the new one and retiring
 * the old is the same operation with none of that damage, and it leaves both
 * rows in the audit trail.
 */
export const updateDomainSchema = z
  .object({
    type: z.enum(DomainType).optional(),
    verified: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Supply at least one field to update.",
  });

export const domainParamSchema = z.object({ id: identifier });

/**
 * Branding, validated to the same rules the renderer enforces.
 *
 * Colours must be hex — the one form that cannot contain a brace, semicolon or
 * parenthesis, and therefore cannot escape the <style> block they are rendered
 * into. Asset URLs must be https or same-origin. Both checks reuse the exact
 * predicates the layout uses, so nothing can be stored that the renderer will
 * later silently drop.
 */
export const updateBrandingSchema = z
  .object({
    logoUrl: z.string().trim().max(2048).refine(isSafeAssetUrl, {
      message: "Use an https:// address or a path beginning with /.",
    }).nullish(),
    faviconUrl: z.string().trim().max(2048).refine(isSafeAssetUrl, {
      message: "Use an https:// address or a path beginning with /.",
    }).nullish(),
    primaryColor: z.string().trim().refine(isValidBrandColour, {
      message: "Use a hex colour such as #1A73E8.",
    }).nullish(),
    accentColor: z.string().trim().refine(isValidBrandColour, {
      message: "Use a hex colour such as #1A73E8.",
    }).nullish(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Supply at least one field to update.",
  });

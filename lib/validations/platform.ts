// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Tenant Listing
// FLOW   : Coerces and validates the ?page and ?limit search params before the
//          route performs any database work.
// ACCESS : SUPER_ADMIN
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Keep platform request validation declarative and in one place,
//          matching the existing lib/validations/auth.ts convention.
// ============================================================================

import { z } from "zod";
import {
  BillingCycle,
  InstitutionType,
  SubscriptionPlan,
  SubscriptionStatus,
  TenantStatus,
} from "@/app/generated/prisma/client";

/** Page size applied when ?limit is omitted. */
const DEFAULT_PAGE_SIZE = 20;

/** Upper bound on ?limit, so a single request cannot ask for every tenant. */
const MAX_PAGE_SIZE = 100;

/**
 * Query schema for GET /api/platform/tenants.
 *
 * Search params always arrive as strings, so page and limit are coerced before
 * the integer and range checks. Both are optional — an omitted param falls back
 * to its default rather than failing validation.
 */
export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;

/**
 * A tenant slug becomes a DNS label: lib/services/tenant.ts resolves the active
 * tenant by stripping the root domain off the Host header, so a slug containing
 * dots, uppercase letters or spaces would produce an unroutable subdomain.
 * Lowercase alphanumerics with single interior hyphens only.
 */
const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Maximum length of a single DNS label. */
const MAX_SLUG_LENGTH = 63;

/**
 * Body schema for POST /api/platform/tenants.
 *
 * Mirrors the writable scalar fields of the Tenant model. Only slug and name
 * are required — every other column is nullable or carries a schema default,
 * so an omitted key lets the database default apply rather than being
 * overwritten with null.
 *
 * status is intentionally absent: the schema defaults it to TRIAL, and README
 * Phase 2 assigns status changes to PATCH /api/platform/tenants/[id].
 */
export const createTenantSchema = z.object({
  slug: z.string().min(1).max(MAX_SLUG_LENGTH).regex(TENANT_SLUG_PATTERN),
  name: z.string().min(1),
  type: z.enum(InstitutionType).optional(),
  logoUrl: z.url().optional(),
  faviconUrl: z.url().optional(),
  primaryColor: z.string().min(1).optional(),
  accentColor: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().min(1).optional(),
  website: z.url().optional(),
  accreditationNo: z.string().min(1).optional(),
  establishedYear: z.number().int().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/**
 * Route param schema for /api/platform/tenants/[id].
 *
 * Tenant.id is a cuid, but no format assertion is applied: the id is an opaque
 * key, and asserting a shape would turn an unrecognised-but-well-formed id into
 * a 400 when 404 is the accurate answer. Only an empty or whitespace-only
 * segment is rejected outright.
 */
export const tenantIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type TenantIdParam = z.infer<typeof tenantIdParamSchema>;

/**
 * Body schema for PATCH /api/platform/tenants/[id].
 *
 * Derived from createTenantSchema rather than restated, so the slug pattern,
 * email and URL formats, enum membership and integer checks stay defined in one
 * place and cannot drift apart.
 *
 * status is added here because README Phase 2 assigns status changes to PATCH,
 * while creation defers to the schema default.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * Note that omitting a key leaves the column unchanged — there is currently no
 * way to clear a nullable column back to null through this endpoint.
 */
export const updateTenantSchema = createTenantSchema
  .partial()
  .extend({ status: z.enum(TenantStatus).optional() })
  .refine((data) => Object.keys(data).length > 0);

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/**
 * Query schema for GET /api/platform/subscriptions.
 *
 * Pagination is identical to the tenant listing, so the same schema object is
 * reused rather than its page and limit rules being restated. Aliased so the
 * subscriptions route reads in its own terms at the call site.
 */
export const listSubscriptionsQuerySchema = listTenantsQuerySchema;

export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;

/**
 * Route param schema for /api/platform/subscriptions/[id].
 *
 * Structurally identical to the tenant id param, so the same schema object is
 * reused rather than restated. Aliased so the subscriptions route reads in its
 * own terms at the call site.
 */
export const subscriptionIdParamSchema = tenantIdParamSchema;

export type SubscriptionIdParam = z.infer<typeof subscriptionIdParamSchema>;

/**
 * Accepted shape for Subscription.pricePerMonth, read directly off the column's
 * @db.Decimal(10, 2): at most eight integer digits and two fractional digits,
 * non-negative. Without this bound an oversized value reaches Postgres and
 * surfaces as a numeric-overflow 500 rather than a clean 400.
 */
const PRICE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Body schema for PATCH /api/platform/subscriptions/[id].
 *
 * Every key is optional but at least one must be present, matching the tenant
 * update contract: an empty body is a client error, not a silent no-op that
 * would still advance updatedAt.
 *
 * Excluded on purpose:
 *  - tenantId, because re-parenting a subscription to a different tenant is a
 *    capability the README never describes.
 *  - id, createdAt and updatedAt, which are generated columns.
 *
 * maxStorage is a BigInt column and pricePerMonth a Decimal, neither of which
 * JSON can carry natively, so both are validated from their JSON-safe forms
 * here. This is input validation only — response serialization stays with the
 * shared serialize() helper.
 *
 * As with the tenant update, omitting a key leaves the column unchanged; there
 * is no way to clear a nullable column back to null through this endpoint.
 */
export const updateSubscriptionSchema = z
  .object({
    plan: z.enum(SubscriptionPlan).optional(),
    status: z.enum(SubscriptionStatus).optional(),
    billingCycle: z.enum(BillingCycle).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    trialEndsAt: z.coerce.date().optional(),
    maxStudents: z.number().int().nonnegative().optional(),
    maxFaculty: z.number().int().nonnegative().optional(),
    // Coerced from a numeric string or an integer; a fractional value is
    // rejected rather than silently truncated.
    maxStorage: z.coerce.bigint().optional(),
    features: z.record(z.string(), z.unknown()).optional(),
    // Passed through as given. A string preserves trailing zeros ("1499.50"),
    // which Prisma accepts directly for a Decimal column.
    pricePerMonth: z
      .union([z.number(), z.string()])
      .refine((value) => PRICE_PATTERN.test(String(value)))
      .optional(),
    currency: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

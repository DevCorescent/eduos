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
import { MODULE_KEYS } from "@/lib/constants/modules";
import {
  BillingCycle,
  InstitutionType,
  PricingModel,
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
  .extend({
    status: z.enum(TenantStatus).optional(),
    // W1.5 / PRD §5.1 "Assign support manager". Nullable so an assignment can
    // be cleared — unlike the tenant's own columns, which this endpoint can
    // only set. `null` means unassigned; omitting the key leaves it unchanged.
    supportManagerId: z.string().trim().min(1).nullable().optional(),
  })
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
    // W1.5 / PRD §5.1 "Set limits for users, storage and courses" — the third
    // limit the PRD names, which had no column until W1.5.
    maxCourses: z.number().int().nonnegative().optional(),
    // W1.5 / PRD §5.3. The pricing BASIS and auto-renewal are the parts of
    // "Configure payment terms" the PRD actually defines; due dates, net
    // periods and grace are not defined anywhere and are not accepted here.
    pricingModel: z.enum(PricingModel).optional(),
    autoRenew: z.boolean().optional(),
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

// ============================================================================
// W1.3 — PLATFORM USERS
//
// The platform's own operators. Separate from lib/validations/user.ts, which
// validates TENANT users and carries a tenantId, roles array and student /
// faculty concerns that a platform operator has none of.
// ============================================================================

/**
 * The one platform role W1.3 supports.
 *
 * Restated here rather than imported from lib/middleware/requirePlatformAdmin
 * so a validation module does not depend on an authorization module — the two
 * are checked against each other by a test, not by an import. SUPER_ADMIN and
 * every tenant role name are rejected by construction: this enum has one
 * member, so nothing else parses.
 */
export const PLATFORM_ROLE_NAMES = ["PLATFORM_ADMIN"] as const;

export type PlatformRoleName = (typeof PLATFORM_ROLE_NAMES)[number];

/**
 * Query schema for GET /api/platform/users.
 *
 * Pagination is the tenant listing's, extended with `q` — this collection is
 * the first on the platform side to actually implement search, over email,
 * firstName and lastName.
 *
 * `q` is trimmed and an empty result is treated as absent, so `?q=` and
 * `?q=%20` mean "no search" rather than "match the empty string". Bounded at
 * 100 characters: a search term longer than any name or address in the table
 * is a probe, not a query.
 */
export const listPlatformUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ListPlatformUsersQuery = z.infer<typeof listPlatformUsersQuerySchema>;

/**
 * Body schema for POST /api/platform/users.
 *
 * WHAT IS NOT HERE, AND WHY
 *   password / passwordHash — the caller does not choose another person's
 *     password. The route generates one, stores only its hash and returns the
 *     plaintext once. Accepting a password here would let an operator set a
 *     colleague's credential to a value they keep.
 *   isActive — a new operator is active. Creating a deactivated account is a
 *     state with no use, and PATCH owns the transition.
 *   id / createdAt / updatedAt / lastLoginAt — generated columns.
 *
 * The address is lowercased before it is stored so that uniqueness is
 * case-insensitive in practice: PlatformUser.email is a unique column over the
 * raw text, and the login route lowercases too, so without this
 * `Admin@x.com` would create a second identity that could never sign in.
 */
export const createPlatformUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.email().trim().toLowerCase(),
    role: z.enum(PLATFORM_ROLE_NAMES),
  })
  .strict();

export type CreatePlatformUserInput = z.infer<typeof createPlatformUserSchema>;

/**
 * Route param schema for /api/platform/users/[id].
 *
 * Structurally identical to the tenant id param, so that schema object is
 * reused rather than restated. Aliased so the users routes read in their own
 * terms at the call site.
 */
export const platformUserIdParamSchema = tenantIdParamSchema;

export type PlatformUserIdParam = z.infer<typeof platformUserIdParamSchema>;

/**
 * Body schema for PATCH /api/platform/users/[id].
 *
 * Derived from createPlatformUserSchema so the name bounds, the email format
 * and the role membership stay defined once, extended with `isActive` because
 * activation and deactivation are updates rather than creation choices.
 *
 * Every key is optional but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * Still absent, and deliberately: passwordHash (owned by the reset endpoint),
 * and every generated column. There is no tenantId on this model to exclude —
 * that is the point of the model.
 */
export const updatePlatformUserSchema = createPlatformUserSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0);

export type UpdatePlatformUserInput = z.infer<typeof updatePlatformUserSchema>;

/**
 * Body schema for POST /api/super-admin/auth/change-password.
 *
 * The current password is required rather than trusted-because-signed-in: an
 * unattended session should not be enough to take an account over permanently.
 *
 * The minimum matches the login route's, so a password this accepts is one that
 * route will still take. No composition rules beyond length — they push people
 * toward predictable substitutions, and length is the property that matters.
 */
export const changePlatformPasswordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(12).max(200),
  })
  .strict()
  // Not merely pointless: submitting the same value would clear
  // mustChangePassword while leaving the shared secret in place.
  .refine((data) => data.currentPassword !== data.newPassword);

export type ChangePlatformPasswordInput = z.infer<typeof changePlatformPasswordSchema>;

// ============================================================================
// W1.4 — UNIVERSITY PROVISIONING
//
// Onboarding a real institution (AKTU, IPU) and its first University Admin.
// No new entity is validated here that the schema did not already have: these
// schemas describe a composition of Tenant, Role, User, UserRole and
// Subscription, all of which already exist.
// ============================================================================

/**
 * The one tenant role W1.4 provisions.
 *
 * SUPER_ADMIN is absent and is not an oversight. It was the tenant-writable
 * string that made the W1.1 escalation possible; W1.2 made it inert by moving
 * platform authority onto PlatformUser, and provisioning must not reintroduce
 * it as a role a new university starts life holding.
 */
export const INITIAL_TENANT_ROLE = "UNIVERSITY_ADMIN";

/**
 * The initial University Admin, as supplied when provisioning.
 *
 * WHAT IS NOT HERE
 *   password / passwordHash — the platform operator does not choose a
 *     university's password. One is generated, only its hash is stored, and the
 *     plaintext is returned once. This is the W1.3 contract applied unchanged.
 *   role — there is nothing to choose. The initial administrator of a
 *     university is its UNIVERSITY_ADMIN; accepting a role name here would be a
 *     field whose only valid value is a constant.
 *   tenantId — it comes from the tenant being created or from the route
 *     segment, never from the body. A body-supplied tenantId is how an
 *     administrator gets attached to the wrong university.
 *   isActive — a newly provisioned administrator is active.
 *
 * The address is lowercased so that User's @@unique([tenantId, email]) is
 * effective in practice: the tenant login route lowercases before its lookup,
 * so without this "Admin@aktu.ac.in" would create a row nobody could sign into.
 */
export const provisionAdminSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.email().trim().toLowerCase(),
  })
  .strict();

export type ProvisionAdminInput = z.infer<typeof provisionAdminSchema>;

/**
 * Body schema for POST /api/platform/tenants — university provisioning.
 *
 * Extends createTenantSchema rather than restating it, so the slug pattern, the
 * email and URL formats and the enum membership stay defined in one place.
 * Two things are added:
 *
 *   status — W1.4 requires a platform operator to be able to onboard a
 *     university directly as ACTIVE. Creation previously deferred to the
 *     schema's TRIAL default and left status to PATCH; that is still the
 *     default when the key is omitted, so no existing caller changes behaviour.
 *
 *   admin — the initial University Admin, OPTIONAL. Optional rather than
 *     required because the existing "Onboard institution" modal creates a
 *     tenant without one, and because a tenant whose administrator failed
 *     validation should not be a tenant that failed to exist. When present, the
 *     tenant and the administrator are created in ONE transaction.
 *
 * updateTenantSchema is deliberately NOT derived from this schema: `admin` is a
 * provisioning act, not a tenant column, and a PATCH accepting it would read as
 * "edit the university's administrator" while doing something else entirely.
 */
export const provisionTenantSchema = createTenantSchema.extend({
  status: z.enum(TenantStatus).optional(),
  admin: provisionAdminSchema.optional(),
});

export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;

/**
 * Body schema for POST /api/auth/change-password.
 *
 * The tenant counterpart of changePlatformPasswordSchema, with the same rules
 * for the same reasons: the current password is required rather than
 * trusted-because-signed-in, and the new one must differ — otherwise a forced
 * change could be satisfied by resubmitting the shared secret, clearing the
 * flag while leaving the credential in place.
 *
 * The minimum is 12, above the login route's 8. A password this accepts is
 * therefore always one login will still take.
 */
export const changeTenantPasswordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(12).max(200),
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword);

export type ChangeTenantPasswordInput = z.infer<typeof changeTenantPasswordSchema>;

// ============================================================================
// W1.5 — UNIVERSITY ONBOARDING (PRD §5.1, §49.1)
//
// Every schema below validates a capability §5.1 names. Where §5.1 names a
// capability but defines no field, NOTHING is validated here and the gap is
// recorded in TECHNICAL_DEBT.md instead — see GAP-01 (module catalogue),
// GAP-02 (payment terms) and GAP-03 (archival semantics).
// ============================================================================

/**
 * PRD §49.1, verbatim and in the PRD's own order.
 *
 * Restated here rather than imported from the generated Prisma enum so the
 * validation layer does not depend on generated output, and so the ORDER — which
 * the UI renders and which §5.1 "track onboarding progress" is measured against
 * — is defined once in application code. A test asserts the two agree.
 */
export const ONBOARDING_STAGES = [
  "UNIVERSITY_ENQUIRY",
  "COMMERCIAL_APPROVAL",
  "TENANT_CREATION",
  "DOMAIN_CONFIGURATION",
  "BRANDING_CONFIGURATION",
  "MODULE_SELECTION",
  "ACADEMIC_SETUP",
  "DATA_IMPORT",
  "USER_CREATION",
  "TRAINING",
  "UAT",
  "GO_LIVE",
] as const;

export type OnboardingStageName = (typeof ONBOARDING_STAGES)[number];

/**
 * Body schema for POST/DELETE /api/platform/tenants/[id]/onboarding.
 *
 * `completedBy` is absent on purpose: it comes from the platform session, never
 * from the body, so an operator cannot record a colleague as having signed off
 * a stage.
 */
export const onboardingStepSchema = z
  .object({
    stage: z.enum(ONBOARDING_STAGES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>;

/**
 * Body schema for PATCH /api/platform/tenants/[id]/branding — PRD §5.1
 * "Upload university logo and branding".
 *
 * The columns already exist on Tenant and the university can already edit them
 * through /api/tenant/branding. What did not exist is a PLATFORM path to them:
 * that route is guarded by requireRole + requireTenant, and a platform operator
 * holds no tenant session and calls from the root domain, where tenant
 * resolution yields nothing. So this is the same four columns behind the
 * platform guard, not a second branding system.
 *
 * Colours are validated as hex because that is what the existing branding
 * implementation emits into CSS custom properties; a free string would reach a
 * stylesheet unescaped.
 */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const platformBrandingSchema = z
  .object({
    logoUrl: z.url().max(2000).nullish(),
    faviconUrl: z.url().max(2000).nullish(),
    primaryColor: z.string().regex(HEX_COLOUR).nullish(),
    accentColor: z.string().regex(HEX_COLOUR).nullish(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0);

export type PlatformBrandingInput = z.infer<typeof platformBrandingSchema>;

/**
 * Body schema for POST /api/platform/tenants/[id]/campuses — PRD §5.1
 * "Add campuses and affiliated colleges".
 *
 * Campus is the existing model and its columns are mirrored exactly. `code` is
 * unique per tenant in the schema, so it is length-bounded here and the
 * uniqueness is left to the database.
 *
 * tenantId is absent: it comes from the route segment. A body-supplied tenantId
 * is how a campus ends up under the wrong university.
 */
export const platformCampusSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(32),
    email: z.email().nullish(),
    phone: z.string().trim().min(1).max(32).nullish(),
    isMain: z.boolean().optional(),
  })
  .strict();

export type PlatformCampusInput = z.infer<typeof platformCampusSchema>;

/**
 * Body schema for POST /api/platform/tenants/[id]/academic-years — PRD §5.1
 * "Configure academic year".
 *
 * Mirrors the existing AcademicYear model. The end date must follow the start
 * date; the schema cannot express that and an inverted year silently breaks
 * every semester and batch hung off it.
 */
export const platformAcademicYearSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    isCurrent: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.endDate > data.startDate);

export type PlatformAcademicYearInput = z.infer<typeof platformAcademicYearSchema>;

// ============================================================================
// W1.5 (completion) — MODULES, PRICING BASIS, ARCHIVAL
// PRD §2.1, §5.1, §5.3, §46.3, §57
// ============================================================================

/**
 * Body schema for PUT /api/platform/tenants/[id]/modules — PRD §5.1
 * "Assign enabled modules".
 *
 * A map of catalogue key → boolean, and NOTHING else. `MODULE_KEYS` comes from
 * PRD §57, so a key the PRD never named cannot be submitted: that is what stops
 * the next `{"jhjj": true}` becoming an official module.
 *
 * The WHOLE selection is sent, because the stored column is replaced rather
 * than merged — the same contract the existing subscription PATCH has always
 * had. Unrecognised keys already in the column are preserved by the service,
 * not by the caller.
 */
export const moduleSelectionSchema = z
  .object({
    // partialRecord, NOT record. Zod 4's z.record() over an enum key is
    // EXHAUSTIVE — it requires every catalogue key to be present, so a caller
    // sending only the modules they changed would be rejected. partialRecord
    // keeps the key constraint (an unknown key is still a 400) while allowing a
    // subset, which is what a selection actually is.
    modules: z.partialRecord(z.enum(MODULE_KEYS as [string, ...string[]]), z.boolean()),
  })
  .strict();

export type ModuleSelectionInput = z.infer<typeof moduleSelectionSchema>;

/**
 * Body schema for POST /api/platform/tenants/[id]/archive — PRD §5.1
 * "Tenant deletion and data archival".
 *
 * `restore` distinguishes the two directions. Archiving takes a reason because
 * §46.3 asks for data-deletion WORKFLOWS and a workflow with no recorded reason
 * is not one; restoring does not, because the tenant becoming usable again is
 * self-explanatory and the archival record is what survives.
 *
 * No retention period and no deletion date: the PRD defines neither, so neither
 * is accepted or stored.
 */
export const tenantArchiveSchema = z
  .object({
    restore: z.boolean().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type TenantArchiveInput = z.infer<typeof tenantArchiveSchema>;

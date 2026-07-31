// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Template Validation
// FLOW   : Validates the certificate-template route params and request bodies
//          before either reaches the database.
// ACCESS : Not defined. The README's Phase 12 table names the routes but states
//          no role for them, and no approved decision assigns one, so none is
//          assumed here. Access control is performed by requireRole and the
//          routes regardless — this module never inspects a caller.
// BACKEND: No database access — Zod schema definitions only. No uniqueness
//          check, no tenant check and no foreign-key existence check is
//          performed here; each belongs to the route. Nothing is rendered and no
//          certificate number is generated.
// PURPOSE: Keep certificate-template request validation declarative and in one
//          place, matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { CertificateType } from "@/app/generated/prisma/client";

/**
 * Body schema for POST /api/certificate-templates.
 *
 * Mirrors the writable scalar columns of the CertificateTemplate model, in
 * column order.
 *
 * name and htmlTemplate are required — both columns are NOT NULL and neither
 * carries a default. Everything else is optional: type and isActive carry schema
 * defaults (CUSTOM and true), so an omitted key lets the database apply its own,
 * and cssStyles and variables are nullable.
 *
 * type is validated directly against the Prisma enum, so the accepted values
 * cannot drift from the database. All nine members are permitted; the schema
 * states no relationship between a template's type and anything else, and the
 * README states none, so no type is treated as special.
 *
 * htmlTemplate and cssStyles are plain String columns in the schema — not Json,
 * not a constrained format — so they are validated as strings and nothing more.
 * Both are trimmed, following the project-wide convention for string inputs, and
 * an empty or whitespace-only value is rejected rather than stored. Trimming is
 * safe for both: whitespace outside a document's root element is insignificant in
 * HTML, and leading or trailing whitespace is insignificant in CSS.
 *
 * No HTML validity check of any kind is applied. The template is not parsed, its
 * tags are not matched, its placeholders are not resolved against the variables
 * below, and nothing is escaped or stripped. The column is a String and the
 * schema asserts nothing about its contents, so asserting anything here would be
 * inventing a rule — and sanitising it would silently alter what the client
 * asked to store. Whatever safety a rendered certificate needs belongs to
 * whatever renders it, which this phase does not build.
 *
 * variables is a Json? column with no declared structure. It is accepted as an
 * object with unconstrained keys and values, which is the project's settled
 * treatment of a Json column — the same z.record(z.string(), z.unknown()) used
 * for Campus.address, three StudentPersonal columns, two Tenant columns and
 * UserRole.scope. The contents are not fabricated: no variable name is required,
 * none is forbidden, and nothing checks that a variable declared here appears in
 * htmlTemplate or vice versa. The schema declares no such link and the README
 * states none.
 *
 * The model has no array column and no writable date column, so no array or date
 * rule appears here. certificates is a relation rather than a writable field, and
 * createdAt and updatedAt are schema-managed.
 *
 * No cross-field rule is declared, because neither the schema nor the README
 * documents one. Nothing relates isActive to type, nothing relates cssStyles to
 * htmlTemplate, and nothing relates variables to either. Every invariant the
 * model carries is a per-column type or default, and each is expressed above.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId — server-managed. The tenant is derived from the validated
 *                  request context by requireTenant, never accepted from the
 *                  client, so a template cannot be created against another
 *                  tenant.
 *   createdAt,
 *   updatedAt    — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is the
 * project-wide behaviour of a plain z.object(): no schema in this project uses
 * .strict().
 */
export const createCertificateTemplateSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(CertificateType).optional(),
  htmlTemplate: z.string().trim().min(1),
  cssStyles: z.string().trim().min(1).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCertificateTemplateInput = z.infer<typeof createCertificateTemplateSchema>;

/**
 * Body schema for PATCH /api/certificate-templates/[id].
 *
 * Derived from createCertificateTemplateSchema rather than restated, so the enum
 * membership, trimming and Json rules stay defined in one place and cannot drift
 * apart.
 *
 * Nothing is omitted before .partial(). Every writable column stays mutable: the
 * model declares no @unique identity binding, so there is no equivalent of
 * FacultyMember.userId or Student.userId to freeze.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it —
 * a template can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * Every rule that applies on create applies here unchanged. There is no
 * cross-field rule to reapply, because none is declared — the create schema
 * carries no refine beyond the per-column rules, which .partial() preserves on
 * every key that is present.
 *
 * No versioning, publication or lifecycle rule is applied. The model carries no
 * version column, no publishedAt and no status enum, so editing a template
 * replaces its content in place and nothing records that a previous version
 * existed. Inventing any of those would be a business rule the schema does not
 * express.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateCertificateTemplateSchema = createCertificateTemplateSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateCertificateTemplateInput = z.infer<typeof updateCertificateTemplateSchema>;

/**
 * Route param schema for /api/certificate-templates/[id].
 *
 * CertificateTemplate.id is a cuid, but no format assertion is applied: the id is
 * an opaque key, and asserting a shape would turn an
 * unrecognised-but-well-formed id into a 400 when 404 is the accurate answer.
 * Only an empty or whitespace-only segment is rejected outright. Keyed on id
 * because that is the segment name.
 */
export const certificateTemplateIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type CertificateTemplateIdParam = z.infer<typeof certificateTemplateIdParamSchema>;

// No query schema is declared. GET /api/certificate-templates pages on the shared
// contract, and paginationQuerySchema is consumed directly by the route exactly
// as the timetable, attendance, assignment, examination and finance routes
// consume it. The README defines no filter parameter for this endpoint.

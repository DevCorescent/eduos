// ============================================================================
// OWNER  : Gauransh
// MODULE : Email Notifications — Notification Template Validation
// FLOW   : Validates the notification-template route param and the create
//          request body before either reaches the database.
// ACCESS : Not defined. The README's Phase 13 table names the routes but states
//          no role for them, and no approved decision assigns one, so none is
//          assumed here. Access control is performed by requireRole and the
//          routes regardless — this module never inspects a caller.
// BACKEND: No database access — Zod schema definitions only. No uniqueness
//          check, no tenant check and no foreign-key existence check is
//          performed here; each belongs to the route. Nothing is rendered and no
//          notification is sent by this module.
// PURPOSE: Keep notification-template request validation declarative and in one
//          place, matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { NotificationType } from "@/app/generated/prisma/client";

/**
 * Body schema for POST /api/notification-templates.
 *
 * Mirrors the writable scalar columns of the NotificationTemplate model, in
 * column order, narrowed to the fields the approved Phase 13 rules admit.
 *
 * name, type, subject and body are required. name, type and body are required by
 * the model itself — all three columns are NOT NULL and none carries a default.
 * subject is required by approved decision rather than by the schema: the column
 * is nullable, so the database would accept a template without one, and this
 * schema deliberately will not. That is a narrowing, not a contradiction — a
 * non-null value is always valid for a nullable column — but it does mean a
 * subject-less template cannot be created through this endpoint, which matters
 * because NotificationType declares SMS, PUSH and IN_APP alongside EMAIL and none
 * of those three carries a subject in the ordinary sense.
 *
 * type is validated directly against the Prisma enum, so the accepted values
 * cannot drift from the database. All four members are permitted — EMAIL, SMS,
 * PUSH and IN_APP — because the enum declares four and nothing here may narrow
 * that. The README titles Phase 13 "Email Notifications" and notes "SMS
 * deferred", but a deferred phase is not a validation rule: refusing SMS, PUSH or
 * IN_APP would enforce a roadmap position the schema does not express. type is
 * taken from the body and never derived; the column has no default, so an omitted
 * type is a client error rather than something to fill in.
 *
 * name and subject are trimmed and must be non-empty once trimmed, following the
 * project-wide convention for short string inputs.
 *
 * body is required and must be non-empty, but is deliberately NOT trimmed. It is
 * the message content itself, and unlike a name or a subject its leading and
 * trailing whitespace can be significant — a plain-text or preformatted mail part
 * is stored and sent as written. The consequence is that a body consisting only
 * of whitespace passes .min(1), since there is nothing to trim it down to zero
 * length; that follows from storing the content verbatim and is recorded as
 * technical debt rather than resolved by adding a rule.
 *
 * variables is a Json? column with no declared structure. It is accepted as an
 * object with unconstrained keys and values, which is the project's settled
 * treatment of a Json column — the same z.record(z.string(), z.unknown()) used
 * for Campus.address, three StudentPersonal columns, two Tenant columns,
 * UserRole.scope and CertificateTemplate.variables. The contents are not
 * fabricated and are not cross-checked: nothing verifies that a variable declared
 * here appears in body, or that a placeholder in body is declared here. The
 * schema declares no such link and the README states none.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, createdAt — server-managed.
 *   tenantId      — server-managed. The tenant is derived from the validated
 *                   request context by requireTenant, never accepted from the
 *                   client, so a template cannot be created against another
 *                   tenant. Note this column is nullable on this model, unlike
 *                   every other tenant-bearing model in the project, so the
 *                   schema anticipates global platform-owned templates as well as
 *                   tenant-owned ones. Which of the two a create produces is the
 *                   route's decision, not this module's.
 *   isActive      — not accepted from the client by approved decision. The
 *                   column's @default(true) is authoritative, so every template
 *                   is created active and there is no way to create an inactive
 *                   one.
 *
 * updatedAt is listed in no exclusion because the model declares no such column.
 * NotificationTemplate carries createdAt alone; a body supplying updatedAt has it
 * stripped as an ordinary unknown key.
 *
 * A body supplying any excluded field has it stripped rather than rejected, which
 * is the project-wide behaviour of a plain z.object(): no schema in this project
 * uses .strict().
 */
export const createNotificationTemplateSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(NotificationType),
  subject: z.string().trim().min(1),
  body: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export type CreateNotificationTemplateInput = z.infer<typeof createNotificationTemplateSchema>;

/**
 * Route param schema for a notification template's [id] segment.
 *
 * NotificationTemplate.id is a cuid, but no format assertion is applied: the id
 * is an opaque key, and asserting a shape would turn an
 * unrecognised-but-well-formed id into a 400 when 404 is the accurate answer.
 * Only an empty or whitespace-only segment is rejected outright. Keyed on id
 * because that is the segment name.
 *
 * The README's Phase 13 table declares GET and POST on
 * /api/notification-templates and no detail route, so nothing consumes this
 * schema yet. It is exported because it was specified, and it matches the id
 * param contract every other module declares.
 */
export const notificationTemplateIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type NotificationTemplateIdParam = z.infer<typeof notificationTemplateIdParamSchema>;

// No update schema is declared. The README's Phase 13 table defines GET and POST
// on /api/notification-templates and no PATCH, so there is no update contract to
// express — unlike certificate templates, which the README gives a detail route.
//
// No query schema is declared either. GET /api/notification-templates pages on
// the shared contract, and paginationQuerySchema is consumed directly by the
// route exactly as the timetable, attendance, assignment, examination, finance
// and certificate routes consume it. The README defines no filter parameter for
// this endpoint.

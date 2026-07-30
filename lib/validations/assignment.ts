// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Validation
// FLOW   : Validates the assignment route params and request bodies before
//          either reaches the database.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
//          No access control is performed here — that stays in requireRole and
//          the routes. STUDENT holds no assignment access in this phase.
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Keep assignment request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { AssignmentType } from "@/app/generated/prisma/client";

/**
 * Attachment list for an assignment.
 *
 * Assignment.attachments is a Json? column with no declared structure. The
 * project's settled treatment of a Json column is z.record(z.string(),
 * z.unknown()) — used for Campus.address, three StudentPersonal columns, two
 * Tenant columns and UserRole.scope — so the contents are accepted as given
 * rather than fabricated. Attachments are plural, so the array wrapper is the
 * only addition: it guarantees a reader can iterate the column, which a bare
 * record would not.
 *
 * The shape is therefore an array of objects and nothing else. A scalar, a
 * string, a number, a boolean, a bare object and an array of primitives are all
 * rejected — the outer z.array refuses anything that is not an array, and the
 * inner z.record refuses any element that is not an object.
 *
 * No file descriptor is asserted beyond that. The README names Cloudflare R2 for
 * storage but Phase 10 defines no upload endpoint, so the keys an attachment
 * carries are not yet established anywhere and declaring them here would fix a
 * contract before the thing it describes exists.
 */
const attachmentList = z.array(z.record(z.string(), z.unknown()));

/**
 * Body schema for POST /api/assignments.
 *
 * Mirrors the writable scalar columns of the Assignment model, in column order.
 * courseId and title are required — everything else is optional, and where the
 * column carries a schema default an omitted key lets the database apply it
 * rather than restating the value here.
 *
 * courseId is required because the column is NOT NULL and carries a real foreign
 * key to Course. sectionId is nullable and optional; it is validated here only
 * for shape. That each referenced row exists AND belongs to the authenticated
 * tenant is enforced against the database in the route, never here — and for
 * sectionId that route lookup is the only protection the column has anywhere,
 * because Assignment declares no section relation and the migration emits no
 * foreign key for it. The column would otherwise accept any string, including
 * another tenant's section id. Same situation as Course.departmentId and
 * Attendance.courseId.
 *
 * type carries the schema default HOMEWORK and is validated directly against the
 * Prisma enum, so the accepted values cannot drift from the database.
 *
 * maxMarks is bounded to a positive integer. The column is a plain Int with a
 * default of 100 and no check constraint, so the database would accept zero or a
 * negative figure, but an assignment worth nothing or worth negative marks is not
 * a coherent value — this is a domain invariant of the field itself rather than a
 * policy layered on top of it, the same reasoning already applied to
 * FacultyMember.experience. It is also what makes the route's 0..maxMarks bound
 * on a submission's marks meaningful.
 *
 * dueDate is optional and coerced, matching the project-wide z.coerce.date()
 * convention. No bound is placed on it: nothing in the schema or README forbids a
 * past or future due date, and inventing one would be a business rule. Late
 * submissions are recorded rather than refused, so a past dueDate is a legitimate
 * value.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId     — server-managed. The tenant is derived from the validated
 *                      request context by requireTenant, never accepted from the
 *                      client, so an assignment cannot be created against another
 *                      tenant.
 *   createdBy        — set by the route from the authenticated session. Accepting
 *                      it from the body would let any caller attribute authorship
 *                      to another user. Same treatment as Attendance.markedBy.
 *   status           — server-managed and always DRAFT on create. The lifecycle
 *                      is DRAFT then PUBLISHED then CLOSED then GRADED, and the
 *                      transition into PUBLISHED belongs to
 *                      POST /api/assignments/[id]/publish alone.
 *   publishedAt      — server-managed, set only by that publish route. It is the
 *                      visibility predicate for this phase, so a client able to
 *                      set it could publish an assignment without transitioning
 *                      its status.
 *   createdAt,
 *   updatedAt        — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is the
 * project-wide behaviour of a plain z.object(): no schema in this project uses
 * .strict(), and assignments do not become the first.
 */
export const createAssignmentSchema = z.object({
  courseId: z.string().trim().min(1),
  sectionId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  type: z.enum(AssignmentType).optional(),
  maxMarks: z.number().int().positive().optional(),
  dueDate: z.coerce.date().optional(),
  attachments: attachmentList.optional(),
});

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

/**
 * Body schema for PATCH /api/assignments/[id].
 *
 * Derived from createAssignmentSchema rather than restated, so the enum
 * membership, date coercion, trimming and attachment rules stay defined in one
 * place and cannot drift apart.
 *
 * Nothing is omitted before .partial(). courseId stays mutable, matching
 * Course.departmentId, whose detail route re-validates a changed reference
 * rather than freezing it; the route applies the same tenant-scoped check to a
 * supplied courseId or sectionId that the create path does. This differs from
 * FacultyMember.userId and Student.userId, which are omitted from their update
 * schemas because they are @unique identity bindings — Assignment.courseId is
 * neither unique nor an identity binding.
 *
 * tenantId, createdBy, status and publishedAt are absent from the create schema,
 * so .partial() cannot introduce them: an assignment can never be moved between
 * tenants, re-attributed, published, or advanced through its lifecycle by this
 * endpoint. Advancing status to CLOSED or GRADED is a route-level transition
 * applied to the stored value, not a body field, so it needs no key here.
 *
 * Every remaining key is optional, but at least one must be present: an empty
 * body is a client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateAssignmentSchema = createAssignmentSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

/**
 * Route param schema for /api/assignments/[id].
 *
 * Assignment.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed
 * id into a 400 when 404 is the accurate answer. Only an empty or whitespace-only
 * segment is rejected outright.
 */
export const assignmentIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type AssignmentIdParam = z.infer<typeof assignmentIdParamSchema>;

// No query schema is declared. GET /api/assignments pages on the shared
// contract, and paginationQuerySchema is consumed directly by the route exactly
// as the timetable and attendance routes consume it — the aliases other modules
// define (courseQuerySchema and siblings) are plain re-exports of that same
// object, never extensions of it, so declaring one here would add a name without
// adding a rule. No filter parameter is defined for this phase.

// No publish schema is declared. POST /api/assignments/[id]/publish carries no
// body: the transition it performs is fixed, its target state is not chosen by
// the caller, and both columns it writes are server-managed. A body schema would
// be dead code.

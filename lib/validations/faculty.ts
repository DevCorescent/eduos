// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Faculty Member Validation
// FLOW   : Validates the faculty listing query, route param, creation body and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep faculty request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { EmployeeStatus } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "./pagination";

/**
 * A filter the toolbar may send empty.
 *
 * Restated from listStudentsQuerySchema rather than shared, matching how each
 * validation module in this project keeps its own copy. "" means "no filter":
 * the ListFilter reset writes an empty value, and a hand-edited or bookmarked
 * "?departmentId=" must mean the same rather than answer 400.
 *
 * NO FORMAT ASSERTION on the id: it is an opaque foreign key, and one naming
 * nothing — or naming another tenant's row — simply matches no faculty, because
 * the tenant predicate is ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Query schema for GET /api/faculty — tester issue #26.
 *
 * WHAT WAS WRONG
 *   This was `paginationQuerySchema` and nothing else, so Zod dropped ?q,
 *   ?status and ?departmentId before the handler saw them and the route read
 *   every faculty member in the tenant. The Faculty page knew: it rendered its
 *   search box and both filters DISABLED, with a note saying they would work
 *   once the backend accepted the parameters. This is that.
 *
 *   The page has always read q, status and departmentId from its searchParams,
 *   passed them to listFaculty and carried them through pagination, so nothing
 *   there changes except removing the disabled state.
 *
 * WHY status IS PREPROCESSED
 *   "All statuses" writes an empty value. Treating it as absent BEFORE the enum
 *   check is what stops "no filter" being reported as an invalid EmployeeStatus
 *   — the same reason listStudentsQuerySchema does it for StudentStatus.
 */
export const facultyQuerySchema = paginationQuerySchema.extend({
  q: optionalFilter,
  departmentId: optionalFilter,
  status: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.nativeEnum(EmployeeStatus).optional()
    )
    .optional(),
});

export type FacultyQuery = z.infer<typeof facultyQuerySchema>;

/**
 * Route param schema for /api/faculty/[id] and its nested routes.
 *
 * FacultyMember.id is a cuid, not a UUID, so no UUID assertion is applied — it
 * would reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const facultyIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type FacultyIdParam = z.infer<typeof facultyIdParamSchema>;

/**
 * Body schema for POST /api/faculty.
 *
 * Mirrors the writable scalar columns of the FacultyMember model. userId,
 * employeeId and joinDate are required; departmentId, designation,
 * qualification, specialization and experience are nullable, and status carries
 * a schema default of ACTIVE, so an omitted key lets the database default apply.
 *
 * tenantId is intentionally absent, along with id, createdAt and updatedAt: the
 * tenant is derived from the validated request context by requireTenant, never
 * accepted from the client, so a faculty member cannot be created against
 * another tenant.
 *
 * userId and departmentId are validated here only for shape. That each
 * referenced row exists AND belongs to the authenticated tenant cannot be
 * expressed in Zod and is enforced against the database in the route.
 *
 * Two uniqueness rules apply and both are the route's to check:
 * FacultyMember.userId is @unique globally, so a user may hold at most one
 * faculty record, while @@unique([tenantId, employeeId]) makes an employee id
 * unique within the tenant and allows the same id under a different tenant.
 *
 * experience is bounded to zero or more. The column is a plain Int? with no
 * check constraint, so the database would accept a negative figure, but years of
 * service cannot be negative — this is a domain invariant of the value itself
 * rather than a policy layered on top of it, so it is rejected as invalid input
 * rather than stored.
 *
 * Note the column spelling: FacultyMember.specialization is American and
 * singular, and is a free-text field describing the member's field of expertise.
 * It is unrelated to the Specialisation model, which is spelt British and models
 * a programme's named streams.
 */
export const createFacultySchema = z.object({
  userId: z.string().trim().min(1),
  /**
   * Optional since WP-1: omitted, the identifier engine issues it from the
   * institution's configured sequence (PRD §9). Supplied, the value is used
   * as given, which is what keeps legacy imports and institutions without a
   * configured sequence working exactly as before.
   */
  employeeId: z.string().trim().min(1).optional(),
  joinDate: z.coerce.date(),
  departmentId: z.string().trim().min(1).optional(),
  designation: z.string().trim().min(1).optional(),
  qualification: z.string().trim().min(1).optional(),
  specialization: z.string().trim().min(1).optional(),
  experience: z.number().int().nonnegative().optional(),
  status: z.enum(EmployeeStatus).optional(),
});

export type CreateFacultyInput = z.infer<typeof createFacultySchema>;

/**
 * Body schema for PATCH /api/faculty/[id].
 *
 * Derived from createFacultySchema rather than restated, so the enum
 * membership, date coercion and trimming rules stay defined in one place and
 * cannot drift apart.
 *
 * userId is omitted before the schema is made partial, leaving only mutable
 * columns. A faculty record stays permanently bound to the User it was created
 * against: re-pointing one at a different person is an account transfer rather
 * than a profile edit, and no such feature is described in the schema or the
 * README. This matches the same restriction already applied to Student.userId.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a faculty member can never be moved between tenants through this endpoint.
 *
 * Every remaining key is optional, but at least one must be present: an empty
 * body is a client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
/**
 * departmentId gains the same three states the student update has — tester
 * issue #25, which reproduced identically here.
 *
 *   omitted   leave the column unchanged
 *   ""        clear it to null
 *   an id     point it at that department
 *
 * `.partial()` alone gives only the first and third: a key that IS present must
 * still satisfy the create rule, and there departmentId is `min(1)`. So
 * updateFacultyAction, which sends "" for a blank department select, made an
 * unchanged Save fail with 400 "Invalid input" for any faculty member who had
 * no department — the same defect the tester reported against Edit Student.
 *
 * The create schema is unchanged: creating a faculty member with
 * departmentId: "" is meaningless; only an edit can clear an existing value.
 */
const clearableId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable().optional()
);

export const updateFacultySchema = createFacultySchema
  .omit({ userId: true })
  .partial()
  .extend({ departmentId: clearableId })
  .refine((data) => Object.keys(data).length > 0);

export type UpdateFacultyInput = z.infer<typeof updateFacultySchema>;

/** Query schema for GET /api/faculty/[id]/assignments. */
export const facultyAssignmentQuerySchema = paginationQuerySchema;

export type FacultyAssignmentQuery = z.infer<typeof facultyAssignmentQuerySchema>;

/**
 * Body schema for POST /api/faculty/[id]/assignments.
 *
 * Mirrors the writable scalar columns of the FacultyCourseAssignment model.
 * courseId is required; sectionId and semesterId are nullable, and isActive
 * carries a schema default of true, so an omitted key lets the database default
 * apply.
 *
 * Two fields are deliberately absent so a client cannot supply them: facultyId,
 * because the route parameter decides which member the assignment belongs to,
 * and tenantId, which is derived from the validated request context.
 *
 * All three ids are validated here only for shape. That each referenced row
 * exists AND belongs to the authenticated tenant is enforced against the
 * database in the route — and for sectionId and semesterId that check is the
 * only one there is, because neither column carries a relation or a foreign key
 * in the schema, exactly as with Student.programmeId.
 */
export const createFacultyAssignmentSchema = z.object({
  courseId: z.string().trim().min(1),
  sectionId: z.string().trim().min(1).optional(),
  semesterId: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type CreateFacultyAssignmentInput = z.infer<typeof createFacultyAssignmentSchema>;

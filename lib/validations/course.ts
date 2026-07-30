// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Course Validation
// FLOW   : Validates the course listing query, route param, creation body and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep course request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { CourseType } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/courses.
 *
 * Pagination is the shared contract. No search or filter parameter is defined:
 * the project implements none on any existing collection endpoint, so adding one
 * here would introduce a capability the rest of the API does not have. In
 * particular there is no ?isActive filter, even though the column exists —
 * inactive courses list alongside active ones and the client reads the flag.
 */
export const courseQuerySchema = paginationQuerySchema;

export type CourseQuery = z.infer<typeof courseQuerySchema>;

/**
 * Route param schema for /api/courses/[id].
 *
 * Course.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const courseIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type CourseIdParam = z.infer<typeof courseIdParamSchema>;

/**
 * Body schema for POST /api/courses.
 *
 * Mirrors the writable scalar columns of the Course model, in column order. Only
 * name and code are required. departmentId, description and syllabus are
 * nullable, and type, credits and isActive carry schema defaults (CORE, 3 and
 * true), so an omitted key lets the database default apply.
 *
 * tenantId is intentionally absent, along with id, createdAt and updatedAt: the
 * tenant is derived from the validated request context by requireTenant, never
 * accepted from the client, so a course cannot be created against another
 * tenant.
 *
 * departmentId is validated here only for shape. That the referenced department
 * exists AND belongs to the authenticated tenant is enforced against the
 * database in the route, and that lookup is the only protection the reference
 * has anywhere: Course declares no foreign key at all in the migration — not on
 * departmentId, and not even on tenantId — so both columns would otherwise
 * accept any string, including another tenant's id or arbitrary text. This
 * places departmentId in the same category as Employee.departmentId and
 * Student.programmeId rather than FacultyMember.departmentId, which does carry a
 * key.
 *
 * @@unique([tenantId, code]) makes a course code unique within the tenant while
 * allowing the same code under a different tenant, so the duplicate check is the
 * route's to perform against the resolved tenant rather than globally.
 *
 * credits is bounded only as an integer. Neither the schema nor the README
 * constrains its range, and Programme.totalCredits — the closest existing
 * column — is likewise declared as a plain optional integer, so a bound here
 * would diverge from the project's own precedent. The non-negative bound on
 * FacultyMember.experience exists because it was ruled a domain invariant, not
 * because unbounded integers are treated as invalid by default.
 */
export const createCourseSchema = z.object({
  departmentId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  type: z.enum(CourseType).optional(),
  credits: z.number().int().optional(),
  description: z.string().trim().min(1).optional(),
  syllabus: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;

/**
 * Body schema for PATCH /api/courses/[id].
 *
 * Derived from createCourseSchema rather than restated, so the enum membership
 * and trimming rules stay defined in one place and cannot drift apart.
 *
 * Nothing is omitted before .partial(). Unlike Student, FacultyMember and
 * Employee — each permanently bound to the User it was created against — Course
 * has no identity column that outlives an edit, so every writable column
 * including code is mutable. Changing code re-enters the tenant-scoped
 * uniqueness check in the route.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it —
 * a course can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateCourseSchema = createCourseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — Role Validation
// FLOW   : Validates the role listing query, creation body, route param and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep role request validation declarative and in one place, matching
//          the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/roles.
 *
 * Pagination is the shared contract. No search or filter parameter is defined:
 * the project implements none on any existing collection endpoint, so adding
 * one here would introduce a capability the rest of the API does not have.
 */
export const listRolesQuerySchema = paginationQuerySchema;

export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;

/**
 * Route param schema for /api/roles/[id].
 *
 * Role.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const roleIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type RoleIdParam = z.infer<typeof roleIdParamSchema>;

/**
 * Body schema for POST /api/roles.
 *
 * Mirrors the writable scalar columns of the Role model. Only name is required;
 * description is nullable and isSystem carries a schema default of false, so an
 * omitted key lets the database default apply.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a role
 * cannot be created against another tenant.
 *
 * isSystem is deliberately NOT accepted. It marks platform-seeded roles and is
 * never settable by a client; the route layer lets the schema default (false)
 * apply, so a role created through the API is always a tenant role.
 *
 * Role.name is unique per tenant via @@unique([tenantId, name]), so the same
 * role name may legitimately exist under a different tenant. The name is also
 * the value embedded in the JWT and compared by requireRole, which is why it is
 * trimmed: a stray space would produce a role that can be created but never
 * matched at authorisation time.
 */
export const createRoleSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * Body schema for PATCH /api/roles/[id].
 *
 * Derived from createRoleSchema rather than restated, so the trimming and
 * field rules stay defined in one place and cannot drift apart.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a role can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateRoleSchema = createRoleSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

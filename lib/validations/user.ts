// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — User Validation
// FLOW   : Validates the user listing query, creation body, route param,
//          update body and role-assignment body before any of them reach the
//          database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep user and role-assignment request validation declarative and in
//          one place, matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { phoneField } from "./phone";
import { loginSchema } from "./auth";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/users.
 *
 * Pagination is the shared contract. No search or filter parameter is defined:
 * the project implements none on any existing collection endpoint, so adding
 * one here would introduce a capability the rest of the API does not have.
 */
export const listUsersQuerySchema = paginationQuerySchema;

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * Route param schema for /api/users/[id] and its nested routes.
 *
 * User.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const userIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type UserIdParam = z.infer<typeof userIdParamSchema>;

/**
 * Body schema for POST /api/users.
 *
 * Mirrors the writable scalar columns of the User model. email, password,
 * firstName and lastName are required; the rest are nullable or carry a schema
 * default, so an omitted key lets the database default apply.
 *
 * isVerified is deliberately NOT accepted. It is a server-managed trust flag
 * asserting that an address has actually been verified, so it is never settable
 * by a client on create or update; the schema default (false) applies and only
 * a verification flow may raise it.
 *
 * password is not a column. User.passwordHash is non-null and there is no
 * invitation or token model anywhere in the schema, so a user cannot be created
 * without one. The plaintext value is accepted here and hashed by the route
 * through the existing hashPassword helper; the hash is what reaches Prisma.
 * Its rule is taken directly from loginSchema rather than restated, so the two
 * cannot drift: tightening the login rule tightens this one.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a user
 * cannot be created against another tenant.
 *
 * lastLoginAt is also absent — it is written by the login flow, not by an
 * administrator.
 *
 * User.email is unique per tenant via @@unique([tenantId, email]), so the same
 * address may legitimately exist under a different tenant.
 */
export const createUserSchema = z.object({
  email: z.email(),
  password: loginSchema.shape.password,
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  // Tester issue #24: enrolling a student writes the person as a User, and
  // this is where that phone number lands — Student carries no phone column of
  // its own, so this is the only server boundary the enrolment form crosses.
  // It was `z.string().trim().min(1)`, so an invalid number entered on the
  // Enrol Student screen was stored unchallenged.
  //
  // This field is shared with faculty and employee creation, which post to the
  // same endpoint. They therefore gain the same validation — the same rule,
  // consistently applied, not a new one.
  phone: phoneField.optional(),
  displayName: z.string().trim().min(1).optional(),
  avatarUrl: z.url().optional(),
  isActive: z.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Body schema for PATCH /api/users/[id].
 *
 * Derived from createUserSchema rather than restated, so the email, url and
 * trimming rules stay defined in one place and cannot drift apart.
 *
 * password is omitted before the schema is made partial, so this endpoint
 * cannot change a credential. README Phase 1 assigns password changes to
 * /api/auth/forgot-password and /api/auth/reset-password; user administration
 * is not given that capability anywhere in the README, so it is not exposed
 * here.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a user can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Body schema for POST /api/users/[id]/roles.
 *
 * Mirrors the writable columns of the UserRole join model that a client may
 * supply. UserRole has a composite primary key, @@id([userId, roleId]), and no
 * id column of its own.
 *
 * userId is intentionally absent: it comes from the route parameter, so a role
 * can never be granted to a user other than the one addressed by the URL.
 *
 * grantedBy is also absent: it records who performed the grant and is taken
 * from the authenticated session by the route, never from the client.
 *
 * scope is accepted because the schema models it as a nullable Json column and
 * the README describes roles that are scoped rather than tenant-wide — a campus
 * administrator is scoped to one campus, a department head to one department.
 * Its contents are not constrained here: neither the schema nor the README
 * defines a shape for them.
 */
export const assignRoleSchema = z.object({
  roleId: z.string().trim().min(1),
  scope: z.record(z.string(), z.unknown()).optional(),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

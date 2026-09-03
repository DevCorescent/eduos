// ============================================================================
// MODULE : Services — Users & RBAC
// PURPOSE: The tenant user directory, and the role grants that govern it.
//
//          One shape to be careful about: GET /api/users returns bare User rows
//          — the route's own comment says userRoles is deliberately not
//          expanded, because joining it would return one row per role and
//          break the page count. Roles arrive only from GET /api/users/[id].
//
//          The list screen still wants role badges, so listUsers returns
//          UserWithRoles and composes them: after the page of users comes back,
//          each row's roles are read from GET /api/users/[id] in parallel. That
//          is one extra request per row, bounded by the page limit the caller
//          asked for — the alternative is blank role columns on every screen
//          that manages access, which is the one place a blank must not appear.
// ============================================================================

import type {
  ApiResponse,
  ListParams,
  PaginatedResult,
  Permission,
  Role,
  RoleWithCounts,
  User,
  UserWithRoles,
} from "@/types";
import { MAX_LIST_LIMIT } from "@/types/api";
import { apiList, apiRequest } from "./client";

/**
 * A user row flattened for search and filtering.
 *
 * `fullName` and `roleNames` are precomputed so a caller can match a name typed
 * in full, or a role typed by name, without re-deriving either per keystroke.
 */
export interface UserRow extends UserWithRoles {
  fullName: string;
  roleNames: string;
}

export async function listUsers(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<UserRow>>> {
  const result = await apiList<User>("/api/users", "users", params);
  if (!result.success) return result;

  // Issued together rather than in sequence: the detail reads are independent,
  // and awaiting them one at a time would turn a page of 20 into 20 round trips
  // of latency instead of one.
  const rows = await Promise.all(
    result.data.items.map(async (user) => {
      const detail = await apiRequest<UserWithRoles>(`/api/users/${user.id}`);
      // A row whose detail read failed keeps its scalar columns and shows no
      // badges. Losing one user's roles must not blank the whole directory.
      const roles = detail.success ? (detail.data.roles ?? []) : [];

      return {
        ...user,
        roles,
        fullName: `${user.firstName} ${user.lastName}`,
        roleNames: roles.map((role) => role.name).join(", "),
      };
    })
  );

  return { success: true, data: { ...result.data, items: rows } };
}

export async function getUser(id: string): Promise<ApiResponse<UserWithRoles>> {
  return apiRequest<UserWithRoles>(`/api/users/${id}`);
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  isActive?: boolean;
}

export async function createUser(input: CreateUserInput): Promise<ApiResponse<User>> {
  return apiRequest<User>("/api/users", { method: "POST", body: input });
}

export interface UpdateUserInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isActive?: boolean;
}

export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<ApiResponse<User>> {
  return apiRequest<User>(`/api/users/${id}`, { method: "PATCH", body: input });
}

export async function deleteUser(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/users/${id}`, { method: "DELETE" });
}

// --- Role assignment --------------------------------------------------------

export async function assignRole(
  userId: string,
  roleId: string
): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/users/${userId}/roles`, { method: "POST", body: { roleId } });
}

/**
 * Resolve one of the tenant's own roles by NAME, to its id.
 *
 * WHY THIS EXISTS
 *   Creating a faculty member or enrolling a student writes a User and then the
 *   domain record. Neither step grants a role — POST /api/users accepts no role
 *   field — so the account signed in holding nothing, homeRouteForRoles() found
 *   no portal for it and sent the person to /no-access: "Your account holds no
 *   role that opens a portal." The form had just asked for their password and
 *   promised they would change it after signing in.
 *
 * THE NAME IS THE CALLER'S, NEVER THE CLIENT'S
 *   Callers pass a constant from constants/roles.ts. Nothing in a form body
 *   reaches this argument, so a created account cannot be talked into holding a
 *   role somebody typed — which is the reason this resolves a name rather than
 *   accepting a roleId from the caller's input.
 *
 * TENANT SCOPING IS THE ENDPOINT'S, NOT THIS FUNCTION'S
 *   GET /api/roles applies requireRole("UNIVERSITY_ADMIN") and requireTenant(),
 *   so it can only ever return roles belonging to the authenticated tenant.
 *   This reads that answer; it cannot widen it, and a role name that exists in
 *   another university is simply not found here.
 *
 * A MISSING ROLE IS REPORTED, NOT CREATED
 *   TENANT_SYSTEM_ROLES provisions FACULTY and STUDENT with every tenant, so an
 *   absent one means the university predates that provisioning — a
 *   configuration fact an administrator must see and fix. Minting the role here
 *   would hide it, and would also mean this function could invent authority.
 */
export async function findTenantRoleByName(name: string): Promise<ApiResponse<Role>> {
  // One page is enough: roles are per-tenant system roles plus whatever few an
  // administrator has added, and the endpoint caps a page at MAX_LIST_LIMIT.
  const result = await listRoles({ page: 1, limit: MAX_LIST_LIMIT });
  if (!result.success) return result;

  const role = result.data.items.find((candidate) => candidate.name === name);

  if (!role) {
    return {
      success: false,
      error: `This university has no "${name}" role. Create it under Users & Roles, then try again.`,
      code: "NOT_FOUND",
    };
  }

  return { success: true, data: role };
}

export async function unassignRole(
  userId: string,
  roleId: string
): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/users/${userId}/roles/${roleId}`, { method: "DELETE" });
}

// --- Roles ------------------------------------------------------------------

export async function listRoles(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<RoleWithCounts>>> {
  const result = await apiList<Role>("/api/roles", "roles", params);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      // Zero, not a guess: neither count is returned by the endpoint, and the
      // UI renders "—" for a zero rather than claiming an empty role.
      items: result.data.items.map((role) => ({
        ...role,
        permissionCount: 0,
        userCount: 0,
      })),
    },
  };
}

export async function getRole(id: string): Promise<ApiResponse<Role>> {
  return apiRequest<Role>(`/api/roles/${id}`);
}

export interface RoleInput {
  name: string;
  description?: string;
}

export async function createRole(input: RoleInput): Promise<ApiResponse<Role>> {
  return apiRequest<Role>("/api/roles", { method: "POST", body: input });
}

export async function updateRole(
  id: string,
  input: Partial<RoleInput>
): Promise<ApiResponse<Role>> {
  return apiRequest<Role>(`/api/roles/${id}`, { method: "PATCH", body: input });
}

export async function deleteRole(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/roles/${id}`, { method: "DELETE" });
}

/**
 * Permissions granted to a role, resolved to the full Permission rows.
 *
 * The parameter is unread on purpose: it is the contract callers already write
 * against, and only the endpoint behind it is missing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function listRolePermissions(roleId: string): Promise<ApiResponse<Permission[]>> {
  // No endpoint exposes a role's permissions yet — the routes cover Role but
  // not RolePermission. Reported as unavailable rather than as an empty grant,
  // which would read as "this role can do nothing".
  return {
    success: false,
    error: "Role permissions are not available from the API yet.",
    code: "NOT_FOUND",
  };
}

/**
 * Every permission the system defines.
 *
 * NO ENDPOINT EXPOSES THE PERMISSION CATALOGUE. The routes cover Role but
 * neither Permission nor RolePermission, so a matrix cannot be rendered from
 * live data. Returns empty rather than a hand-written list: a catalogue the
 * backend never confirmed would show grants that may not exist.
 */
export function allPermissions(): Permission[] {
  return [];
}

/** Users in the directory, unfiltered — used to size the invite screen's copy. */
export async function totalDirectorySize(): Promise<number> {
  const result = await apiList<User>("/api/users", "users", { page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : 0;
}

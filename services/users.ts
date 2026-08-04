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
//          UserWithRoles and composes them. In mock mode that is a lookup; on
//          the live path it cannot be done in one request, so roles come back
//          empty and the caller renders nothing rather than guessing.
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
import { apiList, apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import { MOCK_TENANT_ID } from "@/mock/data/context";
// ROLE_IDS_BY_USER and USER_COUNT_BY_ROLE are deliberately not imported: both
// are snapshots taken at module load, and every count here is read live from
// userRoleStore so a grant made during this session is reflected immediately.
import {
  MOCK_PERMISSIONS,
  MOCK_ROLE_PERMISSIONS,
  PERMISSION_COUNT_BY_ROLE,
  ROLE_BY_ID,
} from "@/mock/data/rbac";
import { MOCK_USERS } from "@/mock/data/people";
import { roleStore, userRoleStore, userStore } from "@/mock/rbacStores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

/** Attach the roles a user holds, from the mock assignment store. */
function withRoles(user: User): UserWithRoles {
  const roleIds =
    userRoleStore
      .all()
      .filter((assignment) => assignment.userId === user.id)
      .map((assignment) => assignment.roleId) ?? [];

  return {
    ...user,
    roles: roleIds
      .map((roleId) => roleStore.find(roleId) ?? ROLE_BY_ID.get(roleId))
      .filter((role): role is Role => Boolean(role))
      .map((role) => ({ id: role.id, name: role.name })),
  };
}

/**
 * A user row flattened for search and filtering.
 *
 * `fullName` and `roleNames` exist so the mock's substring search can match a
 * name typed in full and a role typed by name — neither is reachable from the
 * scalar columns the API actually returns.
 */
export interface UserRow extends UserWithRoles {
  fullName: string;
  roleNames: string;
}

export async function listUsers(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<UserRow>>> {
  if (USE_MOCKS) {
    const rows: UserRow[] = userStore.all().map((user) => {
      const withRoleData = withRoles(user);
      return {
        ...withRoleData,
        fullName: `${user.firstName} ${user.lastName}`,
        roleNames: withRoleData.roles.map((role) => role.name).join(" "),
      };
    });

    // roleId is filtered here rather than through matchesFilters, because the
    // value lives on the join rather than on the row itself.
    const filtered =
      typeof params?.roleId === "string" && params.roleId
        ? rows.filter((row) => row.roles.some((role) => role.id === params.roleId))
        : rows;

    return mockList(filtered, params, {
      searchFields: ["fullName", "email", "roleNames"],
      filterKeys: ["isActive"],
      sort: (a, b) => a.fullName.localeCompare(b.fullName),
    });
  }

  const result = await apiList<User>("/api/users", "users", params);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      // Empty, not invented: the collection endpoint does not expand roles, and
      // fetching them per row would be one request per user.
      items: result.data.items.map((user) => ({
        ...user,
        roles: [],
        fullName: `${user.firstName} ${user.lastName}`,
        roleNames: "",
      })),
    },
  };
}

export async function getUser(id: string): Promise<ApiResponse<UserWithRoles>> {
  if (USE_MOCKS) {
    const user = userStore.find(id);
    return user ? mockOk(withRoles(user)) : mockFail<UserWithRoles>("User not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    // @@unique([tenantId, email]) — the same address may exist under a
    // different tenant, but not twice within one.
    if (userStore.all().some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      return mockFail<User>("Email already in use", "CONFLICT");
    }

    const timestamp = now();
    return mockOk(
      userStore.insert({
        id: userStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        email: input.email.toLowerCase(),
        phone: input.phone ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: null,
        avatarUrl: null,
        isActive: input.isActive ?? true,
        // A newly invited user has not confirmed their address yet — starting
        // them verified would make the badge meaningless.
        isVerified: false,
        lastLoginAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "User created"
    );
  }
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
  if (USE_MOCKS) {
    const duplicate = userStore
      .all()
      .some((u) => u.id !== id && input.email && u.email.toLowerCase() === input.email.toLowerCase());
    if (duplicate) return mockFail<User>("Email already in use", "CONFLICT");

    const updated = userStore.update(id, { ...input, updatedAt: now() });
    return updated ? mockOk(updated, "User updated") : mockFail<User>("User not found", "NOT_FOUND");
  }
  return apiRequest<User>(`/api/users/${id}`, { method: "PATCH", body: input });
}

export async function deleteUser(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (!userStore.find(id)) return mockFail<null>("User not found", "NOT_FOUND");

    // Assignments go with the user. UserRole cascades on delete in the schema,
    // so leaving them would diverge from what the database actually does.
    for (const assignment of userRoleStore.all().filter((a) => a.userId === id)) {
      userRoleStore.remove(`${assignment.userId}:${assignment.roleId}`);
    }

    userStore.remove(id);
    return mockOk(null, "User deleted");
  }
  return apiRequest<null>(`/api/users/${id}`, { method: "DELETE" });
}

// --- Role assignment --------------------------------------------------------

export async function assignRole(
  userId: string,
  roleId: string
): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (!userStore.find(userId)) return mockFail<null>("User not found", "NOT_FOUND");
    if (!roleStore.find(roleId)) return mockFail<null>("Role not found", "NOT_FOUND");

    const alreadyHeld = userRoleStore
      .all()
      .some((a) => a.userId === userId && a.roleId === roleId);
    if (alreadyHeld) {
      return mockFail<null>("User already holds this role", "CONFLICT");
    }

    userRoleStore.insert({
      // The store addresses rows by `id`, but UserRole's primary key is the
      // composite (userId, roleId). The pair is joined into a synthetic id so
      // one store implementation serves both shapes.
      id: `${userId}:${roleId}`,
      userId,
      roleId,
      scope: null,
      grantedAt: now(),
      grantedBy: null,
    });

    return mockOk(null, "Role assigned");
  }
  return apiRequest<null>(`/api/users/${userId}/roles`, { method: "POST", body: { roleId } });
}

export async function unassignRole(
  userId: string,
  roleId: string
): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    return userRoleStore.remove(`${userId}:${roleId}`)
      ? mockOk(null, "Role unassigned")
      : mockFail<null>("Role assignment not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/users/${userId}/roles/${roleId}`, { method: "DELETE" });
}

// --- Roles ------------------------------------------------------------------

export async function listRoles(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<RoleWithCounts>>> {
  if (USE_MOCKS) {
    const rows: RoleWithCounts[] = roleStore.all().map((role) => ({
      ...role,
      permissionCount: PERMISSION_COUNT_BY_ROLE.get(role.id) ?? 0,
      // Counted live from the store rather than the precomputed map, so a role
      // assigned during this session reports the new figure.
      userCount: userRoleStore.all().filter((a) => a.roleId === role.id).length,
    }));

    return mockList(rows, params, {
      searchFields: ["name", "description"],
      sort: (a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name),
    });
  }

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
  if (USE_MOCKS) {
    const role = roleStore.find(id);
    return role ? mockOk(role) : mockFail<Role>("Role not found", "NOT_FOUND");
  }
  return apiRequest<Role>(`/api/roles/${id}`);
}

export interface RoleInput {
  name: string;
  description?: string;
}

export async function createRole(input: RoleInput): Promise<ApiResponse<Role>> {
  if (USE_MOCKS) {
    if (roleStore.all().some((r) => r.name.toLowerCase() === input.name.toLowerCase())) {
      return mockFail<Role>("Role name already in use", "CONFLICT");
    }

    const timestamp = now();
    return mockOk(
      roleStore.insert({
        id: roleStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        name: input.name,
        description: input.description ?? null,
        // Forced false, exactly as the route does: isSystem marks the roles the
        // platform ships and must never be settable from a request body.
        isSystem: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "Role created"
    );
  }
  return apiRequest<Role>("/api/roles", { method: "POST", body: input });
}

export async function updateRole(
  id: string,
  input: Partial<RoleInput>
): Promise<ApiResponse<Role>> {
  if (USE_MOCKS) {
    const role = roleStore.find(id);
    if (!role) return mockFail<Role>("Role not found", "NOT_FOUND");

    // A system role's name is referenced by the portal guards and by
    // homeRouteForRoles; renaming it would silently lock people out.
    if (role.isSystem && input.name && input.name !== role.name) {
      return mockFail<Role>("System roles cannot be renamed", "FORBIDDEN");
    }

    const duplicate = roleStore
      .all()
      .some((r) => r.id !== id && input.name && r.name.toLowerCase() === input.name.toLowerCase());
    if (duplicate) return mockFail<Role>("Role name already in use", "CONFLICT");

    const updated = roleStore.update(id, { ...input, updatedAt: now() });
    return updated ? mockOk(updated, "Role updated") : mockFail<Role>("Role not found", "NOT_FOUND");
  }
  return apiRequest<Role>(`/api/roles/${id}`, { method: "PATCH", body: input });
}

export async function deleteRole(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    const role = roleStore.find(id);
    if (!role) return mockFail<null>("Role not found", "NOT_FOUND");

    if (role.isSystem) {
      return mockFail<null>("System roles cannot be deleted", "FORBIDDEN");
    }

    const holders = userRoleStore.all().filter((a) => a.roleId === id).length;
    if (holders > 0) {
      return mockFail<null>(
        `${holders} ${holders === 1 ? "user still holds" : "users still hold"} this role`,
        "CONFLICT"
      );
    }

    roleStore.remove(id);
    return mockOk(null, "Role deleted");
  }
  return apiRequest<null>(`/api/roles/${id}`, { method: "DELETE" });
}

/** Permissions granted to a role, resolved to the full Permission rows. */
export async function listRolePermissions(
  roleId: string
): Promise<ApiResponse<Permission[]>> {
  if (USE_MOCKS) {
    const grantedIds = new Set(
      MOCK_ROLE_PERMISSIONS.filter((grant) => grant.roleId === roleId).map((g) => g.permissionId)
    );
    return mockOk(MOCK_PERMISSIONS.filter((permission) => grantedIds.has(permission.id)));
  }

  // No endpoint exposes a role's permissions yet — the routes cover Role but
  // not RolePermission. Reported as unavailable rather than as an empty grant,
  // which would read as "this role can do nothing".
  return {
    success: false,
    error: "Role permissions are not available from the API yet.",
    code: "NOT_FOUND",
  };
}

/** Everything a permissions matrix needs to render. */
export function allPermissions(): Permission[] {
  return MOCK_PERMISSIONS;
}

/** Users in the directory, unfiltered — used to size the invite screen's copy. */
export function totalDirectorySize(): number {
  return MOCK_USERS.length;
}

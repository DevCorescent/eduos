// ============================================================================
// MODULE : Mock — RBAC Stores
// PURPOSE: Mutable stores for users, roles and role assignments.
//
//          Separate from mock/stores.ts only to keep the import graph acyclic:
//          services/users.ts needs these, and mock/data/rbac.ts needs
//          mock/data/people.ts, which the setup stores do not.
//
//          UserRole has a composite primary key — @@id([userId, roleId]), no id
//          column — while createMockStore addresses rows by `id`. The two are
//          bridged with a synthetic "userId:roleId" id rather than by writing a
//          second store implementation for one entity. The pair is still the
//          real identity; the string is only how this store indexes it.
// ============================================================================

import type { Role, User, UserRole } from "@/types";
import { MOCK_USERS } from "./data/people";
import { MOCK_ROLES, MOCK_USER_ROLES } from "./data/rbac";
import { createMockStore } from "./store";

/** UserRole with the synthetic id the store needs to address it. */
export type StoredUserRole = UserRole & { id: string };

export const userStore = createMockStore<User>(MOCK_USERS, "usr_new", 3);
export const roleStore = createMockStore<Role>(MOCK_ROLES, "rol", 3);

export const userRoleStore = createMockStore<StoredUserRole>(
  MOCK_USER_ROLES.map((assignment) => ({
    ...assignment,
    id: `${assignment.userId}:${assignment.roleId}`,
  })),
  "urol",
  3
);

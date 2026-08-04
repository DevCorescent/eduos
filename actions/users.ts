"use server";

// ============================================================================
// MODULE : Actions — Users & RBAC
// PURPOSE: Server Actions for the user directory and role grants.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import type { ApiResponse } from "@/types";
import {
  assignRole,
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  unassignRole,
  updateRole,
  updateUser,
  type CreateUserInput,
  type RoleInput,
  type UpdateUserInput,
} from "@/services/users";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { ActionResult } from "./setup";

function withConflictField(result: ApiResponse<unknown>, field: string): ActionResult {
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field };
  }
  return result;
}

function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

function optionalStr(values: FormValues, key: string): string | undefined {
  const value = str(values, key);
  return value === "" ? undefined : value;
}

// --- Users ------------------------------------------------------------------

export async function createUserAction(values: FormValues): Promise<ActionResult> {
  const input: CreateUserInput = {
    email: str(values, "email").toLowerCase(),
    password: str(values, "password"),
    firstName: str(values, "firstName"),
    lastName: str(values, "lastName"),
    phone: optionalStr(values, "phone"),
    isActive: Boolean(values.isActive),
  };

  // Checked here as well as by the schema so the message lands on the password
  // field. The API answers a short password with a bare "Invalid input".
  if (input.password.length < 8) {
    return { success: false, error: "Use at least 8 characters.", field: "password" };
  }

  const created = await createUser(input);
  if (!created.success) return withConflictField(created, "email");

  // Assigning the role in the same step is the point of an invite: a user with
  // no role can sign in and reach nothing, so leaving it to a second screen
  // would make every invite a two-step job that is easy to leave half-done.
  const roleId = optionalStr(values, "roleId");
  if (roleId) {
    const assigned = await assignRole(created.data.id, roleId);
    if (!assigned.success) {
      // The account exists — reporting a flat failure would suggest otherwise
      // and invite a duplicate invite.
      return {
        success: false,
        error: `User created, but the role could not be assigned: ${assigned.error}`,
      };
    }
  }

  return created;
}

export async function updateUserAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: UpdateUserInput = {
    email: str(values, "email").toLowerCase(),
    firstName: str(values, "firstName"),
    lastName: str(values, "lastName"),
    phone: optionalStr(values, "phone"),
    isActive: Boolean(values.isActive),
  };
  return withConflictField(await updateUser(id, input), "email");
}

export async function deleteUserAction(id: string): Promise<ActionResult> {
  return deleteUser(id);
}

export async function assignRoleAction(
  userId: string,
  roleId: string
): Promise<ActionResult> {
  return assignRole(userId, roleId);
}

export async function unassignRoleAction(
  userId: string,
  roleId: string
): Promise<ActionResult> {
  return unassignRole(userId, roleId);
}

// --- Roles ------------------------------------------------------------------

export async function createRoleAction(values: FormValues): Promise<ActionResult> {
  const input: RoleInput = {
    // Normalised to the SCREAMING_SNAKE convention the seeded roles use and
    // that requireRole compares against. A role called "Exam Controller" would
    // never match a guard looking for EXAM_CONTROLLER.
    name: str(values, "name").toUpperCase().replace(/[\s-]+/g, "_"),
    description: optionalStr(values, "description"),
  };
  return withConflictField(await createRole(input), "name");
}

export async function updateRoleAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const input: Partial<RoleInput> = {
    name: str(values, "name").toUpperCase().replace(/[\s-]+/g, "_"),
    description: optionalStr(values, "description"),
  };
  return withConflictField(await updateRole(id, input), "name");
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  return deleteRole(id);
}

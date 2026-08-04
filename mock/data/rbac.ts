// ============================================================================
// MODULE : Mock Data — Roles & Permissions
// PURPOSE: The tenant's roles, the global permission catalogue, and who holds
//          what.
//
//          Permissions are modelled as resource + action + scope, matching
//          @@unique([resource, action, scope]) — not as flat code strings. The
//          catalogue is generated from a resource list crossed with the actions
//          each resource supports, because that is what it is: a matrix, and
//          writing 80-odd rows by hand invites gaps that only show up as a
//          missing checkbox on a permissions screen.
//
//          Permission carries no tenantId — it is global. What is per-tenant is
//          which permissions a Role has been granted.
// ============================================================================

import type { Permission, Role, RolePermission, UserRole } from "@/types";
import { ROLES } from "@/constants/roles";
import { daysAgo } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import { MOCK_EMPLOYEE_USERS, MOCK_FACULTY_USERS, MOCK_STUDENT_USERS } from "./people";

const CREATED = daysAgo(640);

// --- Permission catalogue ---------------------------------------------------

/** Resources the product exposes, grouped so a UI can section them. */
export const PERMISSION_RESOURCES = [
  { resource: "campuses", module: "Setup" },
  { resource: "schools", module: "Setup" },
  { resource: "departments", module: "Setup" },
  { resource: "programmes", module: "Setup" },
  { resource: "academic-years", module: "Calendar" },
  { resource: "batches", module: "Calendar" },
  { resource: "sections", module: "Calendar" },
  { resource: "students", module: "People" },
  { resource: "faculty", module: "People" },
  { resource: "employees", module: "People" },
  { resource: "users", module: "Administration" },
  { resource: "roles", module: "Administration" },
  { resource: "courses", module: "Academics" },
  { resource: "timetable", module: "Academics" },
  { resource: "attendance", module: "Academics" },
  { resource: "examinations", module: "Academics" },
  { resource: "fees", module: "Finance" },
  { resource: "payments", module: "Finance" },
  { resource: "certificates", module: "Certificates" },
] as const;

const ACTIONS = ["read", "create", "update", "delete"] as const;

export const MOCK_PERMISSIONS: Permission[] = PERMISSION_RESOURCES.flatMap(
  ({ resource }, resourceIndex) =>
    ACTIONS.map((action, actionIndex) => ({
      id: mockId("perm", resourceIndex * 10 + actionIndex + 1, 4),
      resource,
      action,
      // "*" is the schema default: unrestricted within the tenant. A narrowed
      // scope belongs on the UserRole assignment, not on the permission itself.
      scope: "*",
    }))
);

export const MODULE_BY_RESOURCE = new Map(
  PERMISSION_RESOURCES.map(({ resource, module }) => [resource as string, module as string])
);

// --- Roles ------------------------------------------------------------------

interface RoleSeed {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Resources this role may act on. "*" means every resource. */
  resources: readonly string[] | "*";
  /** Actions permitted on those resources. */
  actions: readonly (typeof ACTIONS)[number][];
}

const ROLE_SEEDS: RoleSeed[] = [
  {
    id: "rol_001",
    name: ROLES.UNIVERSITY_ADMIN,
    description: "Full access to every module in this university.",
    isSystem: true,
    resources: "*",
    actions: ["read", "create", "update", "delete"],
  },
  {
    id: "rol_002",
    name: ROLES.CAMPUS_ADMIN,
    description: "Manages one campus — its structure, people and academics.",
    isSystem: true,
    resources: [
      "campuses", "schools", "departments", "programmes",
      "academic-years", "batches", "sections",
      "students", "faculty", "employees", "users",
    ],
    actions: ["read", "create", "update"],
  },
  {
    id: "rol_003",
    name: ROLES.HOD,
    description: "Heads a department: its programmes, courses and faculty.",
    isSystem: true,
    resources: ["programmes", "courses", "faculty", "students", "timetable", "attendance"],
    actions: ["read", "create", "update"],
  },
  {
    id: "rol_004",
    name: ROLES.FACULTY,
    description: "Teaches: marks attendance, sets and grades assessments.",
    isSystem: true,
    resources: ["courses", "timetable", "attendance", "examinations", "students"],
    actions: ["read", "create", "update"],
  },
  {
    id: "rol_005",
    name: ROLES.STUDENT,
    description: "Reads their own record, results, fees and certificates.",
    isSystem: true,
    resources: ["attendance", "examinations", "fees", "certificates", "courses"],
    actions: ["read"],
  },
  {
    id: "rol_006",
    name: "EXAM_CONTROLLER",
    description: "Runs examinations end to end, including result publication.",
    isSystem: false,
    resources: ["examinations", "students", "courses"],
    actions: ["read", "create", "update", "delete"],
  },
  {
    id: "rol_007",
    name: "FINANCE_OFFICER",
    description: "Fee structures, demands, collections and refunds.",
    isSystem: false,
    resources: ["fees", "payments", "students"],
    actions: ["read", "create", "update"],
  },
  {
    id: "rol_008",
    name: "ADMISSION_OFFICER",
    description: "Processes applicants through to enrolment.",
    isSystem: false,
    resources: ["students", "programmes", "batches"],
    actions: ["read", "create", "update"],
  },
  {
    id: "rol_009",
    name: "LIBRARIAN",
    description: "Library catalogue and circulation. Read-only elsewhere.",
    isSystem: false,
    resources: ["students", "faculty"],
    actions: ["read"],
  },
];

export const MOCK_ROLES: Role[] = ROLE_SEEDS.map((seed) => ({
  id: seed.id,
  tenantId: MOCK_TENANT_ID,
  name: seed.name,
  description: seed.description,
  isSystem: seed.isSystem,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

// --- Role → permission grants -----------------------------------------------

export const MOCK_ROLE_PERMISSIONS: RolePermission[] = ROLE_SEEDS.flatMap((seed) => {
  const permitted = MOCK_PERMISSIONS.filter((permission) => {
    const resourceMatches =
      seed.resources === "*" || seed.resources.includes(permission.resource);
    return resourceMatches && seed.actions.includes(permission.action as typeof ACTIONS[number]);
  });

  return permitted.map((permission) => ({
    roleId: seed.id,
    permissionId: permission.id,
    grantedAt: CREATED,
  }));
});

/** Permission count per role — what the roles list shows without a join per row. */
export const PERMISSION_COUNT_BY_ROLE = new Map<string, number>();
for (const grant of MOCK_ROLE_PERMISSIONS) {
  PERMISSION_COUNT_BY_ROLE.set(
    grant.roleId,
    (PERMISSION_COUNT_BY_ROLE.get(grant.roleId) ?? 0) + 1
  );
}

// --- User → role assignments ------------------------------------------------

const ROLE_ID_BY_NAME = new Map(MOCK_ROLES.map((role) => [role.name, role.id]));

/**
 * Who holds which role.
 *
 * Derived from how each user was generated rather than assigned at random:
 * faculty users get FACULTY, students get STUDENT, and the staff pool is spread
 * across the administrative roles. Random assignment would put a student in the
 * finance role, which makes every screen built on this data nonsense.
 */
export const MOCK_USER_ROLES: UserRole[] = [
  ...MOCK_FACULTY_USERS.map((user) => ({
    userId: user.id,
    roleId: ROLE_ID_BY_NAME.get(ROLES.FACULTY)!,
    scope: null,
    grantedAt: user.createdAt,
    grantedBy: null,
  })),

  ...MOCK_STUDENT_USERS.map((user) => ({
    userId: user.id,
    roleId: ROLE_ID_BY_NAME.get(ROLES.STUDENT)!,
    scope: null,
    grantedAt: user.createdAt,
    grantedBy: null,
  })),

  // Staff cycle through the administrative roles, so every role has holders and
  // the "users in this role" count is never zero for a role that should have some.
  ...MOCK_EMPLOYEE_USERS.map((user, i) => {
    const staffRoles = [
      ROLES.UNIVERSITY_ADMIN,
      ROLES.CAMPUS_ADMIN,
      ROLES.HOD,
      "EXAM_CONTROLLER",
      "FINANCE_OFFICER",
      "ADMISSION_OFFICER",
      "LIBRARIAN",
    ];
    return {
      userId: user.id,
      roleId: ROLE_ID_BY_NAME.get(staffRoles[i % staffRoles.length])!,
      scope: null,
      grantedAt: user.createdAt,
      grantedBy: null,
    };
  }),
];

/** Roles held, keyed by user — avoids a linear scan per row on the user list. */
export const ROLE_IDS_BY_USER = new Map<string, string[]>();
for (const assignment of MOCK_USER_ROLES) {
  const existing = ROLE_IDS_BY_USER.get(assignment.userId);
  if (existing) existing.push(assignment.roleId);
  else ROLE_IDS_BY_USER.set(assignment.userId, [assignment.roleId]);
}

export const USER_COUNT_BY_ROLE = new Map<string, number>();
for (const assignment of MOCK_USER_ROLES) {
  USER_COUNT_BY_ROLE.set(
    assignment.roleId,
    (USER_COUNT_BY_ROLE.get(assignment.roleId) ?? 0) + 1
  );
}

export const ROLE_BY_ID = new Map(MOCK_ROLES.map((role) => [role.id, role]));
export const PERMISSION_BY_ID = new Map(MOCK_PERMISSIONS.map((p) => [p.id, p]));

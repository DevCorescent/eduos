// ============================================================================
// MODULE : Mock — Authentication
// PURPOSE: Stands in for the auth endpoints while the frontend is built without
//          a database.
//
//          Two of the four flows have no backend at all: POST
//          /api/auth/forgot-password and /api/auth/reset-password are named by
//          the frontend plan but do not exist under app/api. Login and logout
//          do exist, but need a live Postgres with a seeded tenant and user.
//
//          The demo accounts below are what make role-based routing reviewable:
//          signing in as student@verify.edu really does land on the student
//          portal with a student's navigation, because the session cookie this
//          writes carries exactly those roles.
// ============================================================================

import type { ApiResponse, AuthUser } from "@/types";
import { ROLES } from "@/constants/roles";
import { mockFail, mockOk } from "./utils";

/**
 * Signing in with this password fails, whatever the account.
 *
 * A mock that accepts everything leaves the error path — the Alert, the
 * re-enabled button, the cleared loading state — permanently untested. This
 * gives it a trigger.
 */
export const MOCK_WRONG_PASSWORD = "wrong";

/** The institution code every demo account belongs to. */
export const MOCK_TENANT_SLUG = "verify";

interface MockAccount {
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  /** Shown on the login screen's demo-account hint. */
  description: string;
}

/**
 * One account per portal, so each can be opened without editing code.
 *
 * Roles are single-valued on purpose. A user holding every role would always
 * resolve to the platform portal through homeRouteForRoles and the other three
 * would be unreachable by signing in.
 */
export const MOCK_ACCOUNTS: MockAccount[] = [
  {
    email: "owner@platform.edu",
    firstName: "Platform",
    lastName: "Owner",
    roles: [ROLES.SUPER_ADMIN],
    description: "Platform Admin — tenants, subscriptions",
  },
  {
    email: "admin@verify.edu",
    firstName: "Ananya",
    lastName: "Rao",
    roles: [ROLES.UNIVERSITY_ADMIN],
    description: "University Admin — full university console",
  },
  {
    email: "hod@verify.edu",
    firstName: "Vikram",
    lastName: "Nair",
    roles: [ROLES.HOD],
    description: "Head of Department — no finance or user admin",
  },
  {
    email: "faculty@verify.edu",
    firstName: "Meera",
    lastName: "Iyer",
    roles: [ROLES.FACULTY],
    description: "Faculty — teaching schedule, attendance, grading",
  },
  {
    email: "student@verify.edu",
    firstName: "Rahul",
    lastName: "Verma",
    roles: [ROLES.STUDENT],
    description: "Student — attendance, results, fees",
  },
];

/**
 * Resolve an email to a demo account.
 *
 * An unrecognised address is admitted as a university admin rather than
 * rejected: the point of the mock is to let anyone in to look around, and
 * failing on a typo would only obstruct that. Wrong *credentials* are still
 * reachable deliberately, through MOCK_WRONG_PASSWORD.
 */
function resolveAccount(email: string): MockAccount {
  const normalised = email.trim().toLowerCase();
  const known = MOCK_ACCOUNTS.find((account) => account.email === normalised);
  if (known) return known;

  const localPart = normalised.split("@")[0] ?? "user";
  return {
    email: normalised,
    firstName: localPart.charAt(0).toUpperCase() + localPart.slice(1),
    lastName: "User",
    roles: [ROLES.UNIVERSITY_ADMIN],
    description: "Unrecognised account — admitted as University Admin",
  };
}

export async function mockLogin(input: {
  tenantSlug: string;
  email: string;
  password: string;
}): Promise<ApiResponse<{ user: AuthUser }>> {
  if (input.password === MOCK_WRONG_PASSWORD) {
    return mockFail("Invalid credentials", "AUTH_ERROR");
  }

  const account = resolveAccount(input.email);

  return mockOk({
    user: {
      id: `mock-${account.email}`,
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
      roles: account.roles,
    },
  });
}

export async function mockLogout(): Promise<ApiResponse<null>> {
  return mockOk(null, "Logged out");
}

/**
 * Always reports success, and never says whether the address is registered.
 *
 * That is the real product requirement, not a shortcut: an endpoint that
 * answers "no such user" for an unknown address lets anyone enumerate who holds
 * an account. The live endpoint must behave the same way when it is built, so
 * the mock does not teach the UI a shape it will later have to unlearn.
 */
export async function mockForgotPassword(): Promise<ApiResponse<{ sent: true }>> {
  return mockOk({ sent: true as const });
}

/** The code the mock accepts. Any other value exercises the failure path. */
export const MOCK_OTP = "123456";

export async function mockResetPassword(input: {
  otp: string;
}): Promise<ApiResponse<null>> {
  if (input.otp.trim() !== MOCK_OTP) {
    return mockFail("That code is invalid or has expired.", "VALIDATION_ERROR");
  }
  return mockOk(null, "Password updated");
}

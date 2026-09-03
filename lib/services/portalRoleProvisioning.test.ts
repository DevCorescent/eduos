// ============================================================================
// TESTS: a created faculty member or student can actually sign in.
//
// THE DEFECT
//   The Faculty and Student forms collect an email and a "Temporary password",
//   and tell the person they will change it after signing in. Creation wrote a
//   User and the domain record, and stopped. POST /api/users accepts no role
//   field and grants none, so the account signed in holding nothing:
//
//     login  -> roles = user.userRoles.map(...)   -> []
//     client -> homeRouteForRoles([])             -> NO_PORTAL_ROUTE
//     page   -> /no-access  "Your account holds no role that opens a portal."
//
//   Reported for Faculty and, identically, for Student.
//
// WHY THESE READ SOURCE
//   These services call this application's own HTTP API, and the suite has no
//   server and no database — see package.json. What is asserted is the thing
//   that was missing: that the grant happens at all, that the role is a
//   constant rather than client input, and that it is ordered so a failure
//   cannot strand an account in a worse state than the bug being fixed.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, homeRouteForRoles, NO_PORTAL_ROUTE } from "../../constants/roles";

const faculty = readFileSync(join(process.cwd(), "services/faculty.ts"), "utf8");
const students = readFileSync(join(process.cwd(), "services/students.ts"), "utf8");
const users = readFileSync(join(process.cwd(), "services/users.ts"), "utf8");
const usersRoute = readFileSync(join(process.cwd(), "app/api/users/route.ts"), "utf8");

/** The body of one exported function, up to the next top-level export. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("A. Faculty creation grants the portal role", () => {
  const body = bodyOf(faculty, "addFaculty");

  it("still creates the account and the faculty record", () => {
    // The fix must not have replaced the existing writes.
    assert.match(body, /apiRequest<\{ id: string \}>\("\/api\/users"/);
    assert.match(body, /apiRequest<FacultyMember>\("\/api\/faculty"/);
    assert.match(body, /userId: account\.data\.id/);
  });

  it("resolves the tenant's FACULTY role and grants it to the new account", () => {
    assert.match(body, /findTenantRoleByName\(ROLES\.FACULTY\)/);
    assert.match(body, /assignRole\(account\.data\.id, role\.data\.id\)/);
  });

  it("stops if the role is missing or the grant fails", () => {
    // Reporting success while the account cannot open a portal is the bug.
    assert.match(body, /if \(!role\.success\) return role;/);
    assert.match(body, /if \(!granted\.success\) return granted;/);
  });
});

describe("B. Student enrolment grants the portal role", () => {
  const body = bodyOf(students, "enrolStudent");

  it("still creates the account and the student record", () => {
    assert.match(body, /apiRequest<\{ id: string \}>\("\/api\/users"/);
    assert.match(body, /apiRequest<Student>\("\/api\/students"/);
    assert.match(body, /userId: account\.data\.id/);
  });

  it("resolves the tenant's STUDENT role and grants it to the new account", () => {
    assert.match(body, /findTenantRoleByName\(ROLES\.STUDENT\)/);
    assert.match(body, /assignRole\(account\.data\.id, role\.data\.id\)/);
  });

  it("stops if the role is missing or the grant fails", () => {
    assert.match(body, /if \(!role\.success\) return role;/);
    assert.match(body, /if \(!granted\.success\) return granted;/);
  });
});

describe("C. Portal routing — what the granted role buys", () => {
  it("FACULTY opens the faculty portal", () => {
    assert.equal(homeRouteForRoles([ROLES.FACULTY]), "/faculty/dashboard");
  });

  it("STUDENT opens the student portal", () => {
    assert.equal(homeRouteForRoles([ROLES.STUDENT]), "/student/dashboard");
  });

  it("no roles opens nothing — the exact screen the tester saw", () => {
    assert.equal(homeRouteForRoles([]), NO_PORTAL_ROUTE);
    assert.equal(NO_PORTAL_ROUTE, "/no-access");
  });

  it("an unrecognised role is still no portal", () => {
    // A custom tenant role does not accidentally open a portal.
    assert.equal(homeRouteForRoles(["LIBRARIAN"]), NO_PORTAL_ROUTE);
  });
});

describe("D. Security — the role is chosen by the code, never the caller", () => {
  it("neither creation input carries a role of any kind", () => {
    // If a role could ride in on the form body, creating a lecturer would be a
    // way to mint a UNIVERSITY_ADMIN.
    for (const [name, source] of [
      ["AddFacultyInput", faculty],
      ["EnrolStudentInput", students],
    ] as const) {
      const start = source.indexOf(`export interface ${name}`);
      const shape = source.slice(start, source.indexOf("}", start));

      assert.ok(
        !/role|roleId|roleName/i.test(shape),
        `${name} must not accept a role from the client`
      );
    }
  });

  it("the granted role is a constant from constants/roles.ts", () => {
    assert.match(faculty, /import \{ ROLES \} from "@\/constants\/roles"/);
    assert.match(students, /import \{ ROLES \} from "@\/constants\/roles"/);
  });

  it("the role lookup is by NAME against that tenant's own roles", () => {
    // findTenantRoleByName reads GET /api/roles, which applies
    // requireRole("UNIVERSITY_ADMIN") and requireTenant() — so it cannot return
    // a role belonging to another university, and this helper cannot widen it.
    const helper = bodyOf(users, "findTenantRoleByName");

    assert.match(helper, /listRoles\(\{ page: 1, limit: MAX_LIST_LIMIT \}\)/);
    assert.match(helper, /candidate\.name === name/);
  });

  it("a missing role is reported, never created", () => {
    // Minting a role here would let this function invent authority.
    const helper = bodyOf(users, "findTenantRoleByName");

    assert.match(helper, /code: "NOT_FOUND"/);
    assert.ok(!/method: "POST"/.test(helper), "the resolver must not create a role");
  });
});

describe("E. Regression — nothing else changed", () => {
  it("POST /api/users still grants no role", () => {
    // The fix deliberately did NOT add a role field to user creation: that
    // endpoint is used by other flows, and a role accepted there would be a
    // client-supplied grant.
    const userValidation = readFileSync(
      join(process.cwd(), "lib/validations/user.ts"),
      "utf8"
    );
    const shape = userValidation.slice(
      userValidation.indexOf("export const createUserSchema"),
      userValidation.indexOf("export type CreateUserInput")
    );

    assert.ok(!/role/i.test(shape), "createUserSchema must not accept a role");

    const post = usersRoute.slice(usersRoute.indexOf("export async function POST"));
    assert.ok(!/roleId|userRoles/.test(post), "the create route must not grant a role");
  });

  it("the manual Users and Roles path is untouched", () => {
    assert.match(users, /export async function assignRole\(/);
    assert.match(users, /export async function unassignRole\(/);
    assert.match(users, /\/api\/users\/\$\{userId\}\/roles/);
  });

  it("the grant runs AFTER the domain record, adding no new failure mode", () => {
    // Ordering is load-bearing. employeeId and enrollmentNo are unique per
    // tenant, so the domain write can fail on an ordinary duplicate. Granting
    // first would leave an account holding the role with no faculty/student
    // record — and every portal page resolves that record before it renders.
    // Granting last leaves an account with no role, which is exactly the state
    // this fix repairs and which an administrator clears in one step.
    for (const [source, fn] of [
      [faculty, "addFaculty"],
      [students, "enrolStudent"],
    ] as const) {
      const body = bodyOf(source, fn);
      assert.ok(
        body.indexOf("findTenantRoleByName") > body.indexOf("userId: account.data.id"),
        `${fn} must grant the role after creating the domain record`
      );
    }
  });
});

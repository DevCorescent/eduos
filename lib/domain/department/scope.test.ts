// ============================================================================
// TESTS: Department scope decision.
//
// This is the security-relevant branch of DEPARTMENT_HOD authorization: who is
// narrowed to one department, who is not, and what happens to a head with no
// department. It runs the real function — no mocks, no source-text matching —
// because the decision was deliberately separated from its database read so
// that it could be.
//
// The rule most worth pinning is the last one. A head with no department must
// be REFUSED. If "no department" is ever read as "every department", the
// nullable column stops being a modelling convenience and becomes a privilege
// escalation, and every other test in this file passes while the mechanism does
// nothing.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideDepartmentScope } from "./scope";

describe("decideDepartmentScope — who is narrowed", () => {
  it("narrows a DEPARTMENT_HOD to the department they head", () => {
    const decision = decideDepartmentScope(["DEPARTMENT_HOD"], "dept_cse");

    assert.deepEqual(decision, {
      allowed: true,
      scope: { restricted: true, departmentId: "dept_cse" },
    });
  });

  it("does NOT narrow a UNIVERSITY_ADMIN", () => {
    const decision = decideDepartmentScope(["UNIVERSITY_ADMIN"], null);

    assert.deepEqual(decision, { allowed: true, scope: { restricted: false } });
  });

  it("does NOT narrow a CONTROLLER_OF_EXAMINATION", () => {
    // The COE's area is the examination surface across the whole university.
    // A department restriction belongs to a head; applying it here would
    // silently shrink an area the product decision grants the COE in full.
    const decision = decideDepartmentScope(["CONTROLLER_OF_EXAMINATION"], null);

    assert.deepEqual(decision, { allowed: true, scope: { restricted: false } });
  });

  it("does NOT narrow FACULTY or STUDENT", () => {
    // Those roles are bounded by their own guards — requireFacultyTimetableAccess,
    // requireStudentProfileAccess and the rest. This function must not become a
    // second, quieter opinion about them.
    for (const role of ["FACULTY", "STUDENT", "PARENT"]) {
      assert.deepEqual(
        decideDepartmentScope([role], null),
        { allowed: true, scope: { restricted: false } },
        `${role} must not be department-narrowed here`
      );
    }
  });
});

describe("decideDepartmentScope — both spellings of the head role", () => {
  // HOD and DEPARTMENT_HOD are the same office; constants/roles records the
  // duplication as debt and UNIVERSITY_ROLES admits both. Recognising only one
  // FAILS OPEN — the other spelling passes the role guard, matches nothing
  // here, and receives the whole university.
  it("narrows a caller holding the older HOD spelling", () => {
    const decision = decideDepartmentScope(["HOD"], "dept_cse");

    assert.deepEqual(decision, {
      allowed: true,
      scope: { restricted: true, departmentId: "dept_cse" },
    });
  });

  it("REFUSES an unassigned head under the older spelling too", () => {
    assert.equal(decideDepartmentScope(["HOD"], null).allowed, false);
  });

  it("narrows a caller holding both spellings exactly once", () => {
    assert.deepEqual(decideDepartmentScope(["HOD", "DEPARTMENT_HOD"], "dept_cse"), {
      allowed: true,
      scope: { restricted: true, departmentId: "dept_cse" },
    });
  });

  it("still does not narrow an administrator who also holds HOD", () => {
    assert.deepEqual(decideDepartmentScope(["UNIVERSITY_ADMIN", "HOD"], "dept_cse"), {
      allowed: true,
      scope: { restricted: false },
    });
  });
});

describe("decideDepartmentScope — precedence", () => {
  it("does NOT narrow a user who holds BOTH admin and head", () => {
    // The wider grant wins. Narrowing would withdraw access the university
    // deliberately gave by assigning the administrator role.
    const decision = decideDepartmentScope(
      ["UNIVERSITY_ADMIN", "DEPARTMENT_HOD"],
      "dept_cse"
    );

    assert.deepEqual(decision, { allowed: true, scope: { restricted: false } });
  });

  it("applies the same precedence whichever order the roles arrive in", () => {
    const decision = decideDepartmentScope(
      ["DEPARTMENT_HOD", "UNIVERSITY_ADMIN"],
      "dept_cse"
    );

    assert.deepEqual(decision, { allowed: true, scope: { restricted: false } });
  });

  it("narrows a head who also holds COE, because neither grant is university-wide over students", () => {
    // COE does not confer the student or faculty registry, so a head who is
    // also COE is still a head for the purposes of those collections.
    const decision = decideDepartmentScope(
      ["DEPARTMENT_HOD", "CONTROLLER_OF_EXAMINATION"],
      "dept_cse"
    );

    assert.deepEqual(decision, {
      allowed: true,
      scope: { restricted: true, departmentId: "dept_cse" },
    });
  });
});

describe("decideDepartmentScope — fails closed", () => {
  it("REFUSES a DEPARTMENT_HOD with no department assigned", () => {
    const decision = decideDepartmentScope(["DEPARTMENT_HOD"], null);

    assert.equal(
      decision.allowed,
      false,
      "an unassigned head must be refused. If this ever returns restricted:false " +
        "the head reads the entire university and every other test here still passes."
    );
    assert.equal(!decision.allowed && decision.reason, "NO_DEPARTMENT_ASSIGNED");
  });

  it("REFUSES an unassigned head even when an empty-string id is supplied", () => {
    // "" is falsy and must be treated as absent rather than matched literally,
    // or a department id of "" would match nothing while reporting success.
    const decision = decideDepartmentScope(["DEPARTMENT_HOD"], "");

    assert.equal(decision.allowed, false);
  });

  it("refuses a head with no roles beyond the head role and no department", () => {
    assert.equal(decideDepartmentScope(["DEPARTMENT_HOD"], null).allowed, false);
  });
});

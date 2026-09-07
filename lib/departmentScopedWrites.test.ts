// ============================================================================
// TESTS: department-scoped faculty and course writes — tester issues #49, #50.
//
// THE DEFECT
//   "When logged in as HOD, both Create and Edit result in Forbidden."
//
//   They did: POST /api/faculty, PATCH /api/faculty/[id], POST /api/courses and
//   PATCH /api/courses/[id] were each requireRole("UNIVERSITY_ADMIN"), so a head
//   of department could READ their department's staff and syllabus and change
//   neither. The product decision has since confirmed that a head SHOULD do
//   both.
//
// THE ROLE LIST IS THE SMALLER HALF OF THE FIX
//   A role array can only say yes or no. Admitting a head there and stopping
//   would have granted TENANT-WIDE writes — a head editing another
//   department's professor, or retitling a course they do not own — which is a
//   worse bug than the one being fixed. resolveDepartmentScope supplies the
//   other half, exactly as the matching listings already use it.
//
//   So these tests come in pairs throughout: the grant, and the bound on it.
//
// departmentForCreate and canWriteDepartmentRow are pure and are called for
// real. The routes reach a database and this suite has none (see package.json),
// so their wiring is pinned as source contracts and the behaviours that need
// rows are covered by live verification against the running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canWriteDepartmentRow, departmentForCreate } from "./auth/departmentWrite";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with comments stripped, for "this is gone" assertions. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** One handler's body, so an assertion cannot be satisfied by a sibling. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const registry = read("lib/constants/departmentAcademics.ts");
const facultyList = read("app/api/faculty/route.ts");
const facultyDetail = read("app/api/faculty/[id]/route.ts");
const courseList = read("app/api/courses/route.ts");
const courseDetail = read("app/api/courses/[id]/route.ts");

const HEAD = { restricted: true, departmentId: "dept_own" } as const;
const OTHER = "dept_other";
const ADMIN = { restricted: false } as const;

// ============================================================================
// THE RULE ITSELF
// ============================================================================

describe("departmentForCreate — which department a new row belongs to", () => {
  it("an administrator keeps whatever the body asked for", () => {
    assert.deepEqual(departmentForCreate(ADMIN, OTHER), {
      allowed: true,
      departmentId: OTHER,
    });
  });

  it("an administrator may create an unowned row", () => {
    assert.deepEqual(departmentForCreate(ADMIN, undefined), {
      allowed: true,
      departmentId: null,
    });
  });

  it("a head creating without naming a department gets their OWN", () => {
    // The ordinary case, and the one that makes the feature work at all.
    assert.deepEqual(departmentForCreate(HEAD, undefined), {
      allowed: true,
      departmentId: "dept_own",
    });
  });

  it("a head naming their own department is allowed", () => {
    assert.deepEqual(departmentForCreate(HEAD, "dept_own"), {
      allowed: true,
      departmentId: "dept_own",
    });
  });

  it("a head naming ANOTHER department is REFUSED, not rewritten", () => {
    // Refused rather than silently corrected: both are safe, but substituting
    // would report success for a request that was not honoured.
    const decision = departmentForCreate(HEAD, OTHER);
    assert.equal(decision.allowed, false);
  });

  it("a head cannot create an unowned row by passing null", () => {
    // An unowned course is invisible to every head, so authoring one would mean
    // writing a record the author could not afterwards read.
    assert.equal(departmentForCreate(HEAD, null).allowed, true);
    assert.deepEqual(departmentForCreate(HEAD, null), {
      allowed: true,
      departmentId: "dept_own",
    });
  });
});

describe("canWriteDepartmentRow — whether a row is this caller's to change", () => {
  it("an administrator may change anything, and move it anywhere", () => {
    assert.equal(canWriteDepartmentRow(ADMIN, OTHER, "dept_own").allowed, true);
    assert.equal(canWriteDepartmentRow(ADMIN, null, undefined).allowed, true);
  });

  it("a head may edit a row already in their department", () => {
    assert.deepEqual(canWriteDepartmentRow(HEAD, "dept_own", undefined), {
      allowed: true,
      departmentId: "dept_own",
    });
  });

  it("a head may NOT edit another department's row", () => {
    assert.equal(canWriteDepartmentRow(HEAD, OTHER, undefined).allowed, false);
  });

  it("a head may NOT edit an UNOWNED row", () => {
    // "Nobody has claimed it" must not read as "anybody may" — the same reading
    // the listings apply by excluding NULL.
    assert.equal(canWriteDepartmentRow(HEAD, null, undefined).allowed, false);
  });

  it("a head may NOT move their row OUT of their department", () => {
    // Otherwise a head could hand their staff or syllabus away.
    assert.equal(canWriteDepartmentRow(HEAD, "dept_own", OTHER).allowed, false);
  });

  it("a head may NOT claim another department's row by re-stamping it", () => {
    // The escalation the second check exists for: without it, setting
    // departmentId to their own would make any row theirs.
    assert.equal(canWriteDepartmentRow(HEAD, OTHER, "dept_own").allowed, false);
  });

  it("a head may NOT orphan their own row", () => {
    assert.equal(canWriteDepartmentRow(HEAD, "dept_own", null).allowed, false);
  });

  it("both halves are required — neither alone is sufficient", () => {
    // Stated explicitly because dropping either check is the plausible mistake.
    assert.equal(canWriteDepartmentRow(HEAD, OTHER, OTHER).allowed, false);
    assert.equal(canWriteDepartmentRow(HEAD, "dept_own", "dept_own").allowed, true);
  });
});

// ============================================================================
// THE ROLE SETS
// ============================================================================

describe("#49/#50 — the write role sets", () => {
  for (const name of ["FACULTY_WRITE_ROLES", "COURSE_WRITE_ROLES"]) {
    it(`${name} admits the head and the administrator`, () => {
      const start = registry.indexOf(`export const ${name}`);
      assert.ok(start >= 0, `${name} not found`);

      const block = registry.slice(start, registry.indexOf("]", start));
      assert.match(block, /ROLES\.UNIVERSITY_ADMIN/);
      assert.match(block, /ROLES\.DEPARTMENT_HOD/);
    });

    it(`${name} admits nobody else`, () => {
      const start = registry.indexOf(`export const ${name}`);
      const block = registry.slice(start, registry.indexOf("]", start));
      const roles = [...block.matchAll(/ROLES\.(\w+)/g)].map((m) => m[1]);

      assert.deepEqual(roles.sort(), ["DEPARTMENT_HOD", "UNIVERSITY_ADMIN"]);
    });
  }

  it("they are SEPARATE from the read sets, because the COE reads courses", () => {
    // Reusing COURSE_READ_ROLES for writes would have handed the examination
    // office the catalogue to edit.
    const start = registry.indexOf("export const COURSE_READ_ROLES");
    const block = registry.slice(start, registry.indexOf("]", start));

    assert.match(block, /CONTROLLER_OF_EXAMINATION/);
  });
});

// ============================================================================
// #49 — FACULTY
// ============================================================================

describe("#49 — faculty create", () => {
  const post = handler(facultyList, "POST");

  it("admits the write roles — THE REGRESSION", () => {
    assert.match(post, /requireRole\(\.\.\.FACULTY_WRITE_ROLES\)/);
    assert.ok(
      !/requireRole\("UNIVERSITY_ADMIN"\)/.test(code(post)),
      "the admin-only guard is the defect and must not remain"
    );
  });

  it("resolves the department from the SESSION, not the body", () => {
    assert.match(post, /resolveDepartmentScope\(guard\.session\)/);
    assert.match(post, /departmentForCreate\(scope\.scope, input\.departmentId\)/);
  });

  it("refuses a head naming another department with 403", () => {
    assert.match(post, /fail\(departmentDecision\.reason, "FORBIDDEN"\), \{ status: 403 \}/);
  });

  it("writes the DECIDED department, after the spread so a body cannot override", () => {
    assert.match(
      code(post),
      /\.\.\.input,[\s\S]{0,200}departmentId: departmentDecision\.departmentId,/
    );
  });

  it("the tenant still comes from the guard", () => {
    assert.match(post, /tenantId: tenant\.id/);
    assert.ok(!/tenantId: (input|body|parsed)/.test(post));
  });

  it("validation and the duplicate checks are untouched", () => {
    assert.match(post, /createFacultySchema\.safeParse/);
    assert.match(post, /User is already linked to a faculty member/);
    assert.match(post, /Employee id already in use/);
  });

  it("the scope check runs AFTER the reference checks", () => {
    // So a head naming a department that does not exist gets the 404 an
    // administrator would, rather than a 403 that would say nothing about it.
    assert.ok(
      code(post).indexOf("Department not found") < code(post).indexOf("departmentForCreate")
    );
  });

  it("the audit trail is preserved", () => {
    assert.match(post, /recordAudit|AUDIT_ACTIONS/);
  });
});

describe("#49 — faculty edit", () => {
  const patch = handler(facultyDetail, "PATCH");

  it("admits the write roles — THE REGRESSION", () => {
    assert.match(patch, /requireRole\(\.\.\.FACULTY_WRITE_ROLES\)/);
    assert.ok(!/requireRole\("UNIVERSITY_ADMIN"\)/.test(code(patch)));
  });

  it("checks the row is theirs AND stays theirs", () => {
    assert.match(patch, /resolveDepartmentScope\(guard\.session\)/);
    assert.match(
      patch,
      /canWriteDepartmentRow\(\s*scope\.scope,\s*existing\.departmentId,\s*input\.departmentId\s*\)/
    );
  });

  it("refuses with 403", () => {
    assert.match(patch, /fail\(departmentDecision\.reason, "FORBIDDEN"\), \{ status: 403 \}/);
  });

  it("the row is loaded tenant-scoped BEFORE the scope check", () => {
    // So a cross-tenant id is a 404 and never reaches the department decision.
    assert.ok(
      code(patch).indexOf("tenantId: tenant.id") < code(patch).indexOf("canWriteDepartmentRow")
    );
    assert.match(patch, /fail\("Faculty member not found", "NOT_FOUND"\), \{ status: 404 \}/);
  });

  it("validation is untouched", () => {
    assert.match(patch, /updateFacultySchema\.safeParse/);
  });

  it("the write is still scoped by tenant", () => {
    assert.match(patch, /where: \{ id: facultyId, tenantId: tenant\.id \}/);
  });
});

// ============================================================================
// #50 — COURSES
// ============================================================================

describe("#50 — course create", () => {
  const post = handler(courseList, "POST");

  it("admits the write roles — THE REGRESSION", () => {
    assert.match(post, /requireRole\(\.\.\.COURSE_WRITE_ROLES\)/);
    assert.ok(!/requireRole\("UNIVERSITY_ADMIN"\)/.test(code(post)));
  });

  it("resolves the department from the session", () => {
    assert.match(post, /resolveDepartmentScope\(guard\.session\)/);
    assert.match(post, /departmentForCreate\(scope\.scope, input\.departmentId\)/);
  });

  it("writes the decided department after the spread", () => {
    assert.match(
      code(post),
      /\.\.\.input,[\s\S]{0,200}departmentId: departmentDecision\.departmentId,/
    );
  });

  it("refuses with 403", () => {
    assert.match(post, /fail\(departmentDecision\.reason, "FORBIDDEN"\), \{ status: 403 \}/);
  });

  it("validation is untouched", () => {
    assert.match(post, /createCourseSchema\.safeParse/);
  });

  it("the duplicate-code conflict is preserved", () => {
    assert.match(post, /Course code already in use/);
  });
});

describe("#50 — course edit", () => {
  const patch = handler(courseDetail, "PATCH");

  it("admits the write roles — THE REGRESSION", () => {
    assert.match(patch, /requireRole\(\.\.\.COURSE_WRITE_ROLES\)/);
    assert.ok(!/requireRole\("UNIVERSITY_ADMIN"\)/.test(code(patch)));
  });

  it("checks the course is theirs AND stays theirs", () => {
    assert.match(
      patch,
      /canWriteDepartmentRow\(\s*scope\.scope,\s*existing\.departmentId,\s*input\.departmentId\s*\)/
    );
  });

  it("the course is loaded tenant-scoped BEFORE the scope check", () => {
    assert.ok(
      code(patch).indexOf("tenantId: tenant.id") < code(patch).indexOf("canWriteDepartmentRow")
    );
    assert.match(patch, /fail\("Course not found", "NOT_FOUND"\), \{ status: 404 \}/);
  });

  it("retiring a course is an edit, so a head can do it", () => {
    // isActive is part of the update schema, and this handler is now open to a
    // head — which is what makes "retire it instead" reachable for them.
    assert.match(read("lib/validations/course.ts"), /isActive/);
  });

  it("validation is untouched", () => {
    assert.match(patch, /updateCourseSchema\.safeParse/);
  });

  it("DELETE was NOT widened", () => {
    // Create and edit were confirmed; destroying a course was not.
    assert.match(handler(courseDetail, "DELETE"), /requireRole\("UNIVERSITY_ADMIN"\)/);
  });
});

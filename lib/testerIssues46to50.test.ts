// ============================================================================
// TESTS: tester issues #46–#50.
//
// #46 and #47 were defects and are fixed here.
//
// #48, #49 and #50 each asked for an expansion of the permission model that the
// codebase deliberately withheld. All three were subsequently confirmed as
// product decisions and implemented:
//
//   #48 — a narrow result-scoped student selector, WITHOUT widening the student
//         registry. See lib/resultStudentSelector.test.ts.
//   #49 — a head of department may create and edit faculty, scoped to their own
//         department. See lib/departmentScopedWrites.test.ts.
//   #50 — the same for courses. Same suite.
//
// What survives in this file is the part of each boundary that did NOT move, so
// a later change to any of them is deliberate rather than incidental.
//
// The routes reach a database and this suite has none (see package.json), so
// route guarantees are pinned as source contracts and the behaviours that need
// rows are covered by live verification against the running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with comments stripped, for "this is gone" assertions. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const semesterResults = read("app/(university)/evaluation/results/semester/page.tsx");
const studentResults = read("app/(university)/evaluation/results/student/page.tsx");
const studentDetail = read("app/api/students/[id]/route.ts");
const studentList = read("app/api/students/route.ts");
const registry = read("lib/constants/departmentAcademics.ts");
const facultyList = read("app/api/faculty/route.ts");
const facultyDetail = read("app/api/faculty/[id]/route.ts");
const courseList = read("app/api/courses/route.ts");
const courseDetail = read("app/api/courses/[id]/route.ts");

/** One handler's body, so an assertion cannot be satisfied by a sibling. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

// ============================================================================
// #46 — Semester Results → a student's result details
// ============================================================================

describe("#46 — the Semester Results row opens the existing Student Results page", () => {
  it("the row links to the route tester issue #32 created", () => {
    // NOT a new page. #32 built app/(university)/evaluation/results/student and
    // #44 verified the Overview tile reaching it; this is the third entry point
    // into the same page.
    assert.match(
      semesterResults,
      /href=\{`\/evaluation\/results\/student\?studentId=\$\{student\.studentId\}`\}/
    );
  });

  it("that page exists — which is why the 404 is gone", () => {
    // The tester hit a deployment predating #32. The link was always correct;
    // the page was missing.
    assert.ok(
      existsSync(join(process.cwd(), "app/(university)/evaluation/results/student/page.tsx"))
    );
  });

  it("the link carries THIS row's student, not a generic destination", () => {
    // The selected student's identity has to survive the navigation, or every
    // row would open the same empty picker.
    assert.match(semesterResults, /studentId=\$\{student\.studentId\}/);
    assert.ok(
      !/href="\/evaluation\/results\/student"/.test(code(semesterResults)),
      "a bare href would drop the selected student"
    );
  });

  it("the destination reads that parameter back", () => {
    assert.match(studentResults, /type SearchParams = Promise<\{ studentId\?: string \}>/);
    assert.match(studentResults, /const \{ studentId \} = await searchParams/);
    assert.match(studentResults, /await getStudentResult\(studentId\)/);
  });

  it("its picker writes the SAME parameter name, so the two agree", () => {
    // If either side drifted, a deep link would land on the page and select
    // nobody — which is the failure mode this pins.
    assert.match(studentResults, /paramKey="studentId"/);
  });

  it("no duplicate Student Results page was created for this issue", () => {
    for (const duplicate of [
      "app/(university)/evaluation/results/semester/student/page.tsx",
      "app/(university)/evaluation/student-results/page.tsx",
      "app/(university)/evaluation/results/students/page.tsx",
    ]) {
      assert.ok(!existsSync(join(process.cwd(), duplicate)), `${duplicate} must not exist`);
    }
  });
});

// ============================================================================
// #47 — HOD → Student Details
// ============================================================================

describe("#47 — the student detail honours the same roles as the listing", () => {
  const get = handler(studentDetail, "GET");

  it("the LISTING admits STUDENT_READ_ROLES", () => {
    assert.match(studentList, /requireRole\(\.\.\.STUDENT_READ_ROLES\)/);
  });

  it("that set includes DEPARTMENT_HOD", () => {
    const start = registry.indexOf("export const STUDENT_READ_ROLES");
    const block = registry.slice(start, registry.indexOf("]", start));
    assert.match(block, /ROLES\.DEPARTMENT_HOD/);
  });

  it("the DETAIL now admits the same set — THE REGRESSION", () => {
    // It was requireRole("UNIVERSITY_ADMIN") alone, so a head who could see the
    // register was refused the row they had just been shown, and the page
    // rendered "Something went wrong. Try again."
    assert.match(get, /requireRole\(\.\.\.STUDENT_READ_ROLES\)/);
    assert.ok(
      !/requireRole\("UNIVERSITY_ADMIN"\)/.test(code(get)),
      "the admin-only guard is the defect and must not remain on GET"
    );
  });

  it("a head is still narrowed to their own department", () => {
    // Admitting the role without the restriction would hand a head the whole
    // university — a far worse bug than the one being fixed.
    assert.match(get, /resolveDepartmentScope\(guard\.session\)/);
    assert.match(get, /programmeIdsForDepartment\(tenant\.id, scope\.scope\.departmentId\)/);
  });

  it("the restriction is derived from the SESSION, never the request", () => {
    assert.match(get, /resolveDepartmentScope\(guard\.session\)/);
    assert.ok(!/resolveDepartmentScope\((req|request|parsed)/.test(get));
  });

  it("an out-of-department student is a 404, not a 403", () => {
    // So the response cannot confirm that a given id exists elsewhere in the
    // tenant — the same shape the listing's `in: []` produces.
    assert.match(get, /programmeId: \{ in: departmentProgrammeIds \}/);
    assert.match(get, /fail\("Student not found", "NOT_FOUND"\), \{ status: 404 \}/);
  });

  it("an empty department list matches nothing rather than everything", () => {
    // `in: []` is applied, not skipped. Treating it as "no filter" is the
    // mistake the listing explicitly documents.
    assert.match(get, /departmentProgrammeIds !== null/);
  });

  it("tenant isolation is unchanged", () => {
    assert.match(get, /tenantId: tenant\.id/);
    assert.ok(!/tenantId: (parsed|body|input|query)/.test(get));
  });

  it("PATCH was NOT widened — editing a student stays with the administrator", () => {
    // #47 reports viewing, not editing. Reading one student is narrower than
    // reading the list; writing one is not.
    assert.match(handler(studentDetail, "PATCH"), /requireRole\("UNIVERSITY_ADMIN"\)/);
  });
});

// ============================================================================
// #48 / #49 / #50 — the boundaries these reports ask to move
// ============================================================================

describe("#48 — the COE is still outside the student registry", () => {
  it("STUDENT_READ_ROLES does not admit the examination office", () => {
    // This WAS why the Transcript picker was empty for a COE and populated for
    // a head. It has been resolved without moving this line:
    // GET /api/results/students is a narrow selector gated on
    // requireResultAccess — see lib/resultStudentSelector.test.ts.
    //
    // The assertion stays because the boundary stays.
    // lib/api-department-scope.test.ts calls it "the boundary the locked
    // decision draws", and solving a picker by widening the registry would have
    // been the wrong fix.
    const start = registry.indexOf("export const STUDENT_READ_ROLES");
    const block = registry.slice(start, registry.indexOf("]", start));

    assert.ok(
      !/CONTROLLER_OF_EXAMINATION/.test(block),
      "the #48 fix must not have widened the registry"
    );
  });

  it("the COE may read a transcript, and now may also choose its subject", () => {
    // Both halves gated on the same authority, which is what keeps the picker
    // and the document in agreement.
    assert.match(read("app/api/results/transcript/[studentId]/route.ts"), /requireResultAccess/);
    assert.match(read("app/api/results/students/route.ts"), /requireResultAccess/);
  });
});

// #49 and #50 previously asserted that faculty and course writes were
// administrator-only. The product decision has since CONFIRMED that a head of
// department may create and edit both, so those assertions described the OLD
// behaviour. They are converted rather than deleted: the positive grant and the
// department scope that bounds it are pinned in
// lib/departmentScopedWrites.test.ts, and what remains here is the part of each
// boundary that did NOT move.

describe("#49/#50 — what the confirmed decision did NOT widen", () => {
  it("student writes remain administrator-only", () => {
    // The decision covered faculty and courses. Editing a student was not part
    // of it, and tester issue #47 deliberately widened only the READ.
    assert.match(
      handler(read("app/api/students/[id]/route.ts"), "PATCH"),
      /requireRole\("UNIVERSITY_ADMIN"\)/
    );
  });

  it("course DELETE remains administrator-only", () => {
    // Create and edit were confirmed; destroying a course was not. Retiring one
    // is an edit (isActive false) and is therefore available to a head.
    assert.match(handler(courseDetail, "DELETE"), /requireRole\("UNIVERSITY_ADMIN"\)/);
  });

  it("the examination office gains no write anywhere", () => {
    for (const name of ["FACULTY_WRITE_ROLES", "COURSE_WRITE_ROLES"]) {
      const start = registry.indexOf(`export const ${name}`);
      assert.ok(start >= 0, `${name} not found`);

      const block = registry.slice(start, registry.indexOf("]", start));
      assert.ok(
        !/CONTROLLER_OF_EXAMINATION/.test(block),
        `${name} must not admit the examination office`
      );
    }
  });

  it("the faculty and course READ sets are unchanged", () => {
    for (const name of ["FACULTY_READ_ROLES", "COURSE_READ_ROLES"]) {
      const start = registry.indexOf(`export const ${name}`);
      const block = registry.slice(start, registry.indexOf("]", start));

      assert.match(block, /ROLES\.DEPARTMENT_HOD/);
      assert.match(block, /ROLES\.UNIVERSITY_ADMIN/);
    }
  });

  it("the four write handlers are no longer administrator-only", () => {
    // The regression itself, stated once here and covered in detail in the
    // dedicated suite.
    assert.match(handler(facultyList, "POST"), /FACULTY_WRITE_ROLES/);
    assert.match(handler(facultyDetail, "PATCH"), /FACULTY_WRITE_ROLES/);
    assert.match(handler(courseList, "POST"), /COURSE_WRITE_ROLES/);
    assert.match(handler(courseDetail, "PATCH"), /COURSE_WRITE_ROLES/);
  });
});

// ============================================================================
// MODULE : Department-scoped collections — the scope is actually applied
// LAYER  : Regression Test
// PURPOSE: The decision itself is unit-tested in lib/domain/department/scope.ts.
//          This file pins the other half: that each collection which admits a
//          head of department ACTUALLY narrows its query, and narrows it from
//          the authenticated identity rather than from the request.
//
//          A correct decision that no route consults protects nothing. The
//          realistic failure is not bad logic — it is a route that adds
//          DEPARTMENT_HOD to its role list and forgets the scope, which reads
//          as "HOD access added" in review and hands that head the university.
//
// WHY THIS TEST READS THE SOURCE
//   Proving a Prisma `where` narrows rows needs a database, and the test runner
//   has none — see package.json and the report. What CAN be asserted here is
//   the wiring, and the wiring is what gets forgotten.
//
//   WHAT IT PROVES : each route resolves the scope, applies it to its query,
//                    and does not read a department from the request.
//   WHAT IT DOES NOT PROVE : that the resulting query returns the right rows.
//                    That needs the database checks in the QA checklist.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source with comments stripped, so a match is code and not prose.
 *
 * LINE COMMENTS FIRST, THEN BLOCK COMMENTS — the order is load-bearing.
 * A line comment may legitimately contain the characters that open a block
 * comment (a path like `lib/constants/` followed by a wildcard, say). Stripping
 * blocks first reads that as an opener and swallows everything up to the next
 * close, which silently deletes real code from the text being asserted against.
 * That happened while writing this file: an entire navigation group vanished
 * and the assertion failed against source that was perfectly correct.
 */
function codeOf(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every collection that admits DEPARTMENT_HOD and must therefore narrow. */
const SCOPED_ROUTES = [
  { name: "students", path: "app/api/students/route.ts" },
  { name: "faculty", path: "app/api/faculty/route.ts" },
  { name: "courses", path: "app/api/courses/route.ts" },
] as const;

describe("Department-scoped collections — the scope is resolved and applied", () => {
  for (const route of SCOPED_ROUTES) {
    it(`${route.name}: resolves the scope from the session`, () => {
      const code = codeOf(route.path);

      assert.match(
        code,
        /const scope = await resolveDepartmentScope\(guard\.session\)/,
        `${route.name} admits DEPARTMENT_HOD but does not resolve a department scope. ` +
          "Without it the head reads every department in the tenant."
      );

      assert.match(
        code,
        /if \(!scope\.ok\) return scope\.response/,
        `${route.name} must return the refusal for a head with no department, ` +
          "rather than continuing unrestricted."
      );
    });

    it(`${route.name}: consults scope.restricted when building its where clause`, () => {
      const code = codeOf(route.path);

      assert.match(
        code,
        /scope\.scope\.restricted/,
        `${route.name} resolves a scope it never applies. Resolving without ` +
          "applying is the failure this file exists to catch."
      );
    });
  }
});

describe("Department scope is derived from identity, never from the request", () => {
  for (const route of SCOPED_ROUTES) {
    it(`${route.name}: accepts no departmentId from the caller`, () => {
      const code = codeOf(route.path);

      // A departmentId read out of searchParams, params or the body would let a
      // head name somebody else's department. The scope must come only from
      // resolveDepartmentScope, which keys on the authenticated subject.
      assert.ok(
        !/searchParams.*departmentId|params.*departmentId|body.*departmentId/.test(code),
        `${route.name} appears to read a departmentId from the request. The ` +
          "department must be derived from the authenticated identity alone."
      );
    });
  }
});

describe("Students — the department restriction cannot be overwritten by ?programmeId", () => {
  const code = codeOf("app/api/students/route.ts");

  it("folds the department restriction and the ?programmeId filter into ONE condition", () => {
    // Both constrain the same column. Two object spreads that each set
    // `programmeId` do not intersect — the later one REPLACES the earlier. With
    // the caller's filter spread last, a head passing another department's
    // programme id would overwrite their own restriction and read that
    // department's students. This was a real defect in the first draft.
    assert.match(
      code,
      /const programmeWhere: Prisma\.StudentWhereInput =/,
      "the department restriction and the programmeId filter must be combined"
    );

    const spreads = code.match(/\.\.\.\(programmeId \? \{ programmeId \} : \{\}\)/g) ?? [];
    assert.equal(
      spreads.length,
      0,
      "the raw ?programmeId filter is spread into the where clause again. It " +
        "overwrites the department restriction that was spread before it. Fold " +
        "it into programmeWhere instead."
    );
  });

  it("intersects the requested programme with the department's own", () => {
    assert.match(
      code,
      /departmentProgrammeIds\.filter\(\(id\) => id === programmeId\)/,
      "a restricted caller's requested programme must be intersected with the " +
        "department's programmes, so a programme it does not own matches nothing"
    );
  });

  it("applies an empty programme set rather than skipping the filter", () => {
    // A department with no programmes has no students. `in: []` matches
    // nothing, which is correct; treating the empty array as "no filter" would
    // hand that head the whole university.
    assert.match(
      code,
      /departmentProgrammeIds !== null/,
      "the restriction must be detected with an explicit null check, not by " +
        "truthiness — an empty array is a real restriction, not an absent one"
    );
  });
});

describe("Navigation matches the APIs it links to", () => {
  const nav = codeOf("constants/navigation.tsx");

  it("gates the institutional registry to UNIVERSITY_ADMIN", () => {
    // Every API under these paths is requireRole("UNIVERSITY_ADMIN"), so a COE
    // or head who followed the link reached a page whose panels all answered
    // 403 — this file's own header calls that "a menu that lies".
    for (const href of [
      "/setup/campuses",
      "/setup/schools",
      "/setup/departments",
      "/setup/programmes",
      "/calendar/academic-years",
      "/calendar/batches",
      "/employees",
    ]) {
      // A tolerant window rather than [^}]*: the icon prop contains
      // `{iconClass}`, so a "no closing brace" span never reaches `roles`.
      const entry = new RegExp(
        `href: "${href}"[\\s\\S]{0,200}?roles: \\[ROLES\\.UNIVERSITY_ADMIN\\]`
      );
      assert.match(nav, entry, `${href} must be restricted to UNIVERSITY_ADMIN`);
    }
  });

  it("offers Students, Faculty and Courses to a head of department", () => {
    for (const href of ["/students", "/faculty", "/curriculum/courses"]) {
      const entry = new RegExp(
        `href: "${href}"[\\s\\S]{0,200}?ROLES\\.DEPARTMENT_HOD`
      );
      assert.match(
        nav,
        entry,
        `${href} admits DEPARTMENT_HOD at the API and must be linked for them`
      );
    }
  });

  it("offers the examination surface to the Controller of Examination", () => {
    for (const href of [
      "/evaluation",
      "/evaluation/schemes",
      "/evaluation/course-registrations",
      "/evaluation/assessment-events",
      "/evaluation/results/semester",
    ]) {
      const entry = new RegExp(
        `href: "${href}",[\\s\\S]{0,200}?ROLES\\.CONTROLLER_OF_EXAMINATION`
      );
      assert.match(nav, entry, `${href} is the COE's own area and must be linked`);
    }
  });
});

// ============================================================================
// The examination / evaluation surface.
//
// DEPARTMENT_HOD appears in five role arrays here — evaluation schemes,
// assessment events, marks, course registrations and results — and a role array
// can only say yes or no. Until these narrowings existed every one of those
// yeses was tenant-wide, and a head of department read any student's transcript
// in the university.
// ============================================================================

describe("Examination surface — every route that admits a head narrows it", () => {
  const NARROWED = [
    { name: "assessment events (list)", path: "app/api/assessment-events/route.ts" },
    { name: "assessment event (one)", path: "app/api/assessment-events/[id]/route.ts" },
    { name: "marks sheet", path: "app/api/assessment-events/[id]/marks/route.ts" },
    { name: "registrations (list)", path: "app/api/course-registrations/route.ts" },
    { name: "registration (one)", path: "app/api/course-registrations/[id]/route.ts" },
  ] as const;

  for (const route of NARROWED) {
    it(`${route.name}: resolves the scope and passes it to the controller`, () => {
      const code = codeOf(route.path);

      assert.match(
        code,
        /resolveDepartmentId\(/,
        `${route.name} admits DEPARTMENT_HOD but resolves no department scope`
      );

      assert.match(
        code,
        /scope\.departmentId/,
        `${route.name} resolves a scope it never passes down. Resolving without ` +
          "applying is the failure this file exists to catch."
      );
    });

    it(`${route.name}: reads no department from the request`, () => {
      const code = codeOf(route.path);

      assert.ok(
        !/searchParams.*departmentId|params.*departmentId|body.*departmentId/.test(code),
        `${route.name} appears to read a departmentId from the request`
      );
    });
  }
});

describe("Examination surface — the narrowing intersects, never replaces", () => {
  // The students route already had this defect once: two spreads of the same
  // key do not intersect, the later REPLACES the earlier. Here the restriction
  // is deliberately on `course` while the caller's filter is on `courseId`, so
  // Prisma ANDs them and a head naming another department's course matches
  // nothing instead of escaping the restriction.
  const REPOSITORIES = [
    "lib/repositories/assessmentEvent.repository.ts",
    "lib/repositories/courseRegistration.repository.ts",
  ] as const;

  for (const path of REPOSITORIES) {
    it(`${path.split("/").pop()}: applies course.departmentId with an explicit null check`, () => {
      const code = codeOf(path);

      assert.match(
        code,
        /\.\.\.\(departmentId === null \? \{\} : \{ course: \{ departmentId \} \}\)/,
        "the restriction must be applied on `course`, and detected with an " +
          "explicit null check rather than by truthiness"
      );

      assert.ok(
        !/\.\.\.\(departmentId \? \{ courseId/.test(code),
        "the restriction must not be written on the same key as the caller's filter"
      );
    });
  }
});

describe("Results — a head is narrowed, and an unassigned head is refused", () => {
  const guard = codeOf("lib/middleware/requireResultAccess.ts");

  it("narrows the elevated branch instead of granting ANY outright", () => {
    // RESULT_READ_ANY_ROLES admits DEPARTMENT_HOD. Returning ANY for that whole
    // set — which is what this file did — hands a head every student record in
    // the tenant.
    assert.match(
      guard,
      /resolveDepartmentScope\(elevated\.session\)/,
      "the elevated branch must resolve a department scope"
    );

    assert.match(
      guard,
      /scope: "DEPARTMENT", departmentId: scope\.scope\.departmentId/,
      "a restricted head must receive DEPARTMENT authority, not ANY"
    );
  });

  it("fails closed for a head with no department", () => {
    assert.match(
      guard,
      /if \(!scope\.ok\) \{\s*return \{ granted: false, response: scope\.response \};/,
      "a head with no department must be refused, not left unrestricted"
    );
  });

  it("does not restate the head/department rule", () => {
    // One answer to "who is narrowed" — resolveDepartmentScope's. A second copy
    // here is how the precedence for a user holding both admin and head, or the
    // refusal of an unassigned head, drifts apart from the first.
    assert.ok(
      !/DEPARTMENT_HOD/.test(guard),
      "the guard must delegate the role rule rather than restate it"
    );
  });

  it("the service enforces the authority it is handed", () => {
    const service = codeOf("lib/services/result.service.ts");

    assert.match(
      service,
      /access\.scope === "DEPARTMENT"/,
      "requireStudent must act on DEPARTMENT authority; an authority the " +
        "service ignores protects nothing"
    );

    assert.match(
      service,
      /student\.programmeId !== null &&/,
      "a student with no programme must be refused rather than admitted — " +
        "'unknown' must not read as 'permitted'"
    );
  });
});

describe("Evaluation schemes are deliberately NOT narrowed", () => {
  it("carries no department or programme to narrow by", () => {
    // Recorded as a decision rather than left as a silent omission. An
    // EvaluationScheme is a university-wide regulation: the schema gives it
    // tenantId and nothing else, so there is no department to scope it to and a
    // head reading one reads a rule, not another department's data.
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model EvaluationScheme "));
    const body = model.slice(0, model.search(/^\}/m));

    assert.ok(
      !/^\s+departmentId\s/m.test(body) && !/^\s+programmeId\s/m.test(body),
      "EvaluationScheme has gained a department or programme. It is now ownable, " +
        "and the read routes that admit DEPARTMENT_HOD must be narrowed too."
    );
  });
});

// ============================================================================
// The WRITE surfaces.
//
// Reads were the visible half. The dangerous half is a head CREATING or
// MODIFYING an examination record for another department by submitting another
// department's courseId — which no amount of read narrowing prevents.
//
// Two surfaces, and only two: a sweep of every MANAGE role array shows the rest
// are [UNIVERSITY_ADMIN, CONTROLLER_OF_EXAMINATION], so a head is refused at the
// role gate and never reaches a query at all.
// ============================================================================

describe("Write surfaces — the only two a head can reach", () => {
  it("no head appears in any evaluation MANAGE role array", () => {
    // If one is ever added, its routes need ownership validation on the
    // referenced course BEFORE this test is changed to allow it.
    for (const [file, name] of [
      ["lib/constants/evaluationScheme.ts", "EVALUATION_SCHEME_MANAGE_ROLES"],
      ["lib/constants/assessmentEvent.ts", "ASSESSMENT_EVENT_MANAGE_ROLES"],
      ["lib/constants/courseRegistration.ts", "REGISTRATION_MANAGE_ROLES"],
      ["lib/constants/studentComponentScore.ts", "EXTERNAL_MARK_UPLOAD_ROLES"],
    ] as const) {
      const code = codeOf(file);
      const start = code.indexOf(`export const ${name}`);
      assert.ok(start >= 0, `${name} not found in ${file}`);

      const block = code.slice(start, code.indexOf("]", start));

      assert.ok(
        !/ROLES\.(DEPARTMENT_)?HOD\b/.test(block),
        `${name} now admits a head of department. Every write behind it must ` +
          "validate that the referenced course belongs to that head's department."
      );
    }
  });

  it("exam resources: the write chokepoint confines a head", () => {
    // requireWritable is the single path for update, publish, archive and
    // delete. Narrowing it once covers all four.
    const service = codeOf("lib/services/examResource.service.ts");

    assert.match(
      service,
      /access\.scope === "DEPARTMENT"/,
      "requireWritable must act on DEPARTMENT authority"
    );

    assert.match(
      service,
      /row\.departmentId !== access\.departmentId/,
      "a resource outside the department must be refused"
    );

    assert.match(
      service,
      /access\.departmentId === null \|\|/,
      "a resource with no department must be refused, not admitted"
    );
  });

  it("exam resources: CREATE validates the submitted courseId", () => {
    // The manipulated-id case on a create. The check must be against the course
    // as resolved from the database, not against anything submitted.
    const service = codeOf("lib/services/examResource.service.ts");

    assert.match(
      service,
      /course\.departmentId !== access\.departmentId/,
      "create must refuse a head submitting another department's courseId"
    );
  });

  it("internal assessment: both writes validate the course before acting", () => {
    const service = codeOf("lib/services/internalAssessment.service.ts");

    for (const method of ["generate", "decide"]) {
      const start = service.indexOf(`async ${method}(`);
      assert.ok(start >= 0, `${method} not found`);

      const body = service.slice(start, start + 900);

      assert.match(
        body,
        /assertCourseInDepartment\(/,
        `${method} WRITES marks and must validate the course against the ` +
          "caller's department first"
      );
    }
  });

  it("internal assessment: per-student reads confine by STUDENT, not by an optional filter", () => {
    // courseId is OPTIONAL on those queries; confining by an absent filter
    // would confine nothing.
    const service = codeOf("lib/services/internalAssessment.service.ts");

    for (const method of ["getForStudent", "getAudit"]) {
      const start = service.indexOf(`async ${method}(`);
      assert.ok(start >= 0, `${method} not found`);

      const body = service.slice(start, start + 700);

      assert.match(
        body,
        /assertStudentInDepartment\(/,
        `${method} must confine by the student, whose programme names the department`
      );
    }
  });

  it("every internal-assessment route resolves the scope from identity", () => {
    for (const path of [
      "app/api/internal-assessment/generate/route.ts",
      "app/api/internal-assessment/[studentId]/route.ts",
      "app/api/internal-assessment/rules/route.ts",
      "app/api/internal-assessment/student/[studentId]/route.ts",
      "app/api/internal-assessment/audit/[studentId]/route.ts",
    ]) {
      const code = codeOf(path);

      assert.match(code, /resolveDepartmentId\(guard\.session\)/, `${path} resolves no scope`);
      assert.match(code, /scope\.departmentId/, `${path} resolves a scope it never applies`);
      assert.ok(
        !/searchParams.*departmentId|params.*departmentId|body.*departmentId/.test(code),
        `${path} appears to read a departmentId from the request`
      );
    }
  });
});

describe("Both spellings of head of department are recognised", () => {
  it("the scope decision matches HOD as well as DEPARTMENT_HOD", () => {
    // Recognising only one FAILS OPEN: the other spelling passes the role
    // guards that list it, matches no head role in the decision, and is handed
    // `restricted: false` — the whole university. UNIVERSITY_ROLES admits both
    // and constants/roles calls them the same office.
    const scope = codeOf("lib/domain/department/scope.ts");

    assert.match(
      scope,
      /HEAD_OF_DEPARTMENT_ROLES[\s\S]{0,200}ROLES\.HOD/,
      "the older HOD spelling must be treated as a head"
    );

    assert.ok(
      !/if \(!roles\.includes\(ROLES\.DEPARTMENT_HOD\)\)/.test(scope),
      "the decision must not test a single spelling"
    );
  });

  it("navigation offers a head the same links under either spelling", () => {
    // The mirror of the fail-open: a HOD-seeded user with department-scoped API
    // access and no menu at all.
    const nav = codeOf("constants/navigation.tsx");
    const entries = nav.match(/roles: \[[^\]]*DEPARTMENT_HOD[^\]]*\]/g) ?? [];

    assert.ok(entries.length > 0, "no head-of-department nav entries found");

    for (const entry of entries) {
      assert.match(entry, /ROLES\.HOD\b/, `lists DEPARTMENT_HOD but not HOD: ${entry}`);
    }
  });
});

describe("Tenant isolation survives every department narrowing", () => {
  it("each ownership query pairs departmentId with tenantId", () => {
    // A department id is opaque. Filtering on it ALONE would let a forged or
    // stale id reach another institution's rows; the tenant predicate is what
    // makes that impossible, and it must never be dropped as redundant.
    for (const path of [
      "lib/repositories/result.repository.ts",
      "lib/repositories/assessmentEvent.repository.ts",
      "lib/repositories/courseRegistration.repository.ts",
      "lib/repositories/studentComponentScore.repository.ts",
      "lib/repositories/internalAssessment.repository.ts",
    ]) {
      const code = codeOf(path);
      const clauses = code.match(/where: \{[^}]*departmentId[^}]*\}/g) ?? [];

      assert.ok(clauses.length > 0, `${path} has no department-scoped query`);

      for (const clause of clauses) {
        assert.match(
          clause,
          /tenantId/,
          `${path} filters on departmentId without tenantId: ${clause}`
        );
      }
    }
  });

  it("the department is resolved from the authenticated subject", () => {
    // Department.hodUserId is @unique and the user authenticated against one
    // tenant, so the department resolved can only be theirs.
    const auth = codeOf("lib/auth/departmentScope.ts");

    assert.match(
      auth,
      /where: \{ hodUserId: userId \}/,
      "the department must be keyed on the authenticated subject"
    );
  });
});

describe("COE keeps the examination authority the product model grants", () => {
  it("is never department-narrowed", () => {
    const scope = codeOf("lib/domain/department/scope.ts");

    assert.ok(
      !/CONTROLLER_OF_EXAMINATION/.test(scope),
      "the department narrowing must not mention COE — its examination authority " +
        "is university-wide and narrowing it would silently shrink it"
    );
  });

  it("holds authority on every evaluation surface", () => {
    for (const [file, name] of [
      ["lib/constants/evaluationScheme.ts", "EVALUATION_SCHEME_MANAGE_ROLES"],
      ["lib/constants/assessmentEvent.ts", "ASSESSMENT_EVENT_MANAGE_ROLES"],
      ["lib/constants/courseRegistration.ts", "REGISTRATION_MANAGE_ROLES"],
      ["lib/constants/result.ts", "SEMESTER_RESULT_READ_ROLES"],
    ] as const) {
      const code = codeOf(file);
      const start = code.indexOf(`export const ${name}`);
      const block = code.slice(start, code.indexOf("]", start));

      assert.match(
        block,
        /ROLES\.CONTROLLER_OF_EXAMINATION/,
        `${name} must keep the Controller of Examination`
      );
    }
  });

  it("gains no student or faculty registry permission", () => {
    // The agreed product model: COE is examination and evaluation, not a
    // university-wide PEOPLE registry.
    //
    // COURSE_READ_ROLES is a deliberate exception under the locked product
    // decision — scheduling an examination means naming a course, and without
    // that read the examination office cannot create one. The people
    // registries stay closed, which is what this asserts.
    const registry = codeOf("lib/constants/departmentAcademics.ts");

    for (const name of ["STUDENT_READ_ROLES", "FACULTY_READ_ROLES"]) {
      const start = registry.indexOf(`export const ${name}`);
      assert.ok(start >= 0, `${name} not found`);

      const block = registry.slice(start, registry.indexOf("]", start));

      assert.ok(
        !/CONTROLLER_OF_EXAMINATION/.test(block),
        `${name} must not admit the examination office`
      );
    }
  });
});

// ============================================================================
// The examination CALENDAR (/api/examinations).
//
// These three routes predate CONTROLLER_OF_EXAMINATION and were written with
// literal role strings, so the role named after examinations was refused by the
// examination calendar. PRD 57 lists "Examinations" under University
// Administration and PRD 17.2 puts the calendar in Examination Configuration.
// ============================================================================

describe("Examination calendar — the Controller of Examination can reach it", () => {
  it("names the COE in both examination role arrays", () => {
    const constants = codeOf("lib/constants/examination.ts");

    for (const name of ["EXAMINATION_READ_ROLES", "EXAMINATION_MANAGE_ROLES"]) {
      const start = constants.indexOf(`export const ${name}`);
      assert.ok(start >= 0, `${name} not found`);

      const block = constants.slice(start, constants.indexOf("]", start));

      assert.match(
        block,
        /ROLES\.CONTROLLER_OF_EXAMINATION/,
        `${name} must admit the Controller of Examination`
      );
    }
  });

  it("keeps STUDENT out of the manage set and in the read set", () => {
    // The student portal reads its own examination timetable; it must never
    // schedule one.
    const constants = codeOf("lib/constants/examination.ts");

    const read = constants.slice(
      constants.indexOf("export const EXAMINATION_READ_ROLES"),
      constants.indexOf("]", constants.indexOf("export const EXAMINATION_READ_ROLES"))
    );
    const manage = constants.slice(
      constants.indexOf("export const EXAMINATION_MANAGE_ROLES"),
      constants.indexOf("]", constants.indexOf("export const EXAMINATION_MANAGE_ROLES"))
    );

    assert.match(read, /ROLES\.STUDENT/, "a student reads their own examinations");
    assert.ok(!/ROLES\.STUDENT/.test(manage), "a student must not schedule an examination");
  });

  it("admits no head of department — a permission with no PRD basis", () => {
    // The PRD assigns the head of department nothing on the examination
    // calendar. Adding them would be inventing a requirement, so the omission
    // is deliberate and pinned here rather than left to drift.
    const constants = codeOf("lib/constants/examination.ts");

    assert.ok(
      !/ROLES\.(DEPARTMENT_)?HOD\b/.test(constants),
      "the examination calendar must not admit a head of department without a PRD basis"
    );
  });

  it("every examination route uses the constants, not literal role strings", () => {
    for (const path of [
      "app/api/examinations/route.ts",
      "app/api/examinations/[id]/route.ts",
      "app/api/examinations/[id]/results/route.ts",
    ]) {
      const code = codeOf(path);

      assert.match(
        code,
        /requireRole\(\.\.\.EXAMINATION_(READ|MANAGE)_ROLES\)/,
        `${path} must guard with the shared examination role arrays`
      );

      assert.ok(
        !/requireRole\("UNIVERSITY_ADMIN"/.test(code),
        `${path} still hardcodes a role string, which is how the COE was ` +
          "omitted from its own surface in the first place"
      );
    }
  });

  it("joins the course so the calendar needs no course-registry permission", () => {
    // services/reference.ts resolves course names by scanning /api/courses,
    // which is COURSE_READ_ROLES — closed to the COE. Without this join every
    // course name rendered as "—" for exactly the caller the screen is for, and
    // the alternative fix would have handed the examination office the
    // institutional catalogue.
    for (const path of [
      "app/api/examinations/route.ts",
      "app/api/examinations/[id]/route.ts",
    ]) {
      const code = codeOf(path);

      assert.match(
        code,
        /course: \{ select: \{ code: true, name: true \} \}/,
        `${path} must join the course onto the examination row`
      );
      assert.match(
        code,
        /semester: \{ select: \{ name: true \} \}/,
        `${path} must join the semester onto the examination row`
      );
    }
  });

  it("does not widen the COE into the PEOPLE registries", () => {
    // The examination row carries its own course and semester names, so the
    // calendar needs no catalogue read to render. The COE does hold
    // COURSE_READ_ROLES under the locked decision — for resolving a course
    // while SCHEDULING — but the student and faculty registries stay closed.
    const registry = codeOf("lib/constants/departmentAcademics.ts");

    for (const name of ["STUDENT_READ_ROLES", "FACULTY_READ_ROLES"]) {
      const start = registry.indexOf(`export const ${name}`);
      const block = registry.slice(start, registry.indexOf("]", start));

      assert.ok(
        !/CONTROLLER_OF_EXAMINATION/.test(block),
        `${name} must not admit the examination office`
      );
    }
  });
});

// ============================================================================
// Eligibility and Hall Tickets — the authorization boundaries.
//
// Locked product decisions: eligibility and hall tickets are MVP; there is NO
// separate examination registration; the COE gets the minimum reference reads
// examination setup needs and nothing more.
// ============================================================================

describe("Hall tickets — issued only to the eligible, only by the office", () => {
  it("the issue path applies the eligibility gate itself", () => {
    // The endpoint takes no studentId, so the only thing standing between a
    // request and a ticket is this filter. If it is ever removed, every
    // enrolled student gets a ticket regardless of standing.
    const service = codeOf("lib/services/hallTicket.service.ts");

    const start = service.indexOf("export async function issueHallTickets");
    assert.ok(start >= 0, "issueHallTickets not found");

    const body = service.slice(start, start + 1400);

    assert.match(
      body,
      /cohort\.filter\(\(row\) => row\.decision\.eligible\)/,
      "issuing must filter the cohort by the eligibility decision"
    );
    assert.match(
      body,
      /skipDuplicates: true/,
      "issuing must be idempotent against @@unique(examinationId, studentId)"
    );
  });

  it("neither hall-ticket route accepts a studentId from the request", () => {
    // The strongest form of the guarantee: a request that would issue a ticket
    // to a named student cannot be expressed at all.
    for (const path of [
      "app/api/examinations/[id]/hall-tickets/route.ts",
      "app/api/students/me/hall-tickets/route.ts",
    ]) {
      const code = codeOf(path);

      assert.ok(
        !/searchParams.*studentId|params.*studentId|body.*studentId/.test(code),
        `${path} appears to read a studentId from the request`
      );
    }
  });

  it("a student's own tickets are resolved from the session, never an id", () => {
    const code = codeOf("app/api/students/me/hall-tickets/route.ts");

    assert.match(
      code,
      /where: \{ userId: guard\.session\.sub, tenantId: tenantGuard\.tenant\.id \}/,
      "the Student row must be resolved from the authenticated subject and the tenant"
    );
  });

  it("the eligibility roll and ticket issue are narrowed to the examination office", () => {
    // EXAMINATION_READ_ROLES also admits STUDENT and FACULTY so they can read
    // the calendar. A cohort-wide roll is not theirs.
    for (const path of [
      "app/api/examinations/[id]/eligibility/route.ts",
      "app/api/examinations/[id]/hall-tickets/route.ts",
    ]) {
      const code = codeOf(path);

      assert.match(
        code,
        /CONTROLLER_OF_EXAMINATION/,
        `${path} must narrow to the examination office`
      );
      assert.match(
        code,
        /status: 403/,
        `${path} must refuse a caller outside the examination office`
      );
    }
  });

  it("resolves the examination tenant-scoped, so a foreign id reads as absent", () => {
    const service = codeOf("lib/services/hallTicket.service.ts");

    assert.match(
      service,
      /where: \{ id: examinationId, tenantId \}/,
      "an examination must be resolved within the caller's tenant"
    );
  });
});

describe("Eligibility is derived from course registration, not a second model", () => {
  it("reads CourseRegistration rather than any examination-registration table", () => {
    // Locked decision: existing course registration IS the examination
    // registration. A second model would be two records of one fact.
    const service = codeOf("lib/services/hallTicket.service.ts");

    assert.match(
      service,
      /prisma\.courseRegistration\.findMany/,
      "the cohort must come from course registrations"
    );
    assert.ok(
      !/examRegistration|ExamRegistration/.test(service),
      "no separate examination-registration concept may be introduced"
    );
  });

  it("stores no eligibility anywhere", () => {
    // Eligibility is recomputed from the enrolment and the register on every
    // read. A stored flag would be a cache that could disagree with both.
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

    assert.ok(
      !/model\s+(Eligibility|ExamEligibility|ExaminationEligibility)\b/.test(schema),
      "eligibility must stay derived — no eligibility table"
    );
  });

  it("counts LATE and EXCUSED as attended, only ABSENT as missed", () => {
    // The rule moved into lib/domain/attendance/attended.ts, where three other
    // modules now read it too — this service was the one that had it right, and
    // the analytics and notification paths were corrected to match it rather
    // than the other way round. Asserted through the shared predicate instead
    // of hall-ticket's own spelling of it, because the spelling is no longer
    // where the decision lives.
    const service = codeOf("lib/services/hallTicket.service.ts");

    assert.match(
      service,
      /isAttended\(row\.status\)/,
      "hall-ticket eligibility must count attendance through the shared rule"
    );
    assert.match(service, /domain\/attendance\/attended/);

    const domain = codeOf("lib/domain/attendance/attended.ts");
    assert.match(
      domain,
      /return status !== "ABSENT"/,
      "an excused or late student was not absent and must not be detained as if they were"
    );
  });

  it("every module that decides the attendance FLOOR shares one rule", () => {
    // The defect this replaces: four modules answered "is this student below
    // the floor" and two of them counted EXCUSED as an absence. The same
    // student was issued a hall ticket as eligible while being warned they were
    // below 75%. Both statements came from this codebase, at the same moment.
    for (const path of [
      "lib/services/hallTicket.service.ts",
      "lib/services/attendanceAnalytics.service.ts",
      "lib/controllers/notificationEmitter.controller.ts",
    ]) {
      assert.match(
        codeOf(path),
        /domain\/attendance\/attended/,
        `${path} must read the attendance floor rule from the domain`
      );
    }
  });

  it("the analytics numerator is `attended`, never the raw PRESENT count", () => {
    // calculateRequirement, projectPercentage and the leave calculator's
    // totalAttended were each handed stats.present — PRESENT and nothing else —
    // while overallPercentage was computed over present+late. A student safely
    // above the floor was told how many more classes they had to attend, and
    // the leave calculator under-reported what they had already attended.
    const analytics = codeOf("lib/services/attendanceAnalytics.service.ts");

    assert.ok(
      !/calculateRequirement\(stats\.present|projectPercentage\([^)]*stats\.present|totalAttended: stats\.present/.test(
        analytics
      ),
      "stats.present is a raw status count, not the attended total"
    );
    assert.match(analytics, /calculateRequirement\(stats\.attended, stats\.total\)/);
    assert.match(analytics, /totalAttended: stats\.attended/);
  });

  it("keeps the attendance floor equal to the analytics threshold", () => {
    // eligibility.ts restates the number so it can stay pure. The two must not
    // drift, or a student could be safe on one screen and detained on another.
    const domain = codeOf("lib/domain/examination/eligibility.ts");
    const analytics = codeOf("lib/services/attendanceAnalytics.service.ts");

    const domainValue = /MINIMUM_ATTENDANCE_PERCENTAGE = (\d+)/.exec(domain)?.[1];
    const analyticsValue = /MINIMUM_PERCENTAGE = (\d+)/.exec(analytics)?.[1];

    assert.ok(domainValue, "the domain floor was not found");
    assert.equal(
      domainValue,
      analyticsValue,
      "the eligibility floor and the attendance-analytics threshold must agree"
    );
  });
});

describe("COE reference access — the minimum for examination setup, and no more", () => {
  it("can READ the course catalogue, because an examination names a course", () => {
    const registry = codeOf("lib/constants/departmentAcademics.ts");
    const start = registry.indexOf("export const COURSE_READ_ROLES");
    const block = registry.slice(start, registry.indexOf("]", start));

    assert.match(block, /ROLES\.CONTROLLER_OF_EXAMINATION/);
  });

  it("gains NO student or faculty registry", () => {
    // The boundary the locked decision draws. Course reference data is needed
    // to schedule an examination; the people registries are not.
    const registry = codeOf("lib/constants/departmentAcademics.ts");

    for (const name of ["STUDENT_READ_ROLES", "FACULTY_READ_ROLES"]) {
      const start = registry.indexOf(`export const ${name}`);
      assert.ok(start >= 0, `${name} not found`);

      const block = registry.slice(start, registry.indexOf("]", start));

      assert.ok(
        !/CONTROLLER_OF_EXAMINATION/.test(block),
        `${name} must not admit the examination office`
      );
    }
  });

  it("can read the academic calendar but not write it", () => {
    // Creating an academic year or a semester is academic administration. Only
    // the GET handlers were opened.
    for (const path of [
      "app/api/academic-years/route.ts",
      "app/api/academic-years/[id]/semesters/route.ts",
    ]) {
      const code = codeOf(path);

      assert.match(
        code,
        /requireRole\(\.\.\.ACADEMIC_CALENDAR_READ_ROLES\)/,
        `${path} GET must admit the examination office`
      );
      assert.match(
        code,
        /requireRole\("UNIVERSITY_ADMIN"\)/,
        `${path} POST must stay closed to the examination office`
      );
    }
  });
});

describe("Locked decisions 5 and 6 — nothing was built", () => {
  it("no result-approval workflow, state or storage was introduced", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

    // The orphan ResultPublicationStatus enum predates this work and is left
    // exactly as it was: declared, used by no model. What must NOT appear is a
    // model or column that starts persisting an approval.
    assert.ok(
      !/model\s+ResultApproval\b/.test(schema),
      "result approval is not MVP and must not be modelled"
    );
    assert.ok(
      !/approvedById|approvedAt/.test(schema),
      "no approval columns may be added to satisfy PRD wording"
    );
  });

  it("no revaluation request workflow was introduced", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

    assert.ok(
      !/model\s+(Revaluation|RevaluationRequest)\b/.test(schema),
      "the existing amend-plus-audit mechanism is the MVP answer"
    );
  });

  it("mark amendment is still audited, which is what makes revaluation traceable", () => {
    // Decision 6 keeps amend + audit as the revaluation mechanism, so the audit
    // record is load-bearing rather than incidental.
    const service = codeOf("lib/services/studentComponentScore.service.ts");

    assert.match(
      service,
      /this\.audit\.record\(/,
      "amending a mark must write an audit record"
    );
  });
});

// ============================================================================
// The four COE P1 items: create form, seat allocation, printable hall ticket,
// and server-side examination filtering.
// ============================================================================

describe("Examination filtering happens in the WHERE, not in the page", () => {
  it("the route validates and applies both filters", () => {
    // Applied in the page they could only narrow rows already fetched, so a
    // filter over page 1 of 20 would hide matches it never loaded and report a
    // total belonging to the unfiltered set.
    const route = codeOf("app/api/examinations/route.ts");

    assert.match(
      route,
      /listExaminationsQuerySchema\.safeParse/,
      "the list route must parse the filter contract, not pagination alone"
    );
    assert.match(
      route,
      /\.\.\.\(type === undefined \? \{\} : \{ type \}\)/,
      "type must be applied to the where clause"
    );
    assert.match(
      route,
      /\.\.\.\(semesterId === undefined \? \{\} : \{ semesterId \}\)/,
      "semesterId must be applied to the where clause"
    );
  });

  it("validates type against the enum, so a bad value is a 400 not an empty list", () => {
    const schema = codeOf("lib/validations/examination.ts");

    assert.match(
      schema,
      /type: z\.enum\(ExaminationType\)\.optional\(\)/,
      "an unknown examination type must be rejected rather than silently matching nothing"
    );
  });

  it("the page no longer filters the fetched rows itself", () => {
    const page = codeOf("app/(university)/examinations/page.tsx");

    assert.ok(
      !/all\.filter\(\(row\) => row\.type === type\)/.test(page),
      "client-side type filtering must be gone — it lies about the total"
    );
  });
});

describe("Seat allocation — deterministic, non-destructive, unique", () => {
  it("the database, not the allocator, forbids two candidates one seat", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

    assert.match(
      schema,
      /@@unique\(\[examinationId, seatNo\]\)/,
      "seat uniqueness must be a constraint, so it holds against every write path"
    );
  });

  it("allocates in enrolment order and keeps seats already assigned", () => {
    const service = codeOf("lib/services/hallTicket.service.ts");
    const start = service.indexOf("export async function allocateSeats");
    assert.ok(start >= 0, "allocateSeats not found");

    const body = service.slice(start, start + 2200);

    assert.match(
      body,
      /ticket\.seatNo === null/,
      "only unseated tickets may be allocated — renumbering a hall whose candidates were already told where to sit is not acceptable"
    );
    assert.match(
      body,
      /enrollmentNo\.localeCompare/,
      "allocation must be deterministic, ordered by enrolment number"
    );
    assert.match(
      body,
      /taken\.has\(seat\)/,
      "seats already occupied must be skipped rather than collided with"
    );
  });

  it("writes the whole plan in one transaction", () => {
    // A half-seated hall is worse than an unseated one: the candidates who were
    // told a seat and the ones who were not look identical on the day.
    const service = codeOf("lib/services/hallTicket.service.ts");
    const start = service.indexOf("export async function allocateSeats");
    const body = service.slice(start, start + 2200);

    assert.match(body, /prisma\.\$transaction\(/);
  });

  it("the seat route names no seat and no student", () => {
    const route = codeOf("app/api/examinations/[id]/seats/route.ts");

    assert.ok(
      !/body.*seatNo|searchParams.*seatNo|body.*studentId/.test(route),
      "a caller must not be able to dictate a seat or a candidate"
    );
    assert.match(route, /CONTROLLER_OF_EXAMINATION/);
    assert.match(route, /status: 403/, "must refuse callers outside the examination office");
  });

  it("produces a readable, sortable seat label", () => {
    const service = codeOf("lib/services/hallTicket.service.ts");

    assert.match(
      service,
      /padStart\(2, "0"\)/,
      "seat numbers must be zero-padded so they sort correctly as strings"
    );
  });
});

describe("Printable hall ticket — the student's own, by construction", () => {
  it("selects the ticket from the caller's OWN list rather than fetching by id", () => {
    // The isolation is structural: a ticketId belonging to somebody else is
    // simply not in the list, so no ownership comparison has to be written and
    // therefore none can be forgotten.
    const page = codeOf("app/(portals)/student/examinations/[ticketId]/page.tsx");

    assert.match(
      page,
      /getMyHallTickets\(\)/,
      "the printable ticket must come from the caller's own tickets"
    );
    assert.match(
      page,
      /result\.data\.find\(\(row\) => row\.id === ticketId\)/,
      "the id must select from that list, never query by itself"
    );
    assert.match(page, /notFound\(\)/, "a ticket that is not theirs must not render");
  });

  it("hides the application chrome from the printed sheet", () => {
    const page = codeOf("app/(portals)/student/examinations/[ticketId]/page.tsx");

    assert.match(
      page,
      /print:hidden/,
      "navigation and buttons must not appear on the printed hall ticket"
    );
  });
});

describe("Examination scheduling — the form is options, the API is the gate", () => {
  it("the form sends no facultyId, tenantId or authorization of its own", () => {
    const form = codeOf(
      "app/(university)/examinations/new/ScheduleExaminationForm.tsx"
    );

    assert.ok(
      !/tenantId|facultyId/.test(form),
      "the form must not carry identity — the route resolves it from the session"
    );
  });

  it("the action validates the coherence rules the schema cannot express", () => {
    const action = codeOf("actions/examinations.ts");

    assert.match(action, /pass mark cannot exceed the maximum/i);
    assert.match(action, /end time must be after the start time/i);
  });

  it("scheduling stays on EXAMINATION_MANAGE_ROLES", () => {
    const route = codeOf("app/api/examinations/route.ts");

    assert.match(
      route,
      /requireRole\(\.\.\.EXAMINATION_MANAGE_ROLES\)/,
      "creating an examination must use the shared manage array"
    );
  });
});

// ============================================================================
// Attendance corrections — the boundaries (PRD §13.2).
//
// A correction workflow that could be self-approved, that mutated the register
// on request rather than on approval, or that let a rejection silently change
// a mark would be worse than no workflow: it would carry the authority of an
// approval process while providing none of it.
// ============================================================================

describe("Attendance corrections — a request never mutates the register", () => {
  const service = codeOf("lib/services/attendanceCorrection.service.ts");

  it("raiseCorrection writes NO attendance update", () => {
    const start = service.indexOf("export async function raiseCorrection");
    assert.ok(start >= 0, "raiseCorrection not found");

    const body = service.slice(start, service.indexOf("export async function listCorrections"));

    assert.ok(
      !/attendance\.update|attendance\.updateMany|attendance\.delete/.test(body),
      "raising a request must leave the register untouched — the mark keeps its " +
        "value until somebody authorised approves the change"
    );
  });

  it("only the APPROVE path touches attendance", () => {
    const start = service.indexOf("export async function reviewCorrection");
    const body = service.slice(start);

    assert.match(
      body,
      /if \(approving\) \{[\s\S]{0,400}?attendance\.updateMany/,
      "the register may only be written on the approve branch"
    );
  });

  it("the approving update is tenant-scoped", () => {
    // A forged request id must not be able to reach another university's row.
    const start = service.indexOf("export async function reviewCorrection");
    const body = service.slice(start);

    assert.match(body, /where: \{ id: request\.attendanceId, tenantId \}/);
  });

  it("refuses approval when the record was deleted meanwhile", () => {
    // Otherwise the request is marked APPROVED with nothing applied — a record
    // of a correction that never happened.
    const start = service.indexOf("export async function reviewCorrection");
    const body = service.slice(start);

    assert.match(body, /applied\.count === 0/);
  });

  it("captures currentStatus at request time, not at approval time", () => {
    // Reading it from the row at approval would show whatever it had become,
    // which is exactly what an approver must not have move under them.
    const start = service.indexOf("export async function raiseCorrection");
    const body = service.slice(start, service.indexOf("export async function listCorrections"));

    assert.match(body, /currentStatus: attendance\.status/);
  });
});

describe("Attendance corrections — authorization", () => {
  it("the review set mirrors the UNLOCK set, not the LOCK set", () => {
    // This module already draws the line at "a lecturer may finalise their own
    // register but may not reopen it". Approving a change to a finalised
    // register is the same act.
    const corrections = codeOf("lib/constants/attendanceCorrection.ts");

    const reviewStart = corrections.indexOf("export const ATTENDANCE_CORRECTION_REVIEW_ROLES");
    const reviewBlock = corrections.slice(reviewStart, corrections.indexOf("]", reviewStart));

    assert.ok(
      !/ROLES\.FACULTY/.test(reviewBlock),
      "FACULTY must not approve corrections; that is the unlock tier's act"
    );
    assert.match(reviewBlock, /ROLES\.DEPARTMENT_HOD/);
    assert.match(reviewBlock, /ROLES\.UNIVERSITY_ADMIN/);

    const requestStart = corrections.indexOf("export const ATTENDANCE_CORRECTION_REQUEST_ROLES");
    const requestBlock = corrections.slice(requestStart, corrections.indexOf("]", requestStart));

    assert.match(requestBlock, /ROLES\.FACULTY/, "faculty must be able to RAISE one");
  });

  it("neither route reads a requester or reviewer from the request body", () => {
    // Both are the authenticated subject. A correction that could name its own
    // author could be misattributed to someone who never raised it.
    for (const path of [
      "app/api/attendance/corrections/route.ts",
      "app/api/attendance/corrections/[id]/route.ts",
    ]) {
      const code = codeOf(path);

      assert.ok(
        !/body.*requestedById|body.*reviewedById|parsed\.data\.(requestedById|reviewedById)/.test(code),
        `${path} must take the actor from the session, never the body`
      );
      assert.match(code, /guard\.session\.sub/);
    }
  });

  it("the validation contract accepts no server-managed field", () => {
    const schema = codeOf("lib/validations/attendanceCorrection.ts");

    for (const forbidden of ["requestedById", "reviewedById", "currentStatus", "status:"]) {
      assert.ok(
        !new RegExp(`^\\s+${forbidden.replace(":", "")}:`, "m").test(
          schema.slice(schema.indexOf("raiseCorrectionSchema"), schema.indexOf("reviewCorrectionSchema"))
        ),
        `${forbidden} must not be accepted from the client`
      );
    }

    // .strict() so an extra key is a rejection rather than a silent drop.
    assert.match(schema, /\.strict\(\)/);
  });

  it("a rejection must state a reason", () => {
    const service = codeOf("lib/services/attendanceCorrection.service.ts");

    assert.match(
      service,
      /decision === "REJECT" && \(note === undefined \|\| note\.trim\(\) === ""\)/,
      "the person whose correction was refused is owed the reason"
    );
  });
});

describe("Attendance corrections — the lock interaction is deliberate", () => {
  it("ordinary attendance writes STILL consult the lock", () => {
    // The correction path is an exception; the ordinary paths must not become
    // one. If these ever stop calling assertWritable, a locked register is
    // editable again through the front door.
    for (const path of ["app/api/attendance/route.ts", "app/api/attendance/[id]/route.ts"]) {
      assert.match(
        codeOf(path),
        /assertWritable/,
        `${path} must keep enforcing the attendance lock`
      );
    }
  });

  it("the correction service does NOT call assertWritable, and says why", () => {
    // Deliberate: a lock that also blocked corrections would make a locked
    // register permanently uncorrectable, which is the one thing corrections
    // are for. The exception is documented rather than incidental.
    const service = codeOf("lib/services/attendanceCorrection.service.ts");
    const raw = readFileSync(
      join(process.cwd(), "lib/services/attendanceCorrection.service.ts"),
      "utf8"
    );

    assert.ok(
      !/assertWritable/.test(service),
      "the correction path must not consult the lock"
    );
    assert.match(
      raw,
      /never be corrected/,
      "the exception must be explained where a reader will find it"
    );
  });
});

describe("Attendance corrections — one pending request per record", () => {
  it("is enforced by a PARTIAL unique index, not a plain one", () => {
    // A plain UNIQUE on attendanceId would forbid a second correction after the
    // first was decided, which is wrong — a register may be corrected twice.
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260904000000_attendance_correction_request/migration.sql"
      ),
      "utf8"
    );

    assert.match(migration, /CREATE UNIQUE INDEX[\s\S]{0,200}?WHERE "status" = 'PENDING'/);
  });

  it("the service turns the violation into a readable conflict", () => {
    const service = codeOf("lib/services/attendanceCorrection.service.ts");

    assert.match(service, /UNIQUE_VIOLATION/);
    assert.match(service, /ALREADY_PENDING/);
  });
});

describe("Attendance corrections — audit", () => {
  it("records all three transitions", () => {
    const audit = codeOf("lib/constants/audit.ts");

    for (const action of [
      "ATTENDANCE_CORRECTION_REQUESTED",
      "ATTENDANCE_CORRECTION_APPROVED",
      "ATTENDANCE_CORRECTION_REJECTED",
    ]) {
      assert.match(audit, new RegExp(action), `${action} must be a registered audit action`);
    }

    assert.match(audit, /ATTENDANCE_CORRECTION: "ATTENDANCE_CORRECTION"/);
  });

  it("writes the audit entry inside the same transaction as the change", () => {
    // An audit entry surviving a rolled back correction would say the register
    // was changed when it was not.
    const service = codeOf("lib/services/attendanceCorrection.service.ts");

    assert.match(service, /recordAudit\(\s*\{[\s\S]{0,900}?\},\s*tx\s*\)/);
  });

  it("the audit before/after describe the REGISTER, not the request row", () => {
    const service = codeOf("lib/services/attendanceCorrection.service.ts");
    const start = service.indexOf("export async function reviewCorrection");
    const body = service.slice(start);

    assert.match(body, /before: \{ attendanceId: request\.attendanceId, status: request\.currentStatus \}/);
  });
});

// ============================================================================
// Attendance corrections — the requester's half of the workflow.
//
// The review queue was complete before these existed, but a request nobody can
// raise and an outcome nobody can see is an approval workflow with one end
// missing. Both halves are asserted here because both are easy to lose in a
// refactor of the register screen.
// ============================================================================

describe("Attendance corrections — a requester can actually raise one", () => {
  it("the register screen offers the control", () => {
    // raiseCorrectionAction existed and was tested long before anything called
    // it. A tested action that no screen reaches is not a feature.
    const form = codeOf("app/(university)/attendance/mark/MarkAttendanceForm.tsx");

    assert.match(
      form,
      /RequestCorrectionButton/,
      "the register must offer a way to dispute a mark"
    );

    const button = codeOf("app/(university)/attendance/mark/RequestCorrectionButton.tsx");
    assert.match(button, /raiseCorrectionAction/);
  });

  it("it is offered only for a row that already exists", () => {
    // An unmarked session has nothing to correct — the register is simply
    // taken. Offering it would produce a request against no record.
    const form = codeOf("app/(university)/attendance/mark/MarkAttendanceForm.tsx");

    assert.match(
      form,
      /canRequestCorrection && student\.attendanceId &&/,
      "the control needs both the permission and an existing attendance row"
    );
  });

  it("both register screens pass the attendance id through", () => {
    // The faculty portal renders the SAME form. If either page stops carrying
    // the row id, the control silently disappears on that screen only.
    for (const path of [
      "app/(university)/attendance/mark/page.tsx",
      "app/(portals)/faculty/attendance/mark/page.tsx",
    ]) {
      const page = codeOf(path);
      assert.match(page, /attendanceId: existingByStudent\.get\(/, `${path} must pass the row id`);
      assert.match(
        page,
        /ATTENDANCE_CORRECTION_REQUEST_ROLES/,
        `${path} must gate the control on the same set the POST route enforces`
      );
    }
  });

  it("the dispute is about the PERSISTED mark, not the unsaved toggle", () => {
    // statuses[] is local form state a lecturer may have changed on screen.
    // Sending that as currentStatus would record a correction from a value the
    // register never held.
    const form = codeOf("app/(university)/attendance/mark/MarkAttendanceForm.tsx");
    const start = form.indexOf("<RequestCorrectionButton");
    const block = form.slice(start, form.indexOf("/>", start));

    assert.match(block, /currentStatus=\{student\.status\}/);
    assert.ok(!/statuses\[/.test(block), "must not read the local toggle state");
  });
});

describe("Attendance corrections — a lecturer does not read the university's queue", () => {
  it("the GET route narrows to the caller unless they may review", () => {
    // FACULTY holds read access so they can follow their own request. Left
    // unnarrowed that same access returns every lecturer's disputes — the
    // enrolment numbers, the reasons, and which colleagues mark the register
    // wrongly. That is a staff-conduct record, not one's own corrections.
    const route = codeOf("app/api/attendance/corrections/route.ts");

    assert.match(route, /hasAnyRole\(guard\.session\.roles, ATTENDANCE_CORRECTION_REVIEW_ROLES\)/);
    assert.match(
      route,
      /canReview \? undefined : guard\.session\.sub/,
      "a non-reviewer must be narrowed to their own requests"
    );
  });

  it("the narrowing reaches the query, not just the route", () => {
    const service = codeOf("lib/services/attendanceCorrection.service.ts");
    const start = service.indexOf("export async function listCorrections");
    const body = service.slice(start, service.indexOf("export async function reviewCorrection"));

    assert.match(body, /requestedById === undefined \? \{\} : \{ requestedById \}/);
    // Still tenant-scoped: narrowing by requester must not replace it.
    assert.match(body, /tenantId,/);
  });

  it("faculty have somewhere to see the outcome", () => {
    // /attendance/corrections is under the (university) layout, which redirects
    // FACULTY out. Without a portal page the approval step is invisible to the
    // only person waiting on it.
    const page = codeOf("app/(portals)/faculty/attendance/corrections/page.tsx");

    assert.match(page, /listAttendanceCorrections/);
    assert.ok(
      !/reviewCorrectionAction|CorrectionReviewPanel/.test(page),
      "the portal page must not offer decisions FACULTY cannot make"
    );
    assert.match(page, /reviewNote/, "a rejection's reason is the point of showing it");

    assert.match(
      codeOf("constants/navigation.tsx"),
      /\/faculty\/attendance\/corrections/,
      "and it must be reachable from the faculty sidebar"
    );
  });
});

describe("Attendance corrections — the review page refuses who the API refuses", () => {
  it("a role outside the read set is sent home, not shown an empty page", () => {
    // The (university) layout admits every UNIVERSITY_ROLE, the Controller of
    // Examination included. Before this gate the COE could open the queue and
    // get a fully rendered page whose only content was the API's own refusal —
    // a destination that exists solely to fail, and one the sidebar never
    // offered them.
    const page = codeOf("app/(university)/attendance/corrections/page.tsx");

    assert.match(page, /ATTENDANCE_CORRECTION_READ_ROLES/);
    assert.match(
      page,
      /if \(!hasAnyRole\(session\.roles, ATTENDANCE_CORRECTION_READ_ROLES\)\) \{\s*redirect\(/,
      "an unentitled role must be redirected before the queue is fetched"
    );
  });

  it("the page reads its review set from the shared constant", () => {
    // Respelling the role list on the screen is how a page drifts from the
    // route it is meant to mirror: the buttons say one thing, the API another.
    const page = codeOf("app/(university)/attendance/corrections/page.tsx");

    assert.match(page, /canReview = hasAnyRole\(session\.roles, ATTENDANCE_CORRECTION_REVIEW_ROLES\)/);
    assert.ok(
      !/ROLES\.DEPARTMENT_HOD,\s*ROLES\.HOD,\s*ROLES\.UNIVERSITY_ADMIN/.test(page),
      "the review set must not be respelled inline"
    );
  });
});

describe("Attendance corrections — the control must name the row on screen", () => {
  it("getSessionAttendance narrows to the session it promises", () => {
    // GET /api/attendance deliberately reads no filter, so it answers with the
    // tenant's whole register. Every session of a course carries the same
    // students, so the caller's Map keyed on studentId kept whichever row came
    // last — a DIFFERENT DAY's mark. The register then pre-filled from the
    // wrong session and handed the correction control the wrong attendance id:
    // a lecturer disputing Monday's absence would have raised a request against
    // a mark from three weeks earlier.
    const services = codeOf("services/academics.ts");
    const start = services.indexOf("export async function getSessionAttendance");
    const body = services.slice(start, services.indexOf("export interface MarkAttendanceEntry"));

    assert.match(body, /row\.sectionId === sectionId/);
    assert.match(body, /row\.courseId === courseId/);
    assert.match(
      body,
      /String\(row\.date\)\.slice\(0, 10\) === date/,
      "Attendance.date is @db.Date — only the day it names is comparable"
    );
  });

  it("the list route still reads no filter, so the narrowing cannot be dropped", () => {
    // If the route ever starts filtering, this test is the place that says the
    // client-side narrowing became redundant rather than leaving both in place
    // and neither understood.
    const route = codeOf("app/api/attendance/route.ts");
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));

    assert.ok(
      !/searchParams\.get\("date"\)|where:\s*\{[^}]*date:/.test(get),
      "route now filters by date — revisit the narrowing in getSessionAttendance"
    );
  });
});

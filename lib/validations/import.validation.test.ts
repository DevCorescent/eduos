// ============================================================================
// OWNER  : Gauransh
// MODULE : Initial University Data Import (W1.6 — PRD §5.1 #14, §54, §55)
// LAYER  : Validation + catalogue — Unit Tests
// PURPOSE: Prove the request contract and the per-row contracts.
//
//          The load-bearing assertions are again the NEGATIVE ones: a CSV is an
//          untrusted file from outside the system, and what the schemas REFUSE
//          is what stops a spreadsheet reaching another university's data or
//          writing a column the model does not have.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  courseRowSchema,
  employeeRowSchema,
  facultyRowSchema,
  importRequestSchema,
  programmeRowSchema,
  studentRowSchema,
  MAX_IMPORT_ROWS,
} from "@/lib/validations/import";
import {
  IMPORT_ENTITIES,
  IMPORT_ENTITY_KEYS,
  getImportEntity,
  templateHeaders,
} from "@/lib/constants/importEntities";

describe("importRequestSchema", () => {
  const VALID = { entity: "course", csv: "code,name\nCS1,Intro", mode: "preview" as const };

  it("accepts a preview and a commit", () => {
    assert.equal(importRequestSchema.safeParse(VALID).success, true);
    assert.equal(importRequestSchema.safeParse({ ...VALID, mode: "commit" }).success, true);
  });

  it("REFUSES a tenantId in the body", () => {
    // Strict, and there is no tenant key at all. The tenant comes from the
    // route segment, which is what makes "never trust a tenantId from the
    // client" structural rather than a rule somebody must remember.
    assert.equal(
      importRequestSchema.safeParse({ ...VALID, tenantId: "another_university" }).success,
      false
    );
  });

  it("rejects an unknown entity and an unknown mode", () => {
    // "attendance" is a §54 migration module with a model, but it is NOT an
    // importable entity in W1.6 — so it must not parse.
    assert.equal(importRequestSchema.safeParse({ ...VALID, entity: "attendance" }).success, false);
    assert.equal(importRequestSchema.safeParse({ ...VALID, entity: "user" }).success, false);
    assert.equal(importRequestSchema.safeParse({ ...VALID, mode: "force" }).success, false);
  });

  it("rejects an empty file", () => {
    assert.equal(importRequestSchema.safeParse({ ...VALID, csv: "" }).success, false);
  });
});

describe("courseRowSchema", () => {
  it("accepts a minimal row", () => {
    const result = courseRowSchema.safeParse({ code: "CS101", name: "Intro" });
    assert.equal(result.success, true);
  });

  it("treats a blank optional cell as absent, not as an error", () => {
    // An untouched spreadsheet cell must fall through to the column default.
    const result = courseRowSchema.safeParse({
      code: "CS101",
      name: "Intro",
      type: "",
      credits: "",
      departmentCode: "",
      description: "",
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.type, undefined);
    assert.equal(result.data?.credits, undefined);
  });

  it("upper-cases an enum so 'core' and 'CORE' both parse", () => {
    const result = courseRowSchema.safeParse({ code: "C", name: "N", type: "core" });
    assert.equal(result.success, true);
    assert.equal(result.data?.type, "CORE");
  });

  it("rejects an enum value the model does not define", () => {
    assert.equal(
      courseRowSchema.safeParse({ code: "C", name: "N", type: "WORKSHOP" }).success,
      false
    );
  });

  it("REJECTS a fractional credit rather than truncating it", () => {
    // Silently turning "3.5" into 3 is a corruption nobody would notice.
    assert.equal(courseRowSchema.safeParse({ code: "C", name: "N", credits: "3.5" }).success, false);
    assert.equal(courseRowSchema.safeParse({ code: "C", name: "N", credits: "abc" }).success, false);
  });

  it("requires code and name", () => {
    assert.equal(courseRowSchema.safeParse({ name: "Intro" }).success, false);
    assert.equal(courseRowSchema.safeParse({ code: "  ", name: "Intro" }).success, false);
  });

  it("REFUSES an unknown column", () => {
    // Strict. An unrecognised column usually means the wrong file was exported,
    // and quietly importing the recognised subset would discard data the
    // operator believes they supplied.
    assert.equal(
      courseRowSchema.safeParse({ code: "C", name: "N", tenantId: "other" }).success,
      false
    );
    assert.equal(
      courseRowSchema.safeParse({ code: "C", name: "N", isActive: "true" }).success,
      false
    );
  });
});

describe("programmeRowSchema", () => {
  const VALID = {
    code: "BTECH-CSE",
    name: "B.Tech Computer Science",
    departmentCode: "CSE",
    durationValue: "4",
  };

  it("accepts a valid row and coerces the duration", () => {
    const result = programmeRowSchema.safeParse(VALID);
    assert.equal(result.success, true);
    assert.equal(result.data?.durationValue, 4);
  });

  it("REQUIRES departmentCode, because Programme.departmentId is NOT NULL", () => {
    // The difference from Course is the model's, not a policy choice:
    // Course.departmentId is nullable and Programme's is not.
    assert.equal(
      programmeRowSchema.safeParse({
        code: VALID.code,
        name: VALID.name,
        durationValue: VALID.durationValue,
      }).success,
      false
    );
  });

  it("rejects a non-positive or non-integer duration", () => {
    assert.equal(programmeRowSchema.safeParse({ ...VALID, durationValue: "0" }).success, false);
    assert.equal(programmeRowSchema.safeParse({ ...VALID, durationValue: "4.5" }).success, false);
    assert.equal(programmeRowSchema.safeParse({ ...VALID, durationValue: "" }).success, false);
  });

  it("REFUSES a departmentId — lookups are by CODE, scoped to the tenant", () => {
    // A raw id in a CSV could name another university's department. Only a code
    // is accepted, and the service resolves it within this tenant.
    assert.equal(
      programmeRowSchema.safeParse({ ...VALID, departmentId: "dept_from_elsewhere" }).success,
      false
    );
  });
});

describe("IMPORT_ENTITIES catalogue", () => {
  it("exposes only the five entities W1.6 was scoped to", () => {
    // The §54 modules with no Prisma model — Library records, Alumni records,
    // Financial opening balances — must never appear, and neither may the
    // history modules that W1.6 was explicitly told not to add.
    assert.deepEqual(
      [...IMPORT_ENTITY_KEYS],
      ["course", "programme", "student", "faculty", "employee"]
    );
  });

  it("names a PRD source and a Prisma model for every entity", () => {
    for (const entity of IMPORT_ENTITIES) {
      assert.match(entity.prdSource, /§\d/, `${entity.key} has no PRD source`);
      assert.ok(entity.model.length > 0);
      // The duplicate key must be one of the entity's own columns, or duplicate
      // detection would read a field the file never carries.
      assert.ok(
        entity.columns.some((c) => c.name === entity.duplicateKey),
        `${entity.key} duplicateKey is not a column`
      );
    }
  });

  it("puts required columns first in the template", () => {
    for (const entity of IMPORT_ENTITIES) {
      const headers = templateHeaders(entity);
      const requiredCount = entity.columns.filter((c) => c.required).length;
      const firstNames = headers.slice(0, requiredCount);

      for (const name of firstNames) {
        assert.equal(
          entity.columns.find((c) => c.name === name)?.required,
          true,
          `${entity.key}: ${name} should not lead the template`
        );
      }
      assert.equal(headers.length, entity.columns.length);
    }
  });

  it("resolves a known key and refuses an unknown one", () => {
    assert.ok(getImportEntity("course"));
    assert.ok(getImportEntity("student"));
    assert.equal(getImportEntity("attendance"), undefined);
    assert.equal(getImportEntity("alumni"), undefined);
  });

  it("bounds an import", () => {
    assert.ok(MAX_IMPORT_ROWS > 0 && MAX_IMPORT_ROWS <= 10_000);
  });
});

describe("person row schemas (W1.6 — Student, Faculty, Employee)", () => {
  const STUDENT = {
    firstName: "Asha",
    lastName: "Rao",
    email: "asha.rao@aktu.ac.in",
    admissionDate: "2026-07-01",
  };
  const FACULTY = {
    firstName: "Vikram",
    lastName: "Singh",
    email: "v.singh@aktu.ac.in",
    joinDate: "2020-01-15",
  };
  const EMPLOYEE = {
    firstName: "Meera",
    lastName: "Nair",
    email: "m.nair@aktu.ac.in",
    joinDate: "2019-06-01",
  };

  it("accepts a minimal row for each entity", () => {
    assert.equal(studentRowSchema.safeParse(STUDENT).success, true);
    assert.equal(facultyRowSchema.safeParse(FACULTY).success, true);
    assert.equal(employeeRowSchema.safeParse(EMPLOYEE).success, true);
  });

  it("REJECTS a password column on every person entity", () => {
    // The approved policy is a generated credential. A caller-chosen password
    // in a spreadsheet is refused outright rather than ignored, so an operator
    // learns their file is wrong instead of believing it was honoured.
    for (const [schema, row] of [
      [studentRowSchema, STUDENT],
      [facultyRowSchema, FACULTY],
      [employeeRowSchema, EMPLOYEE],
    ] as const) {
      assert.equal(
        schema.safeParse({ ...row, password: "hunter2hunter2" }).success,
        false,
        "a password column must be refused"
      );
      assert.equal(
        schema.safeParse({ ...row, passwordHash: "$2b$12$x" }).success,
        false,
        "a passwordHash column must be refused"
      );
    }
  });

  it("REFUSES userId and tenantId — both come from the server", () => {
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, userId: "u_1" }).success, false);
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, tenantId: "t_1" }).success, false);
    assert.equal(facultyRowSchema.safeParse({ ...FACULTY, userId: "u_1" }).success, false);
    assert.equal(employeeRowSchema.safeParse({ ...EMPLOYEE, userId: "u_1" }).success, false);
  });

  it("lowercases the email, matching User's per-tenant uniqueness", () => {
    const result = studentRowSchema.safeParse({ ...STUDENT, email: "Asha.RAO@AKTU.ac.in" });
    assert.equal(result.success, true);
    assert.equal(result.data?.email, "asha.rao@aktu.ac.in");
  });

  it("requires the model's non-null date and rejects a non-date", () => {
    // z.coerce.date() would turn "not-a-date" into the epoch (TD-002). A
    // student silently admitted on 1970-01-01 survives for years.
    assert.equal(
      studentRowSchema.safeParse({
        firstName: STUDENT.firstName,
        lastName: STUDENT.lastName,
        email: STUDENT.email,
      }).success,
      false
    );
    assert.equal(
      studentRowSchema.safeParse({ ...STUDENT, admissionDate: "not-a-date" }).success,
      false
    );
    assert.equal(facultyRowSchema.safeParse({ ...FACULTY, joinDate: "" }).success, false);
  });

  it("treats an omitted identifier as absent, so the engine can issue one", () => {
    // PRD §9 — POST /api/students already behaves this way; import matches it.
    const student = studentRowSchema.safeParse({ ...STUDENT, enrollmentNo: "" });
    assert.equal(student.success, true);
    assert.equal(student.data?.enrollmentNo, undefined);

    const faculty = facultyRowSchema.safeParse({ ...FACULTY, employeeId: "" });
    assert.equal(faculty.success, true);
    assert.equal(faculty.data?.employeeId, undefined);
  });

  it("preserves a supplied legacy identifier exactly", () => {
    const result = studentRowSchema.safeParse({ ...STUDENT, enrollmentNo: "AKTU/2019/0042" });
    assert.equal(result.data?.enrollmentNo, "AKTU/2019/0042");
  });

  it("validates the enums each model defines", () => {
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, status: "graduated" }).success, true);
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, status: "ALUMNI" }).success, false);
    assert.equal(employeeRowSchema.safeParse({ ...EMPLOYEE, type: "teaching" }).success, true);
    assert.equal(employeeRowSchema.safeParse({ ...EMPLOYEE, type: "INTERN" }).success, false);
  });
});

describe("W1.6 person entities in the catalogue", () => {
  it("now exposes all five scoped entities", () => {
    assert.deepEqual(
      [...IMPORT_ENTITY_KEYS],
      ["course", "programme", "student", "faculty", "employee"]
    );
  });

  it("marks exactly the person entities as user-creating", () => {
    const creating = IMPORT_ENTITIES.filter((e) => e.createsUser).map((e) => e.key);
    assert.deepEqual(creating, ["student", "faculty", "employee"]);
  });

  it("keys people on email, not on their identifier", () => {
    // A migration file may omit enrollmentNo entirely, so it cannot be the
    // re-import key. The address is always present and unique per tenant.
    for (const key of ["student", "faculty", "employee"]) {
      assert.equal(getImportEntity(key)?.duplicateKey, "email");
    }
  });

  it("names only identifier types the engine actually issues", () => {
    // IDENTIFIER_ENTITIES is STUDENT, FACULTY, EMPLOYEE, CERTIFICATE.
    const supported = new Set(["STUDENT", "FACULTY", "EMPLOYEE"]);
    for (const entity of IMPORT_ENTITIES) {
      if (!entity.createsUser) continue;
      assert.ok(
        entity.identifierEntity && supported.has(entity.identifierEntity),
        `${entity.key} names an identifier type the engine cannot issue`
      );
      assert.ok(
        entity.columns.some((c) => c.name === entity.identifierColumn),
        `${entity.key} identifierColumn is not one of its columns`
      );
    }
  });

  it("never lists a password column in any template", () => {
    for (const entity of IMPORT_ENTITIES) {
      for (const column of entity.columns) {
        assert.ok(
          !/password/i.test(column.name),
          `${entity.key} must not offer a ${column.name} column`
        );
      }
    }
  });
});

describe("TD-W16-4 — role assignment on person import", () => {
  it("grants STUDENT to students and FACULTY to faculty", () => {
    assert.equal(getImportEntity("student")?.roleName, "STUDENT");
    assert.equal(getImportEntity("faculty")?.roleName, "FACULTY");
  });

  it("grants NO role to employees, because none exists", () => {
    // The enforced vocabulary is SUPER_ADMIN, UNIVERSITY_ADMIN, FACULTY and
    // STUDENT; the wider list adds CAMPUS_ADMIN, HOD, DEPARTMENT_HOD,
    // CONTROLLER_OF_EXAMINATION and PARENT. None describes a non-teaching
    // employee, and homeRouteForRoles routes none of them to an employee
    // portal — because no employee portal exists. Granting one of the others
    // would hand a clerk a portal they have no business in.
    assert.equal(getImportEntity("employee")?.roleName, undefined);
  });

  it("grants no role to entities that create no user", () => {
    assert.equal(getImportEntity("course")?.roleName, undefined);
    assert.equal(getImportEntity("programme")?.roleName, undefined);
  });

  it("only ever names roles the product actually enforces", () => {
    // A role name nothing compares against would grant nothing while looking
    // as though it did.
    const enforced = new Set(["STUDENT", "FACULTY"]);
    for (const entity of IMPORT_ENTITIES) {
      if (!entity.roleName) continue;
      assert.ok(
        enforced.has(entity.roleName),
        `${entity.key} names ${entity.roleName}, which no guard compares on`
      );
    }
  });

  it("never lets a file choose a role", () => {
    // Rule 6: no role name from CSV. The schemas are strict and define no role
    // column, so a file supplying one is refused rather than ignored.
    const STUDENT = {
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@w16.test",
      admissionDate: "2026-07-01",
    };
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, role: "UNIVERSITY_ADMIN" }).success, false);
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, roleName: "FACULTY" }).success, false);
    assert.equal(studentRowSchema.safeParse({ ...STUDENT, roleId: "role_1" }).success, false);

    const FACULTY = {
      firstName: "Vikram",
      lastName: "Singh",
      email: "v@w16.test",
      joinDate: "2020-01-15",
    };
    assert.equal(facultyRowSchema.safeParse({ ...FACULTY, role: "SUPER_ADMIN" }).success, false);

    for (const entity of IMPORT_ENTITIES) {
      for (const column of entity.columns) {
        assert.ok(
          !/^role/i.test(column.name),
          `${entity.key} must not offer a ${column.name} column`
        );
      }
    }
  });
});

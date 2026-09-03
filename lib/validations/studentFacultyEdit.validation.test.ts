// ============================================================================
// TESTS: editing a record without changing it — tester issues #25, #26, #27.
//
// #25 THE DEFECT
//   updateStudentAction sends "" for a blank select, and says in its own
//   comment that "" means "unset this". Nothing implemented that: the update
//   schema is createStudentSchema.partial(), and there programmeId, batchId and
//   sectionId are `min(1)`. `.partial()` makes a key optional, but a key that
//   IS present must still satisfy the rule — so an explicit "" was rejected.
//
//   Opening a student whose programme, batch and section were empty and
//   pressing Save unchanged therefore sent three empty strings and got
//   400 "Invalid input". The same defect was confirmed on Edit Faculty, whose
//   action sends departmentId the same way.
//
// THE CONTRACT THESE PIN
//   undefined  leave the column unchanged
//   ""         clear the column to null
//   an id      point the column at that row
//
//   All three states matter. Collapsing "" into undefined would make a cleared
//   select silently keep its old value, which is a worse bug than the 400.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStudentSchema, updateStudentSchema } from "./student";
import { createFacultySchema, updateFacultySchema, facultyQuerySchema } from "./faculty";

const studentRoute = readFileSync(
  join(process.cwd(), "app/api/students/[id]/route.ts"),
  "utf8"
);
const facultyIdRoute = readFileSync(
  join(process.cwd(), "app/api/faculty/[id]/route.ts"),
  "utf8"
);
const facultyRoute = readFileSync(join(process.cwd(), "app/api/faculty/route.ts"), "utf8");
const facultyPage = readFileSync(
  join(process.cwd(), "app/(university)/faculty/page.tsx"),
  "utf8"
);

/** The payload the Edit modal sends for a student with every select blank. */
const UNCHANGED_BLANK = {
  enrollmentNo: "STU-2025-001",
  programmeId: "",
  batchId: "",
  sectionId: "",
};

describe("#25 — Student edit accepts a blank nullable reference", () => {
  it("accepts the unchanged-save payload that used to 400", () => {
    // The tester's exact scenario, as one assertion.
    const parsed = updateStudentSchema.safeParse(UNCHANGED_BLANK);

    assert.ok(parsed.success, "an unchanged save must not be a validation error");
  });

  it('turns "" into null, which is what clears the column', () => {
    const parsed = updateStudentSchema.safeParse(UNCHANGED_BLANK);
    assert.ok(parsed.success);

    assert.equal(parsed.data.programmeId, null);
    assert.equal(parsed.data.batchId, null);
    assert.equal(parsed.data.sectionId, null);
  });

  it("leaves an omitted key absent, so the column is not touched", () => {
    // The distinction the route depends on: undefined and null must not
    // collapse into one another.
    const parsed = updateStudentSchema.safeParse({ enrollmentNo: "STU-2025-001" });
    assert.ok(parsed.success);

    assert.equal("programmeId" in parsed.data, false);
    assert.equal(parsed.data.programmeId, undefined);
  });

  it("passes a real id through unchanged", () => {
    const parsed = updateStudentSchema.safeParse({
      programmeId: "cms8o8z2p000d2tu7a0vsrio1",
      batchId: "  cms8o90iz000g2tu7wm4jhgo6  ",
    });
    assert.ok(parsed.success);

    assert.equal(parsed.data.programmeId, "cms8o8z2p000d2tu7a0vsrio1");
    assert.equal(parsed.data.batchId, "cms8o90iz000g2tu7wm4jhgo6", "still trimmed");
  });

  it("covers specialisationId too", () => {
    const parsed = updateStudentSchema.safeParse({ specialisationId: "" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.specialisationId, null);
  });

  it("still refuses a completely empty body", () => {
    // Unchanged behaviour: an empty PATCH is a client error, not a no-op that
    // would still advance updatedAt.
    assert.equal(updateStudentSchema.safeParse({}).success, false);
  });

  it("does NOT loosen creation — a blank reference on create is still refused", () => {
    // Creating a student with programmeId: "" is meaningless. Only an edit can
    // clear a value that is already there.
    const base = { userId: "u1", admissionDate: "2026-01-15" };

    assert.equal(createStudentSchema.safeParse({ ...base, programmeId: "" }).success, false);
    assert.equal(createStudentSchema.safeParse(base).success, true);
  });
});

describe("#25 — Faculty edit accepts a blank department", () => {
  it("accepts the unchanged-save payload that used to 400", () => {
    const parsed = updateFacultySchema.safeParse({ departmentId: "" });

    assert.ok(parsed.success, "an unchanged save must not be a validation error");
    assert.equal(parsed.data.departmentId, null);
  });

  it("leaves an omitted department unchanged", () => {
    const parsed = updateFacultySchema.safeParse({ designation: "Professor" });
    assert.ok(parsed.success);
    assert.equal("departmentId" in parsed.data, false);
  });

  it("passes a real department id through", () => {
    const parsed = updateFacultySchema.safeParse({ departmentId: "cms8o8y0e000c2tu74gna89dg" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.departmentId, "cms8o8y0e000c2tu74gna89dg");
  });

  it("does NOT loosen faculty creation", () => {
    const base = { userId: "u1", joinDate: "2026-01-15" };

    assert.equal(createFacultySchema.safeParse({ ...base, departmentId: "" }).success, false);
    assert.equal(createFacultySchema.safeParse(base).success, true);
  });
});

describe("#25 — clearing a reference does not ask the database for a null row", () => {
  it("the student route checks existence only for a real id", () => {
    // With `!== undefined` a clear would look up `id: null`, find nothing and
    // answer "Programme not found" for a request that named no programme.
    for (const field of ["programmeId", "batchId", "sectionId", "specialisationId"]) {
      assert.match(
        studentRoute,
        new RegExp(`typeof input\\.${field} === "string"`),
        `${field} must gate its existence check on a string`
      );
    }
  });

  it("the faculty route does the same for departmentId", () => {
    assert.match(facultyIdRoute, /typeof input\.departmentId === "string"/);
  });

  it("both routes still write the parsed input straight through", () => {
    // That is what carries the null to Prisma and actually clears the column.
    assert.match(studentRoute, /data: input,/);
    assert.match(facultyIdRoute, /data: input,/);
  });
});

describe("#26 — the faculty listing query accepts what the screen sends", () => {
  it("accepts q, status and departmentId", () => {
    const parsed = facultyQuerySchema.safeParse({
      q: "meera",
      status: "ACTIVE",
      departmentId: "dept_1",
    });

    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "meera");
    assert.equal(parsed.data.status, "ACTIVE");
    assert.equal(parsed.data.departmentId, "dept_1");
  });

  it("treats an empty value as no filter, which is what the reset writes", () => {
    const parsed = facultyQuerySchema.safeParse({ q: "", status: "", departmentId: "" });

    assert.ok(parsed.success, "an empty filter must not be a 400");
    assert.equal(parsed.data.q, undefined);
    assert.equal(parsed.data.status, undefined);
    assert.equal(parsed.data.departmentId, undefined);
  });

  it("still refuses a status that is not an EmployeeStatus", () => {
    assert.equal(facultyQuerySchema.safeParse({ status: "NOT_A_STATUS" }).success, false);
  });

  it("keeps the shared pagination contract", () => {
    const parsed = facultyQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(typeof parsed.data.page, "number");
    assert.equal(typeof parsed.data.limit, "number");
  });
});

describe("#26 — the route applies them, and cannot be used to widen a head's scope", () => {
  it("reads all three out of the validated query", () => {
    assert.match(facultyRoute, /const \{ page, limit, q, status, departmentId \} = parsed\.data;/);
  });

  it("searches name, employee ID, designation and address, case-insensitively", () => {
    for (const field of [
      "employeeId",
      "designation",
      "user: \\{ firstName",
      "user: \\{ lastName",
      "user: \\{ email",
    ]) {
      assert.match(facultyRoute, new RegExp(field), `q must cover ${field}`);
    }
    assert.match(facultyRoute, /mode: "insensitive"/);
  });

  it("splits the term so a full name typed in one box matches", () => {
    // FacultyMember has no name column and Prisma cannot concatenate two, so a
    // plain OR would match "Meera" and "Iyer" but never "Meera Iyer".
    assert.match(facultyRoute, /q\.split\(\/\\s\+\/\)/);
    assert.match(facultyRoute, /AND: terms\.map/);
  });

  it("INTERSECTS the client department filter with the head's restriction", () => {
    // The trap: two spreads both setting `departmentId` do not combine — the
    // later replaces the earlier, so a head could name another department and
    // read it. The restriction must survive.
    assert.match(facultyRoute, /const departmentWhere/);
    assert.match(facultyRoute, /departmentId === scope\.scope\.departmentId/);
    assert.match(facultyRoute, /\{ in: \[\] \}/, "an out-of-scope filter must match nothing");

    // And the composed where must not spread a bare departmentId afterwards.
    const whereBlock = facultyRoute.slice(
      facultyRoute.indexOf("const where: Prisma.FacultyMemberWhereInput"),
      facultyRoute.indexOf("};", facultyRoute.indexOf("const where: Prisma.FacultyMemberWhereInput"))
    );
    assert.ok(
      !/\.\.\.\(departmentId \? \{ departmentId \}/.test(whereBlock),
      "departmentId must not be spread beside the restriction"
    );
    assert.match(whereBlock, /\.\.\.departmentWhere/);
  });

  it("keeps the tenant predicate leading and shares one where with the count", () => {
    const whereBlock = facultyRoute.slice(
      facultyRoute.indexOf("const where: Prisma.FacultyMemberWhereInput")
    );

    assert.match(whereBlock, /tenantId: tenant\.id/);
    assert.match(facultyRoute, /prisma\.facultyMember\.count\(\{ where \}\)/);
  });
});

describe("#26 / #27 — the Faculty screen", () => {
  it("no longer renders its search and filters disabled", () => {
    assert.ok(
      !/unsupported=/.test(facultyPage),
      "the controls must be live now that the API accepts the parameters"
    );
  });

  it("still sends the same three parameters and carries them through pagination", () => {
    assert.match(facultyPage, /listFaculty\(\{ page: currentPage, limit: PAGE_SIZE, q, status, departmentId \}\)/);

    const pagination = facultyPage.slice(facultyPage.indexOf("searchParams={{"));
    for (const key of ["q", "status", "departmentId"]) {
      assert.ok(pagination.includes(key), `pagination must carry ${key}`);
    }
  });

  it("#27 — the phone field is a tel field, so the message lands beside it", () => {
    // The API already refuses an invalid number through the shared rule; this
    // is what stops the refusal arriving as a banner naming no field.
    assert.match(facultyPage, /kind: "tel", name: "phone"/);
  });
});

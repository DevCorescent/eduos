// ============================================================================
// TESTS: Employee listing query and filters (tester issue #28).
//
// THE DEFECT
//   The tester reported that neither the search box nor any filter on the
//   Employees page changed the results. employeeQuerySchema was
//   `paginationQuerySchema`, so Zod dropped ?q, ?status, ?type and
//   ?departmentId before the handler saw them, and the route read every
//   employee in the tenant. The controls were rendered disabled with an
//   explanation for exactly that reason.
//
//   It is the same defect that produced tester issues #22 (batches), #23
//   (students) and #26 (faculty), and it is pinned here the same way those are.
//
// WHAT IS ASSERTED WHERE
//   The schema is exercised directly. The route reaches a database and this
//   suite has none — see package.json — so its guarantees are pinned as source
//   contracts, and the behaviours that need real rows are covered by live
//   verification against the API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { employeeQuerySchema } from "./employee";

const route = readFileSync(join(process.cwd(), "app/api/employees/route.ts"), "utf8");
const page = readFileSync(
  join(process.cwd(), "app/(university)/employees/page.tsx"),
  "utf8"
);

describe("#28 — the query schema accepts what the screen sends", () => {
  it("accepts q", () => {
    const parsed = employeeQuerySchema.safeParse({ q: "asha" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "asha");
  });

  it("accepts a valid status", () => {
    const parsed = employeeQuerySchema.safeParse({ status: "ACTIVE" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.status, "ACTIVE");
  });

  it("accepts a valid type", () => {
    const parsed = employeeQuerySchema.safeParse({ type: "NON_TEACHING" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.type, "NON_TEACHING");
  });

  it("accepts departmentId", () => {
    const parsed = employeeQuerySchema.safeParse({ departmentId: "dept_1" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.departmentId, "dept_1");
  });

  it("accepts all four together", () => {
    const parsed = employeeQuerySchema.safeParse({
      q: "asha",
      status: "ACTIVE",
      type: "TEACHING",
      departmentId: "dept_1",
    });
    assert.ok(parsed.success);
  });

  it('treats "" as no filter, which is what every reset writes', () => {
    // "All statuses", "All types" and "All departments" write an empty value,
    // and so does a hand-edited or bookmarked "?status=".
    const parsed = employeeQuerySchema.safeParse({
      q: "",
      status: "",
      type: "",
      departmentId: "",
    });

    assert.ok(parsed.success, "an empty filter must not be a 400");
    assert.equal(parsed.data.q, undefined);
    assert.equal(parsed.data.status, undefined);
    assert.equal(parsed.data.type, undefined);
    assert.equal(parsed.data.departmentId, undefined);
  });

  it("REFUSES a status that is not an EmployeeStatus", () => {
    assert.equal(employeeQuerySchema.safeParse({ status: "NOT_A_STATUS" }).success, false);
  });

  it("REFUSES a type that is not an EmployeeType", () => {
    assert.equal(employeeQuerySchema.safeParse({ type: "NOT_A_TYPE" }).success, false);
  });

  it("keeps the shared pagination contract", () => {
    const parsed = employeeQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(typeof parsed.data.page, "number");
    assert.equal(typeof parsed.data.limit, "number");
  });

  it("accepts every value of both enums", () => {
    // If either enum grows, the filter must keep working for the new member
    // rather than start answering 400 for a value the UI offers.
    for (const status of ["ACTIVE", "INACTIVE", "ON_LEAVE", "TERMINATED", "RETIRED"]) {
      assert.ok(employeeQuerySchema.safeParse({ status }).success, status);
    }
    for (const type of ["TEACHING", "NON_TEACHING", "VISITING", "ADJUNCT", "CONTRACT"]) {
      assert.ok(employeeQuerySchema.safeParse({ type }).success, type);
    }
  });
});

describe("#28 — the route reads and applies them", () => {
  it("destructures all four out of the validated query", () => {
    assert.match(
      route,
      /const \{ page, limit, q, status, type, departmentId \} = parsed\.data;/
    );
  });

  it("searches employee ID, designation, name and address", () => {
    for (const field of [
      "employeeId",
      "designation",
      "user: \\{ firstName",
      "user: \\{ lastName",
      "user: \\{ email",
    ]) {
      assert.match(route, new RegExp(field), `q must cover ${field}`);
    }
  });

  it("searches case-insensitively with contains, not equality", () => {
    assert.match(route, /mode: "insensitive"/);
    assert.match(route, /contains: term/);
  });

  it("splits the term so a full name typed in one box matches in any order", () => {
    // Employee has no name column and Prisma cannot concatenate two, so a plain
    // OR would match "Asha" and "Rao" but never "Asha Rao".
    assert.match(route, /q\.split\(\/\\s\+\/\)/);
    assert.match(route, /AND: terms\.map/);
  });

  it("filters status, type and departmentId", () => {
    assert.match(route, /\.\.\.\(status \? \{ status \} : \{\}\)/);
    assert.match(route, /\.\.\.\(type \? \{ type \} : \{\}\)/);
    assert.match(route, /\.\.\.\(departmentId \? \{ departmentId \} : \{\}\)/);
  });

  it("filters departmentId by direct equality, inventing no relation", () => {
    // Employee.departmentId is a plain nullable scalar with no Prisma relation,
    // unlike FacultyMember.departmentId. A nested relation filter would not
    // even compile against this model.
    assert.ok(
      !/department: \{/.test(route),
      "there is no department relation on Employee to traverse"
    );
  });

  it("leads with the tenant predicate and never reads a client tenantId", () => {
    const whereBlock = route.slice(
      route.indexOf("const where: Prisma.EmployeeWhereInput"),
      route.indexOf("};", route.indexOf("const where: Prisma.EmployeeWhereInput"))
    );

    assert.match(whereBlock, /tenantId: tenant\.id/);
    assert.ok(
      !/tenantId: (parsed|input|query)/.test(route),
      "the tenant must come from the session, never the query string"
    );
  });

  it("uses ONE where for both the page and the count", () => {
    // A count taken over a wider predicate than the rows would report a total
    // the filtered list cannot reach, and paginate into empty pages.
    assert.match(route, /prisma\.employee\.findMany\(\{\s*where,/);
    assert.match(route, /prisma\.employee\.count\(\{ where \}\)/);
  });
});

describe("#28 — the Employees screen", () => {
  it("no longer renders its search and filters disabled", () => {
    assert.ok(
      !/unsupported=/.test(page),
      "the controls must be live now that the API accepts the parameters"
    );
    assert.ok(!/UNSUPPORTED_/.test(page), "the disabled-state constants are gone");
  });

  it("still sends the same four parameters", () => {
    assert.match(
      page,
      /listEmployees\(\{ page: currentPage, limit: PAGE_SIZE, q, status, type, departmentId \}\)/
    );
  });

  it("still carries all four through pagination", () => {
    const pagination = page.slice(page.indexOf("searchParams={{"));

    for (const key of ["q", "status", "type", "departmentId"]) {
      assert.ok(pagination.includes(key), `pagination must carry ${key}`);
    }
  });

  it("keeps its existing placeholder and all three filters", () => {
    assert.match(page, /Search by name, ID or designation/);
    assert.match(page, /paramKey="status"/);
    assert.match(page, /paramKey="type"/);
    assert.match(page, /paramKey="departmentId"/);
  });
});

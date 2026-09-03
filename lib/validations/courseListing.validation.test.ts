// ============================================================================
// TESTS: Course listing query and filters (tester issue #30).
//
// THE DEFECT
//   The tester reported that neither the search box nor either filter on the
//   Courses page changed the results. courseQuerySchema was
//   `paginationQuerySchema`, so Zod dropped ?q, ?departmentId and ?type before
//   the handler saw them, and the route read every course in the tenant — a
//   search for "ZZZNOPE" returned all four demo courses. The controls were
//   rendered disabled with an explanation for exactly that reason.
//
//   Same defect as tester issues #22 (batches), #23 (students), #26 (faculty)
//   and #28 (employees), and pinned here the same way.
//
// THE PART THAT IS NOT ROUTINE
//   Unlike the employees listing, this route ALREADY narrows a DEPARTMENT_HOD
//   to their own department. That restriction and a caller-supplied
//   ?departmentId constrain the same column, so they are composed in one AND
//   array rather than spread side by side — spread, the second would replace
//   the first and a head could read another department. The assertions below
//   are what stop that being "simplified" back into a spread.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { courseQuerySchema } from "./course";

const route = readFileSync(join(process.cwd(), "app/api/courses/route.ts"), "utf8");
const page = readFileSync(
  join(process.cwd(), "app/(university)/curriculum/courses/page.tsx"),
  "utf8"
);

describe("#30 — the query schema accepts what the screen sends", () => {
  it("accepts q", () => {
    const parsed = courseQuerySchema.safeParse({ q: "CS101" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "CS101");
  });

  it("accepts departmentId", () => {
    const parsed = courseQuerySchema.safeParse({ departmentId: "dept_1" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.departmentId, "dept_1");
  });

  it("accepts every valid CourseType", () => {
    for (const type of ["CORE", "ELECTIVE", "AUDIT", "LAB", "PROJECT", "SEMINAR"]) {
      const parsed = courseQuerySchema.safeParse({ type });
      assert.ok(parsed.success, type);
      assert.equal(parsed.data.type, type);
    }
  });

  it("REFUSES a type that is not a CourseType", () => {
    // Previously ignored in silence, which is why the tester saw an invalid
    // type change nothing at all.
    assert.equal(courseQuerySchema.safeParse({ type: "NOT_A_TYPE" }).success, false);
    assert.equal(courseQuerySchema.safeParse({ type: "core" }).success, false);
  });

  it('treats "" as no filter, which is what every reset writes', () => {
    const parsed = courseQuerySchema.safeParse({ q: "", departmentId: "", type: "" });

    assert.ok(parsed.success, "an empty filter must not be a 400");
    assert.equal(parsed.data.q, undefined);
    assert.equal(parsed.data.departmentId, undefined);
    assert.equal(parsed.data.type, undefined);
  });

  it("accepts all three together", () => {
    const parsed = courseQuerySchema.safeParse({
      q: "intro",
      departmentId: "dept_1",
      type: "CORE",
    });
    assert.ok(parsed.success);
  });

  it("keeps the shared pagination contract", () => {
    const parsed = courseQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(typeof parsed.data.page, "number");
    assert.equal(typeof parsed.data.limit, "number");
  });

  it("still defines no ?isActive filter", () => {
    // The column exists but the screen offers no control for it. Accepting a
    // parameter nothing sends would be a capability with no caller.
    const parsed = courseQuerySchema.safeParse({ isActive: "true" });
    assert.ok(parsed.success);
    assert.equal("isActive" in parsed.data, false);
  });
});

describe("#30 — the route reads and applies them", () => {
  it("destructures all three out of the validated query", () => {
    assert.match(route, /const \{ page, limit, q, departmentId, type \} = parsed\.data;/);
  });

  it("searches name and code, case-insensitively, with contains", () => {
    assert.match(route, /name: \{ contains: term, mode: "insensitive" as const \}/);
    assert.match(route, /code: \{ contains: term, mode: "insensitive" as const \}/);
  });

  it("searches ONLY name and code — Course has no person to search", () => {
    // Course carries no user relation; inventing one would not compile, and
    // searching description or syllabus was never what the placeholder offered.
    assert.ok(!/user: \{/.test(route), "Course has no user relation");
    assert.ok(!/syllabus: \{ contains/.test(route), "syllabus is not a search field");
  });

  it("splits the term so every word must match somewhere", () => {
    assert.match(route, /q\.split\(\/\\s\+\/\)/);
    assert.match(route, /terms\.map\(\(term\) => \(\{/);
  });

  it("filters type as a direct equality", () => {
    assert.match(route, /\.\.\.\(type \? \{ type \} : \{\}\)/);
  });
});

describe("#30 — a head cannot escape their department through ?departmentId", () => {
  it("keeps the restriction derived from the authenticated identity", () => {
    assert.match(route, /const scope = await resolveDepartmentScope\(guard\.session\)/);
    assert.match(route, /if \(!scope\.ok\) return scope\.response/);
  });

  it("composes the restriction and the client filter in ONE AND, not two spreads", () => {
    // The whole security property. Two object keys both named departmentId do
    // not combine — the later replaces the earlier — so a head passing another
    // department's id would read it. As AND entries both must hold, and no
    // course can carry two different departmentIds, so the answer is empty.
    const whereBlock = route.slice(
      route.indexOf("const where: Prisma.CourseWhereInput"),
      route.indexOf("\n    };", route.indexOf("const where: Prisma.CourseWhereInput"))
    );

    assert.match(whereBlock, /AND: \[/);
    assert.match(
      whereBlock,
      /scope\.scope\.restricted \? \{ departmentId: scope\.scope\.departmentId \} : \{\}/
    );
    assert.match(whereBlock, /\.\.\.\(departmentId \? \[\{ departmentId \}\] : \[\]\)/);

    // And the client filter must NOT also appear as a bare spread key, which is
    // what would silently overwrite the restriction.
    assert.ok(
      !/\.\.\.\(departmentId \? \{ departmentId \} : \{\}\)/.test(whereBlock),
      "departmentId must not be spread beside the restriction"
    );
  });

  it("leads with the tenant predicate and reads no client tenantId", () => {
    const whereBlock = route.slice(route.indexOf("const where: Prisma.CourseWhereInput"));

    assert.match(whereBlock, /tenantId: tenant\.id/);
    assert.ok(
      !/tenantId: (parsed|input|query)/.test(route),
      "the tenant must come from the session, never the query string"
    );
  });

  it("uses ONE where for both the page and the count", () => {
    assert.match(route, /prisma\.course\.findMany\(\{\s*where,/);
    assert.match(route, /prisma\.course\.count\(\{ where \}\)/);
  });
});

describe("#30 — the Courses screen", () => {
  it("no longer renders its search and filters disabled", () => {
    assert.ok(!/unsupported=/.test(page), "the controls must be live");
    assert.ok(!/UNSUPPORTED_/.test(page), "the disabled-state constants are gone");
  });

  it("still sends the same three parameters", () => {
    assert.match(
      page,
      /listCourses\(\{ page: currentPage, limit: PAGE_SIZE, q, departmentId, type \}\)/
    );
  });

  it("still carries all three through pagination", () => {
    const pagination = page.slice(page.indexOf("searchParams={{"));

    for (const key of ["q", "departmentId", "type"]) {
      assert.ok(pagination.includes(key), `pagination must carry ${key}`);
    }
  });

  it("keeps its existing placeholder and both filters", () => {
    assert.match(page, /Search by name or code/);
    assert.match(page, /paramKey="departmentId"/);
    assert.match(page, /paramKey="type"/);
  });
});

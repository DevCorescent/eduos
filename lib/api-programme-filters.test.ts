// ============================================================================
// TESTS: Programme listing filters — tester issue #21.
//
// THE COMPLAINT
//   "Search, All Campuses and All Schools are not working on the Programmes
//   page." Search had since been fixed; the two filters had not, because the
//   page offered Department and Type instead. Those are useful filters, but
//   they are not the ones the tester asked for and their presence was not a
//   fix for their absence.
//
// WHY A PROGRAMME CAN BE FILTERED BY SOMETHING IT DOES NOT STORE
//   Programme has departmentId and nothing else of the hierarchy. Department
//   carries campusId (required) and schoolId (nullable). So campus and school
//   are real, answerable questions about a programme — they are just one hop
//   away, and the filter has to travel that hop rather than being denormalised
//   onto Programme or faked in the UI.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listProgrammesQuerySchema } from "./validations/programme";

const route = readFileSync(join(process.cwd(), "app/api/programmes/route.ts"), "utf8");
const page = readFileSync(
  join(process.cwd(), "app/(university)/setup/programmes/page.tsx"),
  "utf8"
);

describe("listProgrammesQuerySchema accepts the filters the toolbar sends", () => {
  it("accepts campusId and schoolId", () => {
    // The exact reason the controls did nothing on the pages where this was
    // wrong: Zod dropped the key before the handler could read it, so the
    // request was indistinguishable from an unfiltered one.
    const parsed = listProgrammesQuerySchema.safeParse({
      campusId: "campus_1",
      schoolId: "school_1",
    });

    assert.ok(parsed.success);
    assert.equal(parsed.data.campusId, "campus_1");
    assert.equal(parsed.data.schoolId, "school_1");
  });

  it("treats an empty value as no filter, which is what 'All …' means", () => {
    const parsed = listProgrammesQuerySchema.safeParse({ campusId: "", schoolId: "" });

    assert.ok(parsed.success);
    assert.equal(parsed.data.campusId, undefined);
    assert.equal(parsed.data.schoolId, undefined);
  });

  it("keeps the existing departmentId and type filters", () => {
    // They were not the tester's complaint and removing them to make room
    // would trade one missing filter for another.
    const parsed = listProgrammesQuerySchema.safeParse({
      departmentId: "dept_1",
      type: "UNDERGRADUATE",
    });

    assert.ok(parsed.success);
    assert.equal(parsed.data.departmentId, "dept_1");
    assert.equal(parsed.data.type, "UNDERGRADUATE");
  });
});

describe("the route applies them through the department relation", () => {
  it("reads campusId and schoolId out of the validated query", () => {
    assert.match(route, /const \{ page, limit, q, departmentId, type, campusId, schoolId \}/);
  });

  it("filters through `department`, not a column Programme does not have", () => {
    assert.match(
      route,
      /department: \{[\s\S]{0,300}?campusId \? \{ campusId \} : \{\}/,
      "campus must be applied through the department relation"
    );
    assert.match(route, /schoolId \? \{ schoolId \} : \{\}/);
  });

  it("keeps the tenant predicate outside and above every filter", () => {
    // The relation filter must never become the outermost condition: tenantId
    // is what stops a campus id from another institution being answerable at
    // all, and it is ANDed with everything else.
    const whereAt = route.indexOf("const where: Prisma.ProgrammeWhereInput");
    const where = route.slice(whereAt, route.indexOf("];", whereAt));

    assert.match(where, /tenantId: tenant\.id/);
    assert.ok(
      where.indexOf("tenantId: tenant.id") < where.indexOf("department: {"),
      "the tenant predicate must lead the where clause"
    );
  });

  it("adds the relation filter ONLY when one of the two is present", () => {
    // An unconditional `department: {}` would be an empty relation filter on
    // every request — harmless today, and exactly the kind of thing that
    // becomes an accidental inner join later.
    assert.match(route, /\.\.\.\(campusId \|\| schoolId/);
  });
});

describe("the page offers the controls the tester asked for", () => {
  it("renders All campuses and All schools", () => {
    assert.match(page, /paramKey="campusId"/);
    assert.match(page, /allLabel="All campuses"/);
    assert.match(page, /paramKey="schoolId"/);
    assert.match(page, /allLabel="All schools"/);
  });

  it("sends them to the API rather than filtering in the browser", () => {
    // The instruction was explicit that the filter must affect the returned
    // dataset. Filtering an already-fetched page would leave pagination and
    // the row count describing the unfiltered list.
    assert.match(page, /listProgrammes\(\{[\s\S]{0,220}?campusId,[\s\S]{0,60}?schoolId,/);
  });

  it("narrows the school list to the chosen campus", () => {
    assert.match(page, /schoolsForFilter/);
    assert.match(page, /campusId \? schools\.filter\(\(s\) => s\.campusId === campusId\) : schools/);
  });

  it("carries both filters through pagination", () => {
    // Otherwise page 2 silently shows the unfiltered list under a toolbar that
    // still reads as filtered.
    const paginationAt = page.indexOf("searchParams={{");
    const block = page.slice(paginationAt, page.indexOf("}}", paginationAt));

    assert.match(block, /campusId \? \{ campusId \} : \{\}/);
    assert.match(block, /schoolId \? \{ schoolId \} : \{\}/);
  });
});

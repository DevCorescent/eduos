// ============================================================================
// TESTS: tester issues #37–#45.
//
// One file, because six of the nine are one-assertion contracts against a
// screen or a route and a file each would be six headers repeating the same
// note. The two with real logic — the attendance body shape (#38) and the
// assignment search schema (#39/#45) — are exercised for real.
//
// The routes and pages reach a database and this suite has none (see
// package.json), so their wiring is pinned as source contracts, and the
// behaviours that need rows are covered by live verification against the
// running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listAssignmentsQuerySchema } from "./validations/assignment";
import { createAttendanceSchema } from "./validations/attendance";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Source with comments removed.
 *
 * Needed for the "this is gone" assertions. The fixes below document what they
 * replaced by quoting it — "this was `rounded-md bg-primary`", "facultyId is
 * NOT sent" — so a bare search finds the old code in the explanation of its own
 * removal and reports a defect that is not there. These assertions are about
 * what the file DOES, so they read only the code.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const academics = read("services/academics.ts");
const entityCrud = read("components/shared/EntityCrud.tsx");
const facultyPage = read("app/(university)/faculty/page.tsx");
const assignmentsRoute = read("app/api/assignments/route.ts");
const facultyAssignments = read("app/(portals)/faculty/assignments/page.tsx");
const studentAssignments = read("app/(portals)/student/assignments/page.tsx");
const examList = read("app/(university)/examinations/page.tsx");
const examForm = read("app/(university)/examinations/new/ScheduleExaminationForm.tsx");
const examDetail = read("app/(university)/examinations/[id]/page.tsx");
const ticketPage = read("app/(portals)/student/examinations/[ticketId]/page.tsx");
const evaluationOverview = read("app/(university)/evaluation/page.tsx");

// ============================================================================
// #37 — Faculty Management → View Faculty Details
// ============================================================================

describe("#37 — every faculty row offers a View action", () => {
  it("the detail page it opens already existed", () => {
    // Nothing new was created: the route has been there all along and the
    // person's NAME linked to it. What was missing was a visible affordance.
    assert.ok(existsSync(join(process.cwd(), "app/(university)/faculty/[id]/page.tsx")));
  });

  it("EntityRowActions accepts a viewHref", () => {
    assert.match(entityCrud, /viewHref\?: string;/);
  });

  it("it renders as a Link, not a button", () => {
    // So middle-click, open-in-new-tab and copy-address all keep working.
    assert.match(entityCrud, /\{viewHref && \(/);
    assert.match(entityCrud, /<Link\s+href=\{viewHref\}/);
  });

  it("it is labelled for assistive tech", () => {
    assert.match(entityCrud, /aria-label=\{`View \$\{recordName\}`\}/);
  });

  it("the Faculty screen passes the row's own id", () => {
    // THE REGRESSION. Before this the actions column offered Edit alone.
    assert.match(facultyPage, /viewHref=\{`\/faculty\/\$\{faculty\.id\}`\}/);
  });

  it("the existing edit action is untouched", () => {
    assert.match(facultyPage, /onUpdate=\{updateFacultyAction\.bind\(null, faculty\.id\)\}/);
  });

  it("the name still links to the same place — nothing was traded away", () => {
    assert.match(facultyPage, /href=\{`\/faculty\/\$\{faculty\.id\}`\}/);
  });
});

// ============================================================================
// #38 — Attendance → Mark Attendance
// ============================================================================

describe("#38 — the register is sent in the shape the API accepts", () => {
  /** What the screen sends, rebuilt exactly as markAttendance now builds it. */
  function body(entries: { studentId: string; status: string }[]) {
    return {
      records: entries.map((entry) => ({
        studentId: entry.studentId,
        status: entry.status,
        sectionId: "sec_1",
        courseId: "crs_1",
        date: "2026-09-03",
      })),
    };
  }

  it("the OLD body shape is rejected — this is the reported bug", () => {
    // { sectionId, courseId, date, entries } — `records` absent, so .min(1)
    // fails before a single field is looked at. That 400 is the "Couldn't save,
    // invalid input" the tester saw, and it is why EVERY status failed alike.
    const old = {
      sectionId: "sec_1",
      courseId: "crs_1",
      date: "2026-09-03",
      entries: [{ studentId: "stu_1", status: "PRESENT" }],
    };

    assert.equal(createAttendanceSchema.safeParse(old).success, false);
  });

  it("the NEW body shape is accepted", () => {
    assert.equal(
      createAttendanceSchema.safeParse(body([{ studentId: "stu_1", status: "PRESENT" }])).success,
      true
    );
  });

  for (const status of ["PRESENT", "ABSENT", "LATE", "EXCUSED"]) {
    it(`${status} is accepted`, () => {
      const parsed = createAttendanceSchema.safeParse(body([{ studentId: "stu_1", status }]));
      assert.ok(parsed.success, `${status} must be accepted`);
      assert.equal(parsed.data.records[0].status, status);
    });
  }

  it('"All Present" — a whole section marked at once — is accepted', () => {
    const everyone = Array.from({ length: 40 }, (_, i) => ({
      studentId: `stu_${i}`,
      status: "PRESENT",
    }));

    const parsed = createAttendanceSchema.safeParse(body(everyone));
    assert.ok(parsed.success);
    assert.equal(parsed.data.records.length, 40);
  });

  it("REFUSES a status the UI cannot produce — validation was not weakened", () => {
    assert.equal(
      createAttendanceSchema.safeParse(body([{ studentId: "s", status: "NOT_A_STATUS" }])).success,
      false
    );
  });

  it("still REFUSES an empty batch", () => {
    assert.equal(createAttendanceSchema.safeParse({ records: [] }).success, false);
  });

  it("still REQUIRES a studentId and a date on every record", () => {
    assert.equal(
      createAttendanceSchema.safeParse({ records: [{ status: "PRESENT", date: "2026-09-03" }] })
        .success,
      false
    );
    assert.equal(
      createAttendanceSchema.safeParse({ records: [{ studentId: "s" }] }).success,
      false
    );
  });

  it("markAttendance builds the envelope rather than the old flat body", () => {
    assert.match(academics, /body: \{\s*records: entries\.map\(\(entry\) => \(\{/);
    assert.ok(
      !/body: \{ sectionId, courseId, date, entries \}/.test(academics),
      "the flat body is the defect and must not return"
    );
  });

  it("it repeats section, course and date on EVERY record", () => {
    // Not decoration: facultyMayMarkRecords refuses any record naming neither
    // section nor course, so a lecturer's own register would 403 without them.
    const fn = academics.slice(
      academics.indexOf("export async function markAttendance"),
      academics.indexOf("\n}", academics.indexOf("export async function markAttendance"))
    );

    assert.match(fn, /studentId: entry\.studentId/);
    assert.match(fn, /status: entry\.status/);
    assert.match(fn, /sectionId,/);
    assert.match(fn, /courseId,/);
    assert.match(fn, /date,/);
  });

  it("it does NOT send facultyId — authority comes from the session", () => {
    const fn = academics.slice(
      academics.indexOf("export async function markAttendance"),
      academics.indexOf("\n}", academics.indexOf("export async function markAttendance"))
    );

    assert.ok(!/facultyId/.test(code(fn)), "who taught the session is not a client claim");
  });
});

// ============================================================================
// #39 / #45 — Assignment search, faculty and student
// ============================================================================

describe("#39/#45 — the assignment query schema accepts the search", () => {
  it("accepts q", () => {
    const parsed = listAssignmentsQuerySchema.safeParse({ q: "essay" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "essay");
  });

  it('treats "" as no filter', () => {
    const parsed = listAssignmentsQuerySchema.safeParse({ q: "" });
    assert.ok(parsed.success, "clearing the box must not be a 400");
    assert.equal(parsed.data.q, undefined);
  });

  it("trims", () => {
    const parsed = listAssignmentsQuerySchema.safeParse({ q: "  essay  " });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "essay");
  });

  it("keeps the shared pagination contract", () => {
    const parsed = listAssignmentsQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(parsed.data.page, 1);
    assert.equal(typeof parsed.data.limit, "number");
  });

  it("accepts NO tenantId", () => {
    const parsed = listAssignmentsQuerySchema.safeParse({ tenantId: "other" });
    assert.ok(parsed.success);
    assert.ok(!("tenantId" in parsed.data));
  });
});

describe("#39/#45 — the route applies it without widening visibility", () => {
  it("parses the new schema, not bare pagination", () => {
    assert.match(assignmentsRoute, /listAssignmentsQuerySchema\.safeParse/);
    assert.ok(
      !/paginationQuerySchema\.safeParse/.test(assignmentsRoute),
      "parsing bare pagination is what dropped ?q"
    );
  });

  it("destructures q", () => {
    assert.match(assignmentsRoute, /const \{ page, limit, q \} = parsed\.data;/);
  });

  it("searches title, description and the course", () => {
    assert.match(assignmentsRoute, /title: \{ contains: term, mode: "insensitive" as const \}/);
    assert.match(assignmentsRoute, /description: \{ contains: term, mode: "insensitive" as const \}/);
    assert.match(assignmentsRoute, /course: \{ code: \{ contains: term/);
  });

  it("splits the term, AND of ORs", () => {
    assert.match(assignmentsRoute, /q\.split\(\/\\s\+\/\)/);
    assert.match(assignmentsRoute, /AND: terms\.map/);
  });

  it("the search NARROWS the visibility predicate rather than replacing it", () => {
    // The student branch's publishedAt filter has to survive the search, or a
    // keyword would surface an unpublished assignment.
    assert.match(assignmentsRoute, /const where: Prisma\.AssignmentWhereInput = \{/);
    assert.match(assignmentsRoute, /\.\.\.\(isElevated[\s\S]{0,160}publishedAt: \{ not: null \}/);
  });

  it("keeps the tenant predicate on BOTH branches", () => {
    assert.match(assignmentsRoute, /\? \{ tenantId: tenant\.id \}/);
    assert.match(assignmentsRoute, /: \{ tenantId: tenant\.id, publishedAt: \{ not: null \} \}/);
  });

  it("uses ONE where for the page and the count", () => {
    assert.match(assignmentsRoute, /prisma\.assignment\.findMany\(\{\s*where,/);
    assert.match(assignmentsRoute, /prisma\.assignment\.count\(\{ where \}\)/);
  });

  it("preserves the ordering and pagination", () => {
    assert.match(assignmentsRoute, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(assignmentsRoute, /skip: \(page - 1\) \* limit/);
  });

  it("never reads a client tenantId", () => {
    assert.ok(!/tenantId: (parsed|input|query|body)/.test(assignmentsRoute));
  });
});

describe("#39 — the faculty My Assignments screen", () => {
  it("no longer renders its search disabled", () => {
    assert.ok(!/unsupported=/.test(facultyAssignments));
    assert.ok(!/UNSUPPORTED_/.test(facultyAssignments));
  });

  it("still sends q", () => {
    assert.match(facultyAssignments, /listFacultyAssignments\(faculty\.userId, \{ page: 1, limit: 100, q \}\)/);
  });
});

describe("#45 — the student My Assignments screen", () => {
  it("no longer renders its SEARCH disabled", () => {
    assert.ok(
      !/unsupported=\{UNSUPPORTED_SEARCH\}/.test(studentAssignments),
      "search must be live"
    );
  });

  it("still sends q", () => {
    assert.match(studentAssignments, /\bq,/);
  });

  it("the ?state filter stays disabled, and says why", () => {
    // Not the same gap: "not submitted / awaiting marks / graded" is a property
    // of THIS student's submission, not a column the endpoint can filter on.
    // Enabling it silently would return everything.
    assert.match(studentAssignments, /unsupported=\{UNSUPPORTED_FILTER\}/);
    assert.match(studentAssignments, /property of THIS student's submission|not a column on Assignment/i);
  });
});

// ============================================================================
// #40 / #41 — Schedule Examination
// ============================================================================

describe("#40 — the Schedule examination control uses the design system", () => {
  it("it is styled by buttonStyles, not hand-rolled classes", () => {
    assert.match(examList, /<Link href="\/examinations\/new" className=\{buttonStyles\(\)\}>/);
  });

  it("the off-system classes are gone", () => {
    // rounded-md + flat bg-primary + px-3 py-2: a square box of a different
    // height among pill-shaped gradient buttons, with no focus ring.
    assert.ok(!/rounded-md bg-primary/.test(code(examList)));
    assert.ok(!/hover:bg-primary\/90/.test(code(examList)));
  });

  it("it still points at the Schedule Examination route", () => {
    assert.match(examList, /href="\/examinations\/new"/);
  });

  it("that route exists", () => {
    assert.ok(existsSync(join(process.cwd(), "app/(university)/examinations/new/page.tsx")));
  });
});

describe("#41 — the button is never inert", () => {
  it("it is disabled only while saving", () => {
    // THE REGRESSION. `disabled={saving || incomplete}` made it dead on arrival,
    // so clicking produced no navigation and no message — "stays on the same
    // page".
    assert.match(examForm, /<Button onClick=\{submit\} disabled=\{saving\}>/);
    assert.ok(
      !/disabled=\{saving \|\| incomplete\}/.test(examForm),
      "the inert-on-arrival condition must not return"
    );
    assert.ok(!/const incomplete =/.test(examForm), "the flag itself is gone");
  });

  it("required fields are reported on submit instead", () => {
    assert.match(examForm, /Choose the course this examination is for\./);
    assert.match(examForm, /Choose the semester this examination belongs to\./);
    assert.match(examForm, /Give the examination a title\./);
  });

  it("each message lands on its own field", () => {
    assert.match(examForm, /setField\("courseId"\)/);
    assert.match(examForm, /setField\("semesterId"\)/);
    assert.match(examForm, /setField\("title"\)/);
    assert.match(examForm, /error=\{field === "semesterId" \? error \?\? undefined : undefined\}/);
  });

  it("a successful submit still navigates back to the calendar", () => {
    assert.match(examForm, /router\.push\("\/examinations"\)/);
  });

  it("validation runs BEFORE the saving flag, so a refusal cannot strand it", () => {
    assert.ok(
      examForm.indexOf('setField("courseId")') < examForm.indexOf("setSaving(true)"),
      "an early return must not leave the button spinning"
    );
  });
});

// ============================================================================
// #42 / #43 — layout of the examination actions
// ============================================================================

describe("#42 — Issue Hall Ticket and Allocate Seats", () => {
  it("both are still rendered", () => {
    assert.match(examDetail, /<IssueHallTicketsButton/);
    assert.match(examDetail, /<AllocateSeatsButton/);
  });

  it("neither was removed or disabled to satisfy a visual test", () => {
    assert.match(examDetail, /examinationId=\{exam\.id\}/);
    assert.match(examDetail, /eligibleCount=\{summary\.eligible\}/);
    assert.match(examDetail, /issuedCount=\{summary\.ticketsIssued\}/);
  });

  it("their icons use the project's sizing convention", () => {
    for (const f of [
      "app/(university)/examinations/[id]/IssueHallTicketsButton.tsx",
      "app/(university)/examinations/[id]/AllocateSeatsButton.tsx",
    ]) {
      const src = read(f);
      assert.match(src, /className="size-4"/, `${f} must use size-4`);
      assert.ok(!/className="h-4 w-4"/.test(src), `${f} must not use h-4 w-4`);
    }
  });
});

describe("#43 — Print / Save as PDF alignment", () => {
  it("the chrome row is constrained to the ticket's own width", () => {
    // It was full-bleed while the <article> is mx-auto max-w-2xl, so
    // justify-between threw the button to the viewport edge, detached from the
    // sheet it prints.
    assert.match(ticketPage, /className="mx-auto mb-4 flex max-w-2xl flex-wrap items-center justify-between gap-3 print:hidden"/);
  });

  it("the ticket itself is still centred at the same width", () => {
    assert.match(ticketPage, /className="mx-auto max-w-2xl rounded-lg/);
  });

  it("the row is still hidden when printing", () => {
    assert.match(ticketPage, /print:hidden/);
  });

  it("the button still calls the browser's print dialog", () => {
    const printButton = read("app/(portals)/student/examinations/[ticketId]/PrintButton.tsx");
    assert.match(printButton, /onClick=\{\(\) => window\.print\(\)\}/);
    assert.match(printButton, /Print \/ Save as PDF/);
  });
});

// ============================================================================
// #44 — Evaluation → Student Results
// ============================================================================

describe("#44 — the Student Results tile opens a real page", () => {
  it("the page exists", () => {
    // Same defect as tester issue #32 and fixed by that work; the tester hit a
    // deployment that predates it. Pinned here too so the two reports cannot
    // regress independently.
    assert.ok(
      existsSync(join(process.cwd(), "app/(university)/evaluation/results/student/page.tsx"))
    );
  });

  it("the tile points at it", () => {
    assert.match(evaluationOverview, /href: "\/evaluation\/results\/student"/);
    assert.match(evaluationOverview, /title: "Student Results"/);
  });

  it("no duplicate page was created alongside it", () => {
    for (const duplicate of [
      "app/(university)/evaluation/student-results/page.tsx",
      "app/(university)/evaluation/results/students/page.tsx",
    ]) {
      assert.ok(!existsSync(join(process.cwd(), duplicate)), `${duplicate} must not exist`);
    }
  });
});

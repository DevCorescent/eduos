// ============================================================================
// TESTS: Evaluation navigation targets resolve to real pages — tester issue #32.
//
// THE DEFECT
//   "Clicking Student Results opens Page Not Found." It did. The Evaluation
//   overview has carried a "Student Results" tile pointing at
//   /evaluation/results/student since it was written, and the Semester Results
//   table links every student row to the same path — but
//   app/(university)/evaluation/results/student/page.tsx did not exist, so both
//   entry points answered Next.js's 404.
//
//   Nothing else was wrong: the href was correct, and the whole backend
//   (GET /api/results/student/[studentId] → result.controller → result.service)
//   plus services/evaluation.ts getStudentResult were already implemented. That
//   service function had no caller anywhere in the frontend, which is the shape
//   this class of defect always takes.
//
// WHY THIS TEST IS GENERIC RATHER THAN ONE ASSERTION
//   A test that only checked /evaluation/results/student would have caught this
//   one bug and none of its siblings. The overview's tile list is data, so every
//   href in it can be checked against the filesystem in a loop — which means the
//   NEXT tile added with no page behind it fails here rather than in front of a
//   tester. The same reasoning applies to the cross-links out of the results
//   tables.
//
// It reads the filesystem rather than the router because Next.js resolves routes
// from the directory layout: under the (university) route group, a page at path
// /x/y lives at app/(university)/x/y/page.tsx and there is nothing else to
// consult.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const overview = readFileSync(
  join(process.cwd(), "app/(university)/evaluation/page.tsx"),
  "utf8"
);
const semesterResults = readFileSync(
  join(process.cwd(), "app/(university)/evaluation/results/semester/page.tsx"),
  "utf8"
);
const nav = readFileSync(join(process.cwd(), "constants/navigation.tsx"), "utf8");

/**
 * The file Next.js would render for a path inside the (university) group.
 *
 * The route group parenthesis contributes nothing to the URL, which is the
 * whole point of a route group — so it is present in the path on disk and
 * absent from the href.
 */
function pageFileFor(href: string): string {
  return join(process.cwd(), "app/(university)", href, "page.tsx");
}

/** Every `href: "/…"` in the overview's `sections` tile list. */
function overviewTileHrefs(): string[] {
  const start = overview.indexOf("const sections = [");
  assert.ok(start > 0, "the overview must declare its tiles as a `sections` array");

  const block = overview.slice(start, overview.indexOf("\n  ];", start));
  const hrefs = [...block.matchAll(/href: "(\/[^"]*)"/g)].map((match) => match[1]);

  assert.ok(hrefs.length > 0, "no tile hrefs were found — the parser is out of date");
  return hrefs;
}

describe("#32 — every Evaluation overview tile leads to a real page", () => {
  it("finds the tiles", () => {
    const hrefs = overviewTileHrefs();
    assert.ok(hrefs.length >= 6, `expected the full tile list, found ${hrefs.length}`);
  });

  for (const href of overviewTileHrefs()) {
    it(`${href} has a page`, () => {
      assert.ok(
        existsSync(pageFileFor(href)),
        `${href} is linked from the Evaluation overview but app/(university)${href}/page.tsx does not exist — clicking it is a 404`
      );
    });
  }

  it("the Student Results tile specifically resolves", () => {
    // Named on its own as well as in the loop above, so the regression this
    // closes is legible in the test output rather than being one row of many.
    assert.match(overview, /href: "\/evaluation\/results\/student"/);
    assert.match(overview, /title: "Student Results"/);
    assert.ok(
      existsSync(
        join(process.cwd(), "app/(university)/evaluation/results/student/page.tsx")
      ),
      "the Student Results page must exist"
    );
  });
});

describe("#32 — the cross-link out of Semester Results resolves too", () => {
  it("Semester Results links each student to the student result page", () => {
    // The SECOND way into this route, and the one a registrar actually uses.
    assert.match(
      semesterResults,
      /\/evaluation\/results\/student\?studentId=\$\{student\.studentId\}/
    );
  });

  it("that target exists", () => {
    assert.ok(
      existsSync(
        join(process.cwd(), "app/(university)/evaluation/results/student/page.tsx")
      )
    );
  });
});

describe("#32 — every Evaluation sidebar entry leads to a real page", () => {
  // The sidebar was never broken, but it is the same class of link into the
  // same area and costs one loop to hold.
  const evaluationNavHrefs = [
    ...nav.matchAll(/href: "(\/evaluation[^"]*)"/g),
  ].map((match) => match[1]);

  it("finds the entries", () => {
    assert.ok(evaluationNavHrefs.length > 0, "no /evaluation nav entries found");
  });

  for (const href of [...new Set(evaluationNavHrefs)]) {
    it(`${href} has a page`, () => {
      assert.ok(
        existsSync(pageFileFor(href)),
        `${href} is in the sidebar but app/(university)${href}/page.tsx does not exist`
      );
    });
  }
});

describe("#32 — the page reuses the existing service, inventing nothing", () => {
  const studentPage = readFileSync(
    join(process.cwd(), "app/(university)/evaluation/results/student/page.tsx"),
    "utf8"
  );

  it("calls getStudentResult from services/evaluation", () => {
    // Rather than a second service, a second endpoint, or a direct fetch. The
    // backend for this was complete before the page existed.
    //
    // Matched on the SYMBOL rather than the whole import line: tester issue #48
    // added listResultStudents to the same import, and pinning the exact line
    // would fail on an unrelated import being added beside it — which says
    // nothing about whether this page still calls the right service.
    assert.match(
      studentPage,
      /import \{[^}]*\bgetStudentResult\b[^}]*\} from "@\/services\/evaluation"/
    );
    assert.match(studentPage, /await getStudentResult\(studentId\)/);
  });

  it("reads studentId from searchParams, following the transcript pattern", () => {
    assert.match(studentPage, /type SearchParams = Promise<\{ studentId\?: string \}>/);
    assert.match(studentPage, /const \{ studentId \} = await searchParams/);
  });

  it("offers a student selector on the same paramKey the links use", () => {
    // If this drifted from "studentId", the deep link out of Semester Results
    // would land on the page and select nobody.
    assert.match(studentPage, /paramKey="studentId"/);
  });

  it("prompts rather than erroring when no student is chosen", () => {
    assert.match(studentPage, /if \(!studentId\)/);
    assert.match(studentPage, /title="Choose a student"/);
  });

  it("renders the project's failure state, not a bare throw", () => {
    assert.match(studentPage, /if \(!result\.success\)/);
    assert.match(studentPage, /resolveFailureState\(result\)/);
  });

  it("renders the DTO's totals — SGPA, CGPA, credits and components", () => {
    assert.match(studentPage, /standing\.cgpa/);
    assert.match(studentPage, /semester\.sgpa\.value/);
    assert.match(studentPage, /credits\.earned/);
    assert.match(studentPage, /course\.components/);
    assert.match(studentPage, /course\.grade/);
  });

  it("surfaces the engine's warnings rather than dropping them", () => {
    // "Students the batch could not compute are never silently omitted" — the
    // DTO's own words. A results screen that hides them looks complete when it
    // is not.
    assert.match(studentPage, /student\.warnings/);
  });

  it("shows a null CGPA as a dash, never as zero", () => {
    // Null means nothing carried credit yet, which is a different statement
    // from a zero average.
    assert.match(studentPage, /standing\.cgpa \?\? "—"/);
  });

  it("adds no new API route or service for results", () => {
    assert.ok(
      !/apiRequest|fetch\(/.test(studentPage),
      "the page must go through services/evaluation, not call an endpoint itself"
    );
  });
});

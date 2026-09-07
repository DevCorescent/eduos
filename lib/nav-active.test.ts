// ============================================================================
// TESTS: Sidebar active-route resolution — tester issue #33.
//
// THE DEFECT
//   "When another tab is clicked, Overview remains selected/highlighted along
//   with the currently selected tab." On /evaluation/results/semester the
//   sidebar lit BOTH Overview (/evaluation) and Semester Results, because the
//   rule lived inline in Sidebar.tsx and each item decided its own fate:
//
//     pathname === item.href || pathname?.startsWith(`${item.href}/`)
//
//   Nothing compared the matches against each other, so a parent and its child
//   both won.
//
// WHY THE FIX IS NOT "MATCH EXACTLY"
//   The prefix branch is load-bearing: a detail page has no nav entry of its
//   own, so /students/abc relies on it to keep Students lit. The assertions
//   below pin BOTH halves — one winner, and detail pages still resolving to
//   their parent — so a later "simplification" to exact matching fails here
//   rather than in front of a user.
//
// WHY THE RULE LIVES IN lib/
//   This suite runs node --test over lib/** with no DOM (see package.json), so
//   a rule embedded in a "use client" component calling usePathname is
//   unreachable from it — which is exactly why this defect shipped with no
//   coverage. As a pure function it is exercised directly, against the real
//   UNIVERSITY_NAV rather than a hand-made fixture, so the test cannot pass on
//   a nav shape the product does not have.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeNavHref, flattenNavItems } from "./nav-active";

const sidebar = readFileSync(join(process.cwd(), "components/layout/Sidebar.tsx"), "utf8");
const nav = readFileSync(join(process.cwd(), "constants/navigation.tsx"), "utf8");

/**
 * The real Evaluation group, read from constants/navigation.tsx.
 *
 * Parsed from source rather than imported because navigation.tsx is a .tsx
 * module carrying JSX icons, which this DOM-less runner cannot evaluate. The
 * hrefs are what the rule operates on, and they are what is extracted.
 */
function evaluationHrefs(): string[] {
  return [...new Set([...nav.matchAll(/href: "(\/evaluation[^"]*)"/g)].map((m) => m[1]))];
}

/** Every href in the university sidebar, for the "only one wins" sweep. */
function universityHrefs(): string[] {
  const start = nav.indexOf("export const UNIVERSITY_NAV");
  assert.ok(start > 0, "UNIVERSITY_NAV must exist");

  const block = nav.slice(start, nav.indexOf("\n// --- Faculty Portal", start));
  return [...new Set([...block.matchAll(/href: "(\/[^"]*)"/g)].map((m) => m[1]))];
}

const items = (hrefs: string[]) => hrefs.map((href) => ({ href }));

describe("#33 — /evaluation highlights Overview", () => {
  it("resolves to /evaluation exactly", () => {
    assert.equal(activeNavHref("/evaluation", items(evaluationHrefs())), "/evaluation");
  });

  it("still resolves when every other nav entry is present", () => {
    assert.equal(activeNavHref("/evaluation", items(universityHrefs())), "/evaluation");
  });
});

describe("#33 — a child TAB does NOT highlight Overview", () => {
  // THE REGRESSION. Every one of these lit Overview as well before the fix.
  //
  // Derived from the real sidebar rather than hand-listed, so a tab added later
  // is covered without editing this file — and so the list cannot quietly drift
  // out of step with the navigation it claims to test.
  const tabs = evaluationHrefs().filter((href) => href !== "/evaluation");

  it("there are child tabs to check", () => {
    assert.ok(tabs.length >= 5, `expected the Evaluation children, found ${tabs.length}`);
  });

  for (const tab of tabs) {
    it(`${tab} → Overview is NOT active`, () => {
      assert.notEqual(
        activeNavHref(tab, items(evaluationHrefs())),
        "/evaluation",
        `${tab} must not light Overview`
      );
    });

    it(`${tab} → that tab IS active`, () => {
      assert.equal(activeNavHref(tab, items(evaluationHrefs())), tab);
    });
  }
});

describe("#33 — an Evaluation page with NO sidebar entry lights its nearest parent", () => {
  // /evaluation/results/student is reached from the Overview tile and from the
  // Semester Results table, not from the sidebar — it has no nav entry of its
  // own, exactly like /students/abc. Lighting Overview there is CORRECT: it
  // tells the user which area they are in, and it is the same behaviour the
  // prefix branch has always provided for detail pages.
  //
  // It is not the reported defect either way, because only ONE entry lights.
  // The tester's complaint was two entries lit at once.
  const unlisted = ["/evaluation/results/student", "/evaluation/schemes/abc123"];

  for (const path of unlisted) {
    it(`${path} lights exactly one entry`, () => {
      const all = items(evaluationHrefs());
      const active = activeNavHref(path, all);
      assert.equal(all.filter((item) => item.href === active).length, 1);
    });
  }

  it("/evaluation/results/student has no sidebar entry of its own", () => {
    // Stated explicitly: if one is ever added, the assertion below flips and
    // this test says why rather than failing mysteriously.
    assert.ok(!evaluationHrefs().includes("/evaluation/results/student"));
  });

  it("  so it resolves to Overview, its nearest listed ancestor", () => {
    assert.equal(
      activeNavHref("/evaluation/results/student", items(evaluationHrefs())),
      "/evaluation"
    );
  });
});

describe("#33 — exactly ONE entry is ever active", () => {
  it("across every Evaluation route", () => {
    const all = items(evaluationHrefs());

    for (const href of evaluationHrefs()) {
      const active = activeNavHref(href, all);
      const lit = all.filter((item) => item.href === active);
      assert.equal(lit.length, 1, `${href} lit ${lit.length} entries`);
    }
  });

  it("across every university route, including detail pages", () => {
    const all = items(universityHrefs());
    const paths = [
      ...universityHrefs(),
      // Detail pages, which have no nav entry of their own.
      "/students/abc123",
      "/faculty/xyz789",
      "/evaluation/schemes/abc123",
      "/evaluation/assessment-events/abc123",
      "/users/roles",
    ];

    for (const path of paths) {
      const active = activeNavHref(path, all);
      const lit = all.filter((item) => item.href === active);
      assert.ok(lit.length <= 1, `${path} lit ${lit.length} entries`);
    }
  });
});

describe("#33 — the prefix behaviour detail pages depend on is PRESERVED", () => {
  // The half a naive "match exactly" fix would have destroyed.
  it("/students/abc keeps Students lit", () => {
    assert.equal(activeNavHref("/students/abc", items(universityHrefs())), "/students");
  });

  it("/evaluation/schemes/abc lights Schemes, not Overview", () => {
    const active = activeNavHref("/evaluation/schemes/abc", items(evaluationHrefs()));
    assert.equal(active, "/evaluation/schemes");
  });

  it("/users/roles lights Users & Roles — it has no entry of its own", () => {
    assert.equal(activeNavHref("/users/roles", items(universityHrefs())), "/users");
  });
});

describe("#33 — the matching rule itself", () => {
  const three = items(["/a", "/a/b", "/a/b/c"]);

  it("longest match wins", () => {
    assert.equal(activeNavHref("/a/b/c", three), "/a/b/c");
    assert.equal(activeNavHref("/a/b", three), "/a/b");
    assert.equal(activeNavHref("/a", three), "/a");
  });

  it("falls back to the nearest ancestor for an unlisted child", () => {
    assert.equal(activeNavHref("/a/b/c/d", three), "/a/b/c");
    assert.equal(activeNavHref("/a/zzz", three), "/a");
  });

  it("does NOT match a sibling sharing a textual prefix", () => {
    // The trailing slash, carried over from the original inline rule: without
    // it "/faculty" would light up on "/faculty-development".
    assert.equal(activeNavHref("/faculty-development", items(["/faculty"])), null);
    assert.equal(activeNavHref("/abc", items(["/a"])), null);
  });

  it("returns null rather than guessing when nothing matches", () => {
    assert.equal(activeNavHref("/nowhere", three), null);
  });

  it("tolerates an unresolved pathname", () => {
    // usePathname can return null before hydration; highlighting nothing is the
    // honest answer, and it must not throw.
    assert.equal(activeNavHref(null, three), null);
    assert.equal(activeNavHref(undefined, three), null);
    assert.equal(activeNavHref("", three), null);
  });

  it("handles an empty nav", () => {
    assert.equal(activeNavHref("/a", []), null);
  });
});

describe("#33 — flattenNavItems collapses the sections", () => {
  // The half that makes cross-section resolution possible: a parent and its
  // child routinely sit in different groups, and resolving per section would
  // let both light up again.
  const sections = [
    { label: "Academics", items: [{ href: "/evaluation" }, { href: "/evaluation/schemes" }] },
    { label: "Administration", items: [{ href: "/users" }] },
  ];

  it("returns every item across every section, in order", () => {
    assert.deepEqual(flattenNavItems(sections).map((item) => item.href), [
      "/evaluation",
      "/evaluation/schemes",
      "/users",
    ]);
  });

  it("handles an empty section list", () => {
    assert.deepEqual(flattenNavItems([]), []);
  });

  it("a child in a DIFFERENT section still beats its parent", () => {
    const split = [
      { items: [{ href: "/evaluation" }] },
      { items: [{ href: "/evaluation/results/semester" }] },
    ];

    assert.equal(
      activeNavHref("/evaluation/results/semester", flattenNavItems(split)),
      "/evaluation/results/semester"
    );
  });
});

describe("#33 — the Sidebar consumes the shared rule", () => {
  it("imports it rather than keeping a private copy", () => {
    assert.match(sidebar, /import \{ activeNavHref, flattenNavItems \} from "@\/lib\/nav-active"/);
  });

  it("resolves ONCE for the whole tree, not per section", () => {
    // Deciding per section would let a parent in one group and a child in
    // another light up together — the same defect by a different route.
    assert.match(sidebar, /const activeHref = activeNavHref\(pathname, flattenNavItems\(sections\)\)/);
  });

  it("compares each item against that single winner", () => {
    assert.match(sidebar, /const isActive = item\.href === activeHref;/);
  });

  it("no longer decides active state per item by prefix", () => {
    assert.ok(
      !/pathname\?\.startsWith\(`\$\{item\.href\}\/`\)/.test(sidebar),
      "the per-item prefix match is the defect and must not return"
    );
  });

  it("still drives aria-current, so the fix is announced to assistive tech", () => {
    assert.match(sidebar, /aria-current=\{isActive \? "page" : undefined\}/);
  });
});

describe("#33 — existing Evaluation navigation still resolves", () => {
  it("every Evaluation entry is reachable as its own active route", () => {
    for (const href of evaluationHrefs()) {
      assert.equal(activeNavHref(href, items(evaluationHrefs())), href, `${href} must be selectable`);
    }
  });

  it("the Evaluation group still carries its full set of entries", () => {
    // A "fix" that deleted Overview would also make the assertions above pass.
    const hrefs = evaluationHrefs();
    assert.ok(hrefs.includes("/evaluation"), "Overview must still exist");
    assert.ok(hrefs.includes("/evaluation/results/semester"));
    assert.ok(hrefs.includes("/evaluation/schemes"));
    assert.ok(hrefs.length >= 6, `expected the full group, found ${hrefs.length}`);
  });
});

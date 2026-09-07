// ============================================================================
// MODULE : Navigation — Active Route Resolution
// LAYER  : Pure helper (no React, no DOM, no database)
// PURPOSE: Decide which ONE sidebar entry is the current page.
//
// WHY THIS IS ITS OWN MODULE
//   Tester issue #33: on /evaluation/results/semester the sidebar lit BOTH
//   "Overview" and "Semester Results". The rule lived inline in Sidebar.tsx and
//   each item decided its own fate in isolation:
//
//     const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`)
//
//   Overview's href is /evaluation, so the prefix branch matched, and Semester
//   Results matched exactly. Two winners, because nothing compared them against
//   each other. The same thing happened on every parent/child pair in the tree —
//   Evaluation was simply the group with the most children.
//
// WHY NOT JUST MATCH EXACTLY
//   Because the prefix branch is load-bearing and its own comment said so. A
//   detail page has no nav entry: /students/abc, /faculty/xyz,
//   /evaluation/schemes/abc. Exact matching would leave the sidebar with
//   nothing lit on all of them, trading one wrong highlight for a hundred
//   missing ones.
//
// THE RULE: LONGEST MATCH WINS
//   An entry matches when the path IS it or sits beneath it; of the entries
//   that match, the most specific one — the longest href — is the active one
//   and every other is inactive.
//
//     /evaluation                    → Overview            (only match)
//     /evaluation/results/semester   → Semester Results    (beats /evaluation)
//     /evaluation/schemes/abc        → Schemes             (beats /evaluation)
//     /students/abc                  → Students            (only match, kept)
//
//   This is not a new idea in this repository: ruleForPath in
//   lib/constants/moduleRoutes.ts resolves module gating exactly this way —
//   "The longest matching prefix wins, so a more specific rule can be added
//   later without reordering the list." Same reasoning, same guarantee: adding
//   a child route needs no change here and no list to keep in step.
//
// WHY IT LIVES IN lib/ RATHER THAN INSIDE THE COMPONENT
//   So it can be tested. The suite runs node --test over lib/** with no DOM
//   (see package.json), so a rule embedded in a "use client" component with
//   usePathname is unreachable from it — which is precisely why this defect had
//   no coverage. As a pure function it is exercised directly.
// ============================================================================

/** The part of a sidebar entry this decision needs. */
export interface ActiveNavCandidate {
  readonly href: string;
}

/**
 * True when `path` is `href` or sits beneath it.
 *
 * The trailing slash is load-bearing, and was in the original inline rule too:
 * without it "/faculty" would also match "/faculty-development". Carried over
 * deliberately rather than rediscovered later.
 */
function underHref(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

/**
 * The href of the ONE entry that should be highlighted, or null.
 *
 * INPUT   : the current pathname (null while it is unresolved, which is what
 *           usePathname can return) and every entry in the whole sidebar —
 *           across all sections, because a parent and its child are routinely
 *           in different groups and comparing only within a group would let
 *           both light up again.
 * RETURNS : null when nothing matches. A caller highlights nothing rather than
 *           guessing, which is the honest answer on a page with no nav entry
 *           above it at all.
 *
 * Ties are impossible in practice — two entries with the identical href are the
 * same destination twice — and if one occurs the first wins, which keeps the
 * result stable rather than dependent on iteration order.
 *
 * COMPLEXITY : one pass over the entries. The sidebar has tens of them.
 */
export function activeNavHref(
  path: string | null | undefined,
  items: readonly ActiveNavCandidate[]
): string | null {
  if (!path) return null;

  let best: string | null = null;

  for (const item of items) {
    if (!underHref(path, item.href)) continue;
    // Strictly greater, so an equal-length later duplicate does not displace
    // the first.
    if (best === null || item.href.length > best.length) best = item.href;
  }

  return best;
}

/**
 * Flatten sections into the one list the decision is made over.
 *
 * Stated here rather than at the call site so a caller cannot accidentally
 * resolve per-section, which is the bug this module exists to prevent.
 */
export function flattenNavItems<T extends ActiveNavCandidate>(
  sections: readonly { readonly items: readonly T[] }[]
): T[] {
  return sections.flatMap((section) => [...section.items]);
}

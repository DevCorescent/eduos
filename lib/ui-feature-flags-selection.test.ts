// ============================================================================
// TESTS: the Feature Flags page shows ONE university at a time — issue #14.
//
// THE COMPLAINT
//   "The page directly displays multiple tenants with all capability names
//   listed underneath each tenant, making the page cluttered and difficult to
//   manage. There is no searchable tenant list or tenant selection flow."
//
// WHAT THIS PINS
//   Not the layout — the shape of the data the page asks for. The clutter was a
//   symptom of fetching every university's flags on the index; a page that
//   fetches one tenant's subscription only when one is selected cannot render
//   the cluttered view again however its markup is restyled.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(
  join(process.cwd(), "app/(platform)/platform/feature-flags/page.tsx"),
  "utf8"
);

describe("Feature Flags — selection comes first", () => {
  it("branches on a selected tenant rather than rendering every one's flags", () => {
    assert.match(page, /tenantId \? \(\s*<SelectedTenant tenantId=\{tenantId\}/);
  });

  it("keeps the selection in the URL, so it can be linked and reloaded", () => {
    // A selection held in component state would be lost on reload and could not
    // be shared — and would force the page to become a Client Component.
    assert.match(page, /type SearchParams = Promise<\{ tenantId\?: string; q\?: string; page\?: string \}>/);
    assert.match(page, /feature-flags\?tenantId=\$\{tenant\.id\}/);
  });

  it("the index offers search and pagination over the tenant list", () => {
    assert.match(page, /<ListSearch/);
    assert.match(page, /<Pagination/);
    assert.match(page, /listTenants\(\{ page: currentPage, limit: PAGE_SIZE, q \}\)/);
  });

  it("reads the displayed values from the selected tenant alone", () => {
    // The whole defect in one line: the flags rendered belong to the tenant
    // named in the URL, fetched by id.
    const selected = page.slice(page.indexOf("async function SelectedTenant"));

    assert.match(selected, /getSubscriptionForTenant\(tenantId\)/);
    assert.match(selected, /getTenant\(tenantId\)/);
  });

  it("uses the platform-wide scan for flag NAMES only, never for values", () => {
    // listSubscriptions is still called, deliberately: the set of flag keys in
    // use across the platform is what lets an operator switch on a flag another
    // university already has without retyping it from memory. Only the keys are
    // taken. If this ever started reading `row.features[...]` values, the
    // cluttered page would be back — one tenant's screen showing another's
    // settings — so the key-only derivation is what is pinned.
    const selected = page.slice(page.indexOf("async function SelectedTenant"));
    const derivation = selected.slice(
      selected.indexOf("const knownFlags"),
      selected.indexOf("const knownFlags") + 400
    );

    assert.match(derivation, /Object\.keys\(row\.features \?\? \{\}\)/);
    assert.ok(
      !/Object\.entries\(row\.features|row\.features\[/.test(derivation),
      "the scan must contribute names, never another tenant's values"
    );
  });
});

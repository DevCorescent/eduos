// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant — University theme
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the three properties the university theme rests on:
//
//   1. A theme can never break the portal that renders it. Every token always
//      resolves to a renderable colour, whatever is in the column.
//   2. A theme can never carry CSS. Only hex passes, so nothing a university
//      stores can close a declaration and open another.
//   3. Writing a theme never destroys unrelated settings. Tenant.settings is a
//      shared JSON column and this feature is a guest in it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  THEME_HEX,
  UNIVERSITY_THEME_KEYS,
  UNIVERSITY_THEME_TOKENS,
  extractThemeSettings,
  isThemeColour,
  mergeThemeIntoSettings,
  resolveUniversityTheme,
} from "@/lib/domain/tenant/theme";
import { updateBrandingSchema } from "@/lib/validations/domain";

describe("resolveUniversityTheme — a theme can never break a portal", () => {
  it("returns every token even for a university that has set nothing", () => {
    const theme = resolveUniversityTheme({});

    for (const key of UNIVERSITY_THEME_KEYS) {
      assert.match(theme[key], THEME_HEX, `${key} must always resolve`);
    }
  });

  it("uses the product default when nothing is set, so the feature is invisible until used", () => {
    const theme = resolveUniversityTheme({ primaryColor: null, accentColor: null, settings: null });

    for (const token of UNIVERSITY_THEME_TOKENS) {
      assert.equal(theme[token.key], token.fallback);
    }
  });

  it("reads the two COLUMN tokens from the columns", () => {
    const theme = resolveUniversityTheme({ primaryColor: "#1d4ed8", accentColor: "#f59e0b" });

    assert.equal(theme.primaryColor, "#1d4ed8");
    assert.equal(theme.accentColor, "#f59e0b");
  });

  it("reads the four SETTINGS tokens from settings.theme", () => {
    const theme = resolveUniversityTheme({
      settings: {
        theme: {
          sidebar: "#0f172a",
          sidebarText: "#e2e8f0",
          sidebarActive: "#2563eb",
          header: "#111827",
        },
      },
    });

    assert.equal(theme.sidebar, "#0f172a");
    assert.equal(theme.sidebarText, "#e2e8f0");
    assert.equal(theme.sidebarActive, "#2563eb");
    assert.equal(theme.header, "#111827");
  });

  it("falls back for anything that is not a hex colour, whatever reached the column", () => {
    const theme = resolveUniversityTheme({
      primaryColor: "red",
      accentColor: "rgb(1,2,3)",
      settings: {
        theme: {
          sidebar: "#zzzzzz",
          sidebarText: 42,
          sidebarActive: { nested: true },
          header: "#0f172a; --danger: green",
        },
      },
    });

    for (const token of UNIVERSITY_THEME_TOKENS) {
      assert.equal(theme[token.key], token.fallback, `${token.key} must fall back`);
    }
  });

  it("ignores unrelated keys sitting in settings.theme", () => {
    const theme = resolveUniversityTheme({
      settings: { theme: { danger: "#00ff00", success: "#ff0000", sidebar: "#0f172a" } },
    });

    assert.equal(theme.sidebar, "#0f172a");
    // The closed set is the whole guarantee: a semantic name in the column is
    // read by nothing and can never become CSS.
    assert.equal(Object.keys(theme).sort().join(","), [...UNIVERSITY_THEME_KEYS].sort().join(","));
  });

  it("never throws on a malformed settings column", () => {
    for (const settings of [null, undefined, 0, "", "theme", [], { theme: null }, { theme: 7 }]) {
      assert.doesNotThrow(() => resolveUniversityTheme({ settings }));
    }
  });
});

describe("isThemeColour — nothing but hex reaches CSS", () => {
  it("accepts the two hex forms the branding API stores", () => {
    assert.ok(isThemeColour("#abc"));
    assert.ok(isThemeColour("#1d4ed8"));
    assert.ok(isThemeColour("  #1d4ed8  "), "trimmed");
  });

  it("REJECTS every CSS-injection shape", () => {
    for (const value of [
      "red",
      "rgb(1,2,3)",
      "var(--danger)",
      "#fff; --danger: green",
      "url(javascript:alert(1))",
      "}.x{color:red}",
      "expression(1)",
      "#1d4ed8}",
    ]) {
      assert.equal(isThemeColour(value), false, `${JSON.stringify(value)} must be refused`);
    }
  });

  it("agrees with the schema the API validates with", () => {
    // The domain predicate and the Zod refinement must accept the same set, or
    // a value could pass validation and then fall back at render — or worse,
    // pass the domain check having never been validated.
    for (const value of ["#abc", "#1d4ed8", "red", "rgb(1,2,3)", "#fff; --danger: green"]) {
      const viaSchema = updateBrandingSchema.safeParse({ primaryColor: value }).success;
      assert.equal(isThemeColour(value), viaSchema, `disagreement on ${JSON.stringify(value)}`);
    }
  });
});

describe("the schema refuses semantic and unknown tokens", () => {
  it("accepts the four theme tokens", () => {
    assert.ok(
      updateBrandingSchema.safeParse({
        theme: { sidebar: "#0f172a", sidebarText: "#ffffff", sidebarActive: "#2563eb", header: "#111827" },
      }).success
    );
  });

  it("REJECTS a semantic colour — branding must never change meaning", () => {
    for (const key of ["danger", "success", "warning", "error", "info"]) {
      assert.equal(
        updateBrandingSchema.safeParse({ theme: { [key]: "#00ff00" } }).success,
        false,
        `${key} must be refused`
      );
    }
  });

  it("REJECTS an unknown token rather than storing it", () => {
    assert.equal(updateBrandingSchema.safeParse({ theme: { sidebarr: "#fff" } }).success, false);
  });

  it("REJECTS a tenantId — the tenant comes from requireTenant", () => {
    assert.equal(
      updateBrandingSchema.safeParse({ primaryColor: "#fff", tenantId: "other" }).success,
      false
    );
  });

  it("accepts null to clear a token", () => {
    assert.ok(updateBrandingSchema.safeParse({ theme: { sidebar: null } }).success);
  });
});

describe("mergeThemeIntoSettings — a guest in a shared column", () => {
  it("preserves unrelated settings keys", () => {
    const before = { archive: { reason: "closed" }, locale: "en-IN" };
    const after = mergeThemeIntoSettings(before, { sidebar: "#0f172a" });

    assert.deepEqual(after.archive, { reason: "closed" });
    assert.equal(after.locale, "en-IN");
    assert.deepEqual(after.theme, { sidebar: "#0f172a" });
  });

  it("preserves theme tokens it was not asked to change", () => {
    const before = { theme: { sidebar: "#0f172a", header: "#111827" } };
    const after = mergeThemeIntoSettings(before, { sidebar: "#1d4ed8" });

    assert.deepEqual(after.theme, { sidebar: "#1d4ed8", header: "#111827" });
  });

  it("null REMOVES one token — reset to the product default", () => {
    const before = { theme: { sidebar: "#0f172a", header: "#111827" } };
    const after = mergeThemeIntoSettings(before, { sidebar: null });

    assert.deepEqual(after.theme, { header: "#111827" });
  });

  it("removes the theme key entirely once the last token is cleared", () => {
    // So a full reset leaves the column exactly as it was before this feature.
    const before = { archive: { reason: "closed" }, theme: { sidebar: "#0f172a" } };
    const after = mergeThemeIntoSettings(before, { sidebar: null });

    assert.equal("theme" in after, false);
    assert.deepEqual(after.archive, { reason: "closed" });
  });

  it("copes with a settings column that is null or malformed", () => {
    assert.deepEqual(mergeThemeIntoSettings(null, { sidebar: "#0f172a" }), {
      theme: { sidebar: "#0f172a" },
    });
    assert.deepEqual(mergeThemeIntoSettings("nonsense", { sidebar: "#0f172a" }), {
      theme: { sidebar: "#0f172a" },
    });
  });

  it("does not mutate the value it was given", () => {
    const before = { theme: { sidebar: "#0f172a" } };
    mergeThemeIntoSettings(before, { sidebar: "#1d4ed8" });

    assert.deepEqual(before, { theme: { sidebar: "#0f172a" } }, "input must be untouched");
  });
});

describe("extractThemeSettings", () => {
  it("returns an empty object for anything that is not a theme", () => {
    for (const settings of [null, undefined, 7, "x", [], {}, { theme: null }, { theme: "x" }]) {
      assert.deepEqual(extractThemeSettings(settings), {});
    }
  });
});

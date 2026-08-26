// ============================================================================
// OWNER  : Gauransh
// MODULE : Utils — Colour input
// LAYER  : Unit Tests
// PURPOSE: Pin the synchronisation rule between the tenant-branding hex field
//          and its colour picker.
//
// WHAT COULD GO WRONG, AND WHAT THESE ASSERT
//   The picker cannot render every value the branding API accepts. The risk is
//   that the workaround for that leaks backwards — that showing #abc as #aabbcc
//   ends up SAVING #aabbcc, quietly changing a university's brand colour into a
//   different string. swatchFor is display-only by construction: it is a pure
//   function of the stored value and nothing calls it on the save path. These
//   tests pin its output, and the branding-schema tests below pin that the API
//   still accepts exactly what it accepted before.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SWATCH_FALLBACK, swatchFor } from "@/lib/utils/colour";
import { platformBrandingSchema } from "@/lib/validations/platform";

describe("swatchFor — what the colour picker displays", () => {
  it("passes a six-digit hex through untouched", () => {
    assert.equal(swatchFor("#1d4ed8"), "#1d4ed8");
    assert.equal(swatchFor("#F59E0B"), "#F59E0B");
  });

  it("expands a three-digit hex for DISPLAY", () => {
    // The API accepts #abc, the picker cannot render it. Expanded here so the
    // swatch shows the real colour instead of falling back to grey.
    assert.equal(swatchFor("#abc"), "#aabbcc");
    assert.equal(swatchFor("#0F8"), "#00FF88");
  });

  it("falls back to a neutral grey for an unset colour", () => {
    // Not black: black is what the control defaults to on its own, and would be
    // indistinguishable from a deliberate choice of black.
    assert.equal(swatchFor(""), SWATCH_FALLBACK);
    assert.equal(swatchFor(null), SWATCH_FALLBACK);
    assert.equal(swatchFor(undefined), SWATCH_FALLBACK);
    assert.notEqual(SWATCH_FALLBACK, "#000000");
  });

  it("falls back while a value is being typed, rather than rendering nonsense", () => {
    for (const partial of ["#", "#1", "#12", "#12345", "#1234567", "1d4ed8", "red", "  "]) {
      assert.equal(swatchFor(partial), SWATCH_FALLBACK, `${JSON.stringify(partial)}`);
    }
  });

  it("never throws, whatever it is handed", () => {
    for (const value of ["", "   ", "#", "javascript:alert(1)", "#zzzzzz", "rgb(1,2,3)"]) {
      assert.doesNotThrow(() => swatchFor(value));
      assert.match(swatchFor(value), /^#[0-9a-fA-F]{6}$/, "must always be renderable");
    }
  });

  it("is PURE — it reports a colour and changes nothing", () => {
    // The guarantee that display-only really is display-only: the same input
    // always yields the same output and the input is untouched.
    const stored = "#abc";
    assert.equal(swatchFor(stored), swatchFor(stored));
    assert.equal(stored, "#abc");
  });
});

describe("the branding API contract is unchanged", () => {
  it("still accepts both hex forms the picker and the text box can produce", () => {
    // Six-digit is what the picker emits; three-digit is what an operator may
    // type. Both were accepted before this change and must remain so.
    assert.equal(platformBrandingSchema.safeParse({ primaryColor: "#1d4ed8" }).success, true);
    assert.equal(platformBrandingSchema.safeParse({ primaryColor: "#abc" }).success, true);
    assert.equal(platformBrandingSchema.safeParse({ accentColor: "#f59e0b" }).success, true);
  });

  it("still REJECTS anything that is not a hex colour", () => {
    for (const value of ["red", "rgb(1,2,3)", "#12345", "1d4ed8", "#zzzzzz", ""]) {
      assert.equal(
        platformBrandingSchema.safeParse({ primaryColor: value }).success,
        false,
        `${JSON.stringify(value)} must not reach the column`
      );
    }
  });

  it("still accepts null — clearing a colour remains possible", () => {
    assert.equal(platformBrandingSchema.safeParse({ primaryColor: null }).success, true);
    assert.equal(platformBrandingSchema.safeParse({ accentColor: null }).success, true);
  });

  it("still carries the other branding fields, untouched by this change", () => {
    const parsed = platformBrandingSchema.safeParse({
      logoUrl: "https://cdn.example.com/logo.svg",
      faviconUrl: "https://cdn.example.com/favicon.ico",
      primaryColor: "#1d4ed8",
      accentColor: "#f59e0b",
    });

    assert.ok(parsed.success);
    assert.deepEqual(Object.keys(parsed.data).sort(), [
      "accentColor",
      "faviconUrl",
      "logoUrl",
      "primaryColor",
    ]);
  });

  it("still REFUSES a tenantId in the body — authorization comes from the route", () => {
    // The isolation guarantee. .strict() means this is a 400, not a silent drop,
    // so no browser-supplied id can reach the update.
    assert.equal(
      platformBrandingSchema.safeParse({ primaryColor: "#1d4ed8", tenantId: "other_university" })
        .success,
      false
    );
  });

  it("still REFUSES an empty body", () => {
    assert.equal(platformBrandingSchema.safeParse({}).success, false);
  });
});

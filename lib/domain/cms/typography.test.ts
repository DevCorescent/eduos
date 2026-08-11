// ============================================================================
// Section and site typography is written by a university administrator and
// lands in a `style` attribute on the one page of this product served to
// anonymous visitors. The colour assertions below are a security specification,
// not a formatting preference — see lib/domain/tenant/branding.test.ts, which
// makes the same argument about the same allow-list.
//
// The scale and weight assertions are a different kind of guarantee: they pin
// that stored content can only ever select a value this repository already
// contains, which is what stops "font size" from becoming "arbitrary CSS".
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasTypography,
  parseTypography,
  typographyCssVars,
  typographySchema,
} from "./typography";

describe("typographySchema", () => {
  it("accepts an empty object — nothing set means inherit everything", () => {
    assert.equal(typographySchema.safeParse({}).success, true);
  });

  it("accepts a partial setting, because a section may override one thing", () => {
    const result = typographySchema.safeParse({ headingColor: "#1e3a8a" });
    assert.equal(result.success, true);
  });

  it("REFUSES a scale outside the vocabulary", () => {
    assert.equal(typographySchema.safeParse({ headingScale: "enormous" }).success, false);
  });

  it("REFUSES a weight outside the vocabulary", () => {
    assert.equal(typographySchema.safeParse({ bodyWeight: "900" }).success, false);
  });

  it("REFUSES an unknown key rather than storing it", () => {
    assert.equal(typographySchema.safeParse({ fontFamily: "Comic Sans" }).success, false);
  });
});

describe("typographyCssVars — colour is an allow-list, not an escape", () => {
  it("emits a valid hex", () => {
    assert.deepEqual(typographyCssVars({ headingColor: "#1e3a8a" }), {
      "--site-heading-color": "#1e3a8a",
    });
  });

  it("DROPS a value that would close the declaration and open another", () => {
    assert.deepEqual(typographyCssVars({ headingColor: "#fff;} body{display:none" }), {});
  });

  it("DROPS a url(), which is how a stylesheet starts making requests", () => {
    assert.deepEqual(typographyCssVars({ bodyColor: "url(https://attacker.example/x)" }), {});
  });

  it("DROPS a named colour — the pattern admits hex and nothing else", () => {
    assert.deepEqual(typographyCssVars({ bodyColor: "red" }), {});
  });
});

describe("typographyCssVars — the vocabularies map to real values", () => {
  it("turns a scale step into a multiplier and a weight into a number", () => {
    assert.deepEqual(typographyCssVars({ headingScale: "xl", headingWeight: "light" }), {
      "--site-heading-scale": "1.22",
      "--site-heading-weight": "300",
    });
  });

  it("emits ONLY what was set, so the cascade can carry the rest through", () => {
    const vars = typographyCssVars({ bodyScale: "sm" });
    assert.deepEqual(Object.keys(vars), ["--site-body-scale"]);
  });

  it("emits nothing at all for an absent setting", () => {
    assert.deepEqual(typographyCssVars(undefined), {});
    assert.deepEqual(typographyCssVars({}), {});
  });
});

describe("parseTypography — a bad stored row costs lettering, never the page", () => {
  it("returns no overrides for unparseable JSON rather than throwing", () => {
    assert.deepEqual(parseTypography({ headingScale: "enormous" }), {});
    assert.deepEqual(parseTypography("not an object"), {});
    assert.deepEqual(parseTypography(null), {});
  });

  it("returns what parses", () => {
    assert.deepEqual(parseTypography({ bodyWeight: "medium" }), { bodyWeight: "medium" });
  });
});

describe("hasTypography", () => {
  it("is false for absent and for empty", () => {
    assert.equal(hasTypography(undefined), false);
    assert.equal(hasTypography({}), false);
  });

  it("is true once one control is set", () => {
    assert.equal(hasTypography({ bodyScale: "lg" }), true);
  });
});

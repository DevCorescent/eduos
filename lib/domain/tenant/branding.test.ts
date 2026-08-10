// ============================================================================
// Brand colours are written by a university administrator and interpolated into
// a <style> block. Validation is the only thing between that field and CSS
// injection, so these assertions are a security specification, not a formatting
// preference.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  brandingCssVariables,
  isSafeAssetUrl,
  isValidBrandColour,
} from "./branding";

describe("isValidBrandColour — accepts", () => {
  it("every hex length a brand needs", () => {
    for (const value of ["#fff", "#FFFF", "#a1b2c3", "#A1B2C3FF"]) {
      assert.equal(isValidBrandColour(value), true, value);
    }
  });

  it("a value with incidental whitespace", () => {
    assert.equal(isValidBrandColour("  #F8EDE3  "), true);
  });
});

describe("isValidBrandColour — refuses anything that could escape a stylesheet", () => {
  it("a declaration break", () => {
    assert.equal(isValidBrandColour("#fff;} body{background:red"), false);
  });

  it("a url() payload", () => {
    assert.equal(isValidBrandColour("url(https://attacker/x)"), false);
    assert.equal(isValidBrandColour("#fff;background:url(//evil)"), false);
  });

  it("an expression or a script-ish value", () => {
    assert.equal(isValidBrandColour("javascript:alert(1)"), false);
    assert.equal(isValidBrandColour("expression(alert(1))"), false);
  });

  it("a comment that could open one", () => {
    assert.equal(isValidBrandColour("#fff/*"), false);
  });

  it("functional notations, refused for containing parentheses", () => {
    assert.equal(isValidBrandColour("rgb(255,0,0)"), false);
    assert.equal(isValidBrandColour("hsl(0 100% 50%)"), false);
  });

  it("named colours — a large, browser-dependent set that buys nothing", () => {
    assert.equal(isValidBrandColour("red"), false);
    assert.equal(isValidBrandColour("transparent"), false);
  });

  it("a hex of the wrong length, and a missing hash", () => {
    assert.equal(isValidBrandColour("#ff"), false);
    assert.equal(isValidBrandColour("#fffff"), false);
    assert.equal(isValidBrandColour("#1234567"), false);
    assert.equal(isValidBrandColour("ffffff"), false);
  });

  it("non-hex characters that look plausible", () => {
    assert.equal(isValidBrandColour("#gggggg"), false);
  });

  it("the empty string", () => {
    assert.equal(isValidBrandColour(""), false);
    assert.equal(isValidBrandColour("   "), false);
  });
});

describe("brandingCssVariables", () => {
  it("emits only the two variables the design system exposes", () => {
    assert.equal(
      brandingCssVariables({ primaryColor: "#F8EDE3", accentColor: "#D1E2D3" }),
      "--brand-primary:#F8EDE3;--brand-accent:#D1E2D3"
    );
  });

  it("DROPS an invalid value rather than substituting one", () => {
    // The design system's own colour is always legible; a near-miss guess at
    // what the administrator meant would be a worse surprise.
    assert.equal(
      brandingCssVariables({ primaryColor: "#fff;}evil{", accentColor: "#D1E2D3" }),
      "--brand-accent:#D1E2D3"
    );
  });

  it("emits nothing for a tenant that configured nothing", () => {
    assert.equal(brandingCssVariables({ primaryColor: null, accentColor: null }), "");
  });

  it("never emits a brace, semicolon-terminator or parenthesis from input", () => {
    const out = brandingCssVariables({
      primaryColor: "#fff} body{display:none",
      accentColor: "url(x)",
    });
    assert.equal(out, "");
  });
});

describe("isSafeAssetUrl", () => {
  it("accepts https and same-origin paths", () => {
    assert.equal(isSafeAssetUrl("https://cdn.university.edu/logo.png"), true);
    assert.equal(isSafeAssetUrl("/uploads/logo.png"), true);
  });

  it("refuses http — a mixed-content warning on every page", () => {
    assert.equal(isSafeAssetUrl("http://cdn.university.edu/logo.png"), false);
  });

  it("refuses a data: payload rendered under the institution's name", () => {
    assert.equal(isSafeAssetUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), false);
  });

  it("refuses javascript:", () => {
    assert.equal(isSafeAssetUrl("javascript:alert(1)"), false);
  });

  it("refuses protocol-relative, which downgrades on an http page", () => {
    assert.equal(isSafeAssetUrl("//evil.example/logo.png"), false);
  });

  it("refuses an unparseable value and the empty string", () => {
    assert.equal(isSafeAssetUrl("not a url"), false);
    assert.equal(isSafeAssetUrl(""), false);
    assert.equal(isSafeAssetUrl("   "), false);
  });
});

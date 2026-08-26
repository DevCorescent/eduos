// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Console Accent
// LAYER  : Constants — Unit Tests
// PURPOSE: Pin the two properties the accent feature rests on:
//
//          1. A malformed preference can never break the console. resolveAccent
//             is the only thing standing between a column an operator's browser
//             cannot influence and a stylesheet selector, and it must answer
//             with a renderable accent for literally any input.
//
//          2. The accent may only ever redefine ACCENT tokens. The stylesheet
//             is read here and asserted directly, because a comment saying
//             "never touch --success" is not enforcement — a future edit would
//             pass review and silently make a success badge change meaning for
//             an operator who picked red.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PLATFORM_ACCENTS,
  PLATFORM_ACCENT_LABELS,
  PLATFORM_ACCENT_SWATCHES,
  accentAttribute,
  resolveAccent,
} from "@/lib/constants/platformAccent";

describe("resolveAccent — a preference can never break the console", () => {
  it("returns every supported accent unchanged", () => {
    for (const accent of PLATFORM_ACCENTS) {
      assert.equal(resolveAccent(accent), accent);
    }
  });

  it("falls back to DEFAULT for null and undefined — an operator who never chose", () => {
    assert.equal(resolveAccent(null), "DEFAULT");
    assert.equal(resolveAccent(undefined), "DEFAULT");
  });

  it("falls back to DEFAULT for a value this release no longer recognises", () => {
    // A colour retired in a later version, still sitting in the column.
    assert.equal(resolveAccent("TEAL"), "DEFAULT");
  });

  it("falls back to DEFAULT for anything malformed, including injection attempts", () => {
    for (const value of [
      "",
      "   ",
      "blue",
      "Blue",
      "red; --danger: green",
      '"] { --success: red } [x="',
      "<script>",
      "../../etc/passwd",
      "DEFAULT ",
    ]) {
      assert.equal(resolveAccent(value), "DEFAULT", `${JSON.stringify(value)} must not pass`);
    }
  });

  it("is case-sensitive, so only the exact stored form is honoured", () => {
    assert.equal(resolveAccent("BLUE"), "BLUE");
    assert.equal(resolveAccent("blue"), "DEFAULT");
  });
});

describe("accentAttribute — DEFAULT is the absence of an override", () => {
  it("emits NO attribute for DEFAULT", () => {
    // So an operator who never chose renders a DOM identical to the one before
    // this feature existed, and the console inherits :root untouched.
    assert.equal(accentAttribute("DEFAULT"), undefined);
  });

  it("emits the accent name for every other accent", () => {
    for (const accent of PLATFORM_ACCENTS.filter((a) => a !== "DEFAULT")) {
      assert.equal(accentAttribute(accent), accent);
    }
  });
});

describe("the accent set is internally consistent", () => {
  it("every accent has a label and a swatch", () => {
    for (const accent of PLATFORM_ACCENTS) {
      assert.ok(PLATFORM_ACCENT_LABELS[accent], `${accent} needs a label`);
      assert.match(PLATFORM_ACCENT_SWATCHES[accent], /^#[0-9a-f]{6}$/i, `${accent} needs a swatch`);
    }
  });

  it("declares no accent the stylesheet cannot render", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

    for (const accent of PLATFORM_ACCENTS.filter((a) => a !== "DEFAULT")) {
      assert.ok(
        css.includes(`[data-platform-accent="${accent}"]`),
        `${accent} is offered but globals.css has no block for it`
      );
    }
  });
});

describe("an accent may redefine ACCENT tokens and nothing else", () => {
  /** Every custom property declared inside a [data-platform-accent] block. */
  function declaredProperties(): string[] {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const props: string[] = [];

    for (const match of css.matchAll(/\[data-platform-accent="[A-Z]+"\]\s*\{([^}]*)\}/g)) {
      for (const line of match[1].split("\n")) {
        const declaration = /^\s*(--[a-z-]+)\s*:/.exec(line);
        if (declaration) props.push(declaration[1]);
      }
    }

    return props;
  }

  it("touches no semantic colour — success, warning, danger or info", () => {
    // The rule that keeps taste from changing meaning. A red console must not
    // turn a success badge into an error.
    const forbidden = declaredProperties().filter((prop) =>
      /^--(success|warning|danger|info|color-(success|warning|error|info))/.test(prop)
    );

    assert.deepEqual(forbidden, [], "an accent block redefined a semantic colour");
  });

  it("declares only the known accent surfaces", () => {
    const allowed = new Set([
      "--primary",
      "--primary-hover",
      "--primary-active",
      "--primary-bg",
      "--primary-bg-foreground",
      "--ring",
      "--gradient-primary",
    ]);

    const unexpected = [...new Set(declaredProperties())].filter((prop) => !allowed.has(prop));

    assert.deepEqual(unexpected, [], "an accent block redefined something outside the accent set");
  });

  it("never redefines a token on :root — the override is scoped to the console", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

    // Every accent rule must be attribute-scoped. If one were written as
    // :root[data-…] or bare :root the accent would escape the console and reach
    // every tenant portal, which is the one failure this feature must not have.
    for (const match of css.matchAll(/([^\n}]*)\{[^}]*--primary\s*:/g)) {
      const selector = match[1];
      if (selector.includes("data-platform-accent")) {
        assert.ok(
          !selector.includes(":root"),
          "an accent block must not be anchored to :root"
        );
      }
    }
  });
});

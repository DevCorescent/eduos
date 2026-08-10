// ============================================================================
// The formatter and the reset rule are what an administrator configures and
// what a preview promises. These assertions are the specification: if one
// changes, the shape of an identifier printed on a degree certificate changed
// with it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT_TOKENS,
  formatIdentifier,
  needsReset,
  unknownTokens,
  type FormatConfig,
} from "./format";

const base: FormatConfig = {
  prefix: "STU-",
  suffix: null,
  format: "{PREFIX}{YEAR}{SEQ}",
  padding: 4,
};

const at = { year: 2026, month: 8 };

describe("formatIdentifier — the default shape", () => {
  it("renders prefix, year and a padded sequence", () => {
    assert.equal(formatIdentifier(base, 7, at), "STU-20260007");
  });

  it("pads to the configured width, and only the sequence", () => {
    assert.equal(
      formatIdentifier({ ...base, padding: 6 }, 123, at),
      "STU-2026000123"
    );
  });

  it("does not truncate a sequence that outgrows its padding", () => {
    // Dropping digits would reissue an identifier already in use. Growing the
    // string is the only safe answer.
    assert.equal(formatIdentifier(base, 123456, at), "STU-2026123456");
  });

  it("treats zero padding as no padding rather than throwing", () => {
    assert.equal(formatIdentifier({ ...base, padding: 0 }, 42, at), "STU-202642");
  });

  it("survives a negative padding, which the API should reject but must not crash on", () => {
    assert.equal(formatIdentifier({ ...base, padding: -3 }, 42, at), "STU-202642");
  });
});

describe("formatIdentifier — the PRD §9.2 examples", () => {
  it("builds STU-2026-CSE-000123", () => {
    assert.equal(
      formatIdentifier(
        { prefix: "STU-", suffix: null, format: "{PREFIX}{YEAR}-{PROGRAMME}-{SEQ}", padding: 6 },
        123,
        { ...at, programmeCode: "CSE" }
      ),
      "STU-2026-CSE-000123"
    );
  });

  it("builds EMP-JPR-ADM-00125", () => {
    assert.equal(
      formatIdentifier(
        { prefix: "EMP-", suffix: null, format: "{PREFIX}{CAMPUS}-{ROLE}-{SEQ}", padding: 5 },
        125,
        { ...at, campusCode: "JPR", roleCode: "ADM" }
      ),
      "EMP-JPR-ADM-00125"
    );
  });

  it("builds CERT-DATA-2026-004589", () => {
    assert.equal(
      formatIdentifier(
        { prefix: "CERT-", suffix: null, format: "{PREFIX}{COURSE}-{YEAR}-{SEQ}", padding: 6 },
        4589,
        { ...at, courseCode: "DATA" }
      ),
      "CERT-DATA-2026-004589"
    );
  });
});

describe("formatIdentifier — missing and unused values", () => {
  it("renders an unsupplied token as empty, never as the literal token", () => {
    // "{CAMPUS}" printed on an ID card is a bug made permanent.
    assert.equal(
      formatIdentifier({ ...base, format: "{PREFIX}{CAMPUS}{SEQ}" }, 1, at),
      "STU-0001"
    );
  });

  it("appends a configured suffix the format never references", () => {
    // Otherwise a saved setting would silently do nothing.
    assert.equal(
      formatIdentifier({ ...base, suffix: "-X" }, 1, at),
      "STU-20260001-X"
    );
  });

  it("does not append the suffix twice when the format places it", () => {
    assert.equal(
      formatIdentifier({ ...base, suffix: "-X", format: "{PREFIX}{SEQ}{SUFFIX}" }, 1, at),
      "STU-0001-X"
    );
  });

  it("treats a null prefix as empty", () => {
    assert.equal(formatIdentifier({ ...base, prefix: null }, 1, at), "20260001");
  });

  it("renders a two-digit year and a padded month", () => {
    assert.equal(
      formatIdentifier({ ...base, format: "{YY}{MONTH}{SEQ}" }, 1, { year: 2026, month: 3 }),
      "26030001"
    );
  });
});

describe("unknownTokens", () => {
  it("names a token the engine cannot render", () => {
    assert.deepEqual(unknownTokens("{PREFIX}{NONSENSE}{SEQ}"), ["NONSENSE"]);
  });

  it("accepts every declared token", () => {
    const all = FORMAT_TOKENS.map((t) => `{${t}}`).join("");
    assert.deepEqual(unknownTokens(all), []);
  });

  it("reports the PRD tokens this engine has not built, rather than hiding them", () => {
    assert.deepEqual(unknownTokens("{RAND}{CHECK}").sort(), ["CHECK", "RAND"]);
  });

  it("reports each unknown token once", () => {
    assert.deepEqual(unknownTokens("{X}-{X}-{X}"), ["X"]);
  });
});

describe("needsReset", () => {
  it("NEVER never resets, even across a year", () => {
    assert.equal(needsReset("NEVER", 2025, 12, { year: 2026, month: 1 }), false);
  });

  it("resets on first use, because there is no cycle to continue", () => {
    assert.equal(needsReset("YEARLY", null, null, { year: 2026, month: 1 }), true);
  });

  it("YEARLY resets across a year boundary and not within one", () => {
    assert.equal(needsReset("YEARLY", 2025, 12, { year: 2026, month: 1 }), true);
    assert.equal(needsReset("YEARLY", 2026, 1, { year: 2026, month: 12 }), false);
  });

  it("MONTHLY resets across a month and across a year", () => {
    assert.equal(needsReset("MONTHLY", 2026, 7, { year: 2026, month: 8 }), true);
    assert.equal(needsReset("MONTHLY", 2026, 8, { year: 2026, month: 8 }), false);
    assert.equal(needsReset("MONTHLY", 2025, 8, { year: 2026, month: 8 }), true);
  });

  it("SEMESTERLY splits the year at July", () => {
    // Same half — no reset.
    assert.equal(needsReset("SEMESTERLY", 2026, 1, { year: 2026, month: 6 }), false);
    assert.equal(needsReset("SEMESTERLY", 2026, 7, { year: 2026, month: 12 }), false);
    // Crossing the half — reset.
    assert.equal(needsReset("SEMESTERLY", 2026, 6, { year: 2026, month: 7 }), true);
    // Same half a year later is still a reset.
    assert.equal(needsReset("SEMESTERLY", 2025, 3, { year: 2026, month: 3 }), true);
  });

  it("SEMESTERLY resets when the month was never recorded", () => {
    assert.equal(needsReset("SEMESTERLY", 2026, null, { year: 2026, month: 3 }), true);
  });
});

// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Template variables
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the placeholder contract an authored template depends on.
//
//   A template is written once and rendered against many students. A typo in a
//   placeholder renders as literal braces on an official document that has
//   already been handed to somebody, so the picker is the only supported way to
//   insert one and unknown tokens are reported to the author rather than
//   silently blanked.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CERTIFICATE_VARIABLES,
  CERTIFICATE_VARIABLE_CATEGORIES,
  applySampleValues,
  isCertificateVariable,
  unknownVariables,
  variableToken,
} from "@/lib/domain/certificate/variables";

describe("the variable catalogue", () => {
  it("has a unique key, a label and a sample for every entry", () => {
    const keys = new Set<string>();
    for (const v of CERTIFICATE_VARIABLES) {
      assert.ok(!keys.has(v.key), `duplicate key ${v.key}`);
      keys.add(v.key);
      assert.ok(v.label.length > 0, `${v.key} needs a label`);
      assert.ok(v.sample.length > 0, `${v.key} needs a sample`);
      assert.ok(CERTIFICATE_VARIABLE_CATEGORIES.includes(v.category), `${v.key} category`);
    }
  });

  it("uses keys that are safe inside a {{token}}", () => {
    // Anything outside \w would not match the placeholder pattern and could
    // never be substituted — a control the picker offers that never works.
    for (const v of CERTIFICATE_VARIABLES) assert.match(v.key, /^\w+$/);
  });

  it("carries no real personal data as a sample", () => {
    // A designer working on a template must not be handling anybody's record.
    for (const v of CERTIFICATE_VARIABLES) {
      assert.ok(!/@(?!example)/.test(v.sample), `${v.key} sample looks like a real address`);
    }
  });
});

describe("unknownVariables — the author's typo net", () => {
  it("reports a placeholder this product cannot fill", () => {
    assert.deepEqual(unknownVariables("Hello {{studnetName}}"), ["studnetName"]);
  });

  it("reports nothing for a template using only real variables", () => {
    assert.deepEqual(unknownVariables("{{studentName}} — {{programName}} ({{academicYear}})"), []);
  });

  it("deduplicates and preserves first-seen order", () => {
    assert.deepEqual(unknownVariables("{{b}} {{a}} {{b}}"), ["b", "a"]);
  });

  it("tolerates whitespace inside the braces, as a person types it", () => {
    assert.deepEqual(unknownVariables("{{ studentName }}"), []);
  });

  it("ignores text that is not a placeholder", () => {
    assert.deepEqual(unknownVariables("A { brace } and {{ }} and {notone}"), []);
  });
});

describe("applySampleValues — preview substitution", () => {
  it("substitutes every known placeholder", () => {
    const out = applySampleValues("{{studentName}} of {{universityName}}");
    assert.ok(out.includes("Sample Student"));
    assert.ok(out.includes("Sample University"));
    assert.ok(!out.includes("{{"), "no placeholder should remain");
  });

  it("LEAVES an unknown placeholder exactly as written", () => {
    // Blanking it would hide the very typo the preview exists to reveal.
    assert.equal(applySampleValues("Hi {{studnetName}}"), "Hi {{studnetName}}");
  });

  it("uses an obviously fake certificate id", () => {
    // A preview must never look like a certificate that exists.
    const out = applySampleValues("{{certificateId}}");
    assert.equal(out, "CERT-YYYY-0000");
  });

  it("substitutes a repeated placeholder everywhere", () => {
    assert.equal(applySampleValues("{{grade}}/{{grade}}"), "Sample Grade/Sample Grade");
  });

  it("leaves a template with no placeholders untouched", () => {
    const html = "<h1>Certificate of Completion</h1>";
    assert.equal(applySampleValues(html), html);
  });
});

describe("variableToken", () => {
  it("wraps a key in the braces the template uses", () => {
    assert.equal(variableToken("studentName"), "{{studentName}}");
  });

  it("round-trips with the catalogue", () => {
    for (const v of CERTIFICATE_VARIABLES) {
      assert.deepEqual(unknownVariables(variableToken(v.key)), []);
      assert.ok(isCertificateVariable(v.key));
    }
  });
});

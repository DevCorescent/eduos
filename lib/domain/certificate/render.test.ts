// ============================================================================
// TESTS: Certificate rendering.
//
// The renderer is what turns a stored design and one student's real record into
// the document somebody is handed. Two properties matter enough to pin down:
// a substituted value can never become markup, and a placeholder nothing can
// fill is left visible rather than silently blanked.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeValue, substitute, renderCertificateDocument } from "./render";

describe("escapeValue", () => {
  it("escapes every character that can change surrounding markup", () => {
    assert.equal(escapeValue(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
  });

  it("escapes the ampersand first, so an escape is not double-escaped", () => {
    assert.equal(escapeValue("&lt;"), "&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    assert.equal(escapeValue("Priya Raman"), "Priya Raman");
  });
});

describe("substitute", () => {
  it("replaces a placeholder with its value", () => {
    assert.equal(substitute("<p>{{studentName}}</p>", { studentName: "Aarav" }), "<p>Aarav</p>");
  });

  it("tolerates whitespace inside the braces", () => {
    assert.equal(substitute("{{  studentName  }}", { studentName: "Aarav" }), "Aarav");
  });

  it("leaves an unknown placeholder exactly as written", () => {
    // Blanking it would print a certificate with a silent gap where a
    // qualification should be. Left visible, the mistake is obvious.
    assert.equal(substitute("<p>{{nonsense}}</p>", {}), "<p>{{nonsense}}</p>");
  });

  it("escapes the value, so a record cannot inject markup", () => {
    const out = substitute("<p>{{studentName}}</p>", {
      studentName: "<img src=x onerror=alert(1)>",
    });

    assert.ok(!out.includes("<img"), "the tag must not survive substitution");
    assert.ok(out.includes("&lt;img"), "it must be visible as text instead");
  });

  it("does not rescan a substituted value for further placeholders", () => {
    // A value containing a token must print, not resolve — otherwise one
    // student's record could pull in another field.
    const out = substitute("{{studentName}}", { studentName: "{{grade}}", grade: "A" });
    assert.equal(out, "{{grade}}");
  });
});

describe("renderCertificateDocument", () => {
  const design = { html: "<h1>{{studentName}}</h1>", css: ".certificate-page{padding:10px}" };

  it("produces a complete A4 document", () => {
    const doc = renderCertificateDocument(design, { studentName: "Aarav" });

    assert.ok(doc.startsWith("<!doctype html>"));
    assert.ok(doc.includes("@page { size: A4 portrait"));
    assert.ok(doc.includes("width: 210mm"));
    assert.ok(doc.includes("min-height: 297mm"));
    // Without this a browser's "economy" print settings drop the border, and
    // the printed document is not the one that was issued.
    assert.ok(doc.includes("print-color-adjust: exact"));
  });

  it("substitutes the values into the body", () => {
    const doc = renderCertificateDocument(design, { studentName: "Aarav" });
    assert.ok(doc.includes("<h1>Aarav</h1>"));
  });

  it("keeps the author's stylesheet", () => {
    const doc = renderCertificateDocument(design, { studentName: "Aarav" });
    assert.ok(doc.includes(".certificate-page{padding:10px}"));
  });

  it("tolerates a design with no stylesheet", () => {
    assert.doesNotThrow(() => renderCertificateDocument({ html: "<p>x</p>", css: null }, {}));
    assert.doesNotThrow(() =>
      renderCertificateDocument({ html: "<p>x</p>", css: undefined }, {})
    );
  });

  it("strips executable markup that was stored in the template", () => {
    const doc = renderCertificateDocument(
      { html: "<script>steal()</script><h1>Real</h1>", css: "" },
      {}
    );

    assert.ok(!doc.includes("<script>steal"), "the script must not survive");
    assert.ok(doc.includes("<h1>Real</h1>"), "the rest of the document must survive");
  });

  it("sanitises before substituting, so a value cannot complete a tag", () => {
    // The template ends mid-tag and the value would close it. Because
    // sanitisation runs first AND values are escaped, neither half executes.
    const doc = renderCertificateDocument(
      { html: "<p>{{studentName}}</p>", css: "" },
      { studentName: "<scr" + "ipt>alert(1)</scr" + "ipt>" }
    );

    assert.ok(!/<\s*script/i.test(doc), "no script tag may appear in the output");
  });

  it("strips @import from the stylesheet", () => {
    const doc = renderCertificateDocument(
      { html: "<p>x</p>", css: "@import url(http://evil.test/a.css); p{color:red}" },
      {}
    );

    assert.ok(!doc.includes("@import"));
    assert.ok(doc.includes("p{color:red}"), "the rest of the stylesheet survives");
  });
});

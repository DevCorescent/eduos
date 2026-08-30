// ============================================================================
// TESTS: Certificate template versioning — the pure decision rules.
//
// applyTemplateEdit itself needs a database and is verified against a live
// tenant rather than mocked. What is tested here is the two pure functions the
// rule is built out of, because getting either wrong silently changes an
// already-issued certificate.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { touchesDesign, lineageRootId } from "./certificateTemplateVersions";

describe("touchesDesign", () => {
  it("is true for each field a holder would see on the paper", () => {
    assert.equal(touchesDesign({ htmlTemplate: "<p>x</p>" }), true);
    assert.equal(touchesDesign({ cssStyles: "p{}" }), true);
    assert.equal(touchesDesign({ name: "Degree" }), true);
    assert.equal(touchesDesign({ type: "DEGREE" }), true);
  });

  it("is false for a status-only change", () => {
    // Archiving or publishing alters no design, so it must apply in place even
    // on an issued template. Forking here would fill the history with versions
    // that differ in nothing.
    assert.equal(touchesDesign({ isActive: false }), false);
    assert.equal(touchesDesign({ isActive: true }), false);
  });

  it("is false for an empty patch", () => {
    assert.equal(touchesDesign({}), false);
  });

  it("is true when a design field accompanies a status change", () => {
    assert.equal(touchesDesign({ isActive: true, htmlTemplate: "<p>x</p>" }), true);
  });

  it("treats an explicitly empty design field as a change", () => {
    // Clearing the stylesheet IS a redesign, and an issued certificate must not
    // lose its styling because the empty string read as "nothing to do".
    assert.equal(touchesDesign({ cssStyles: "" }), true);
  });
});

describe("lineageRootId", () => {
  it("returns the row's own id when it is the first version", () => {
    assert.equal(lineageRootId({ id: "tpl_1", parentTemplateId: null }), "tpl_1");
  });

  it("returns the parent for a forked version", () => {
    assert.equal(lineageRootId({ id: "tpl_2", parentTemplateId: "tpl_1" }), "tpl_1");
  });

  it("keeps every version of one lineage on the same root", () => {
    // v3 forked from v2 still records the ROOT as its parent, so the whole
    // lineage is one query rather than a walk up a chain.
    const root = lineageRootId({ id: "tpl_1", parentTemplateId: null });

    assert.equal(lineageRootId({ id: "tpl_2", parentTemplateId: root }), root);
    assert.equal(lineageRootId({ id: "tpl_3", parentTemplateId: root }), root);
  });
});

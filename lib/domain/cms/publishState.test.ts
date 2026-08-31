// ============================================================================
// TESTS: Publish state.
//
// The badge on the Website screen is an assertion about what the public can
// see. Getting it wrong tells an administrator their edits are live when they
// are not — or that they are private when a visitor is reading them.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasUnpublishedChanges,
  publishState,
  isPubliclyVisible,
  PUBLISH_STATE_LABEL,
} from "./publishState";

const blocks = [{ id: "a", type: "hero", props: { headline: "Hello" } }];

describe("hasUnpublishedChanges", () => {
  it("is false for identical content", () => {
    assert.equal(hasUnpublishedChanges(blocks, structuredClone(blocks)), false);
  });

  it("is false when only key ORDER differs", () => {
    // The draft is rebuilt from a request body and the published copy was
    // cloned from an earlier draft, so the same content legitimately arrives
    // with its keys in a different order. Reporting that as an unpublished
    // change sends the admin hunting for an edit that does not exist.
    const a = [{ id: "a", type: "hero", props: { headline: "Hi", sub: "x" } }];
    const b = [{ type: "hero", id: "a", props: { sub: "x", headline: "Hi" } }];
    assert.equal(hasUnpublishedChanges(a, b), false);
  });

  it("is true when a value changed", () => {
    assert.equal(
      hasUnpublishedChanges(blocks, [{ id: "a", type: "hero", props: { headline: "Bye" } }]),
      true
    );
  });

  it("is true when a section was added", () => {
    assert.equal(hasUnpublishedChanges([...blocks, { id: "b", type: "stats" }], blocks), true);
  });

  it("is true when sections were REORDERED", () => {
    // Order is meaning on a page, so arrays are never sorted before comparing.
    const one = [{ id: "a" }, { id: "b" }];
    const two = [{ id: "b" }, { id: "a" }];
    assert.equal(hasUnpublishedChanges(one, two), true);
  });

  it("treats a missing published copy as a difference", () => {
    assert.equal(hasUnpublishedChanges(blocks, null), true);
  });
});

describe("publishState", () => {
  it("is NEVER_PUBLISHED with no row at all", () => {
    assert.equal(publishState(null), "NEVER_PUBLISHED");
  });

  it("is NEVER_PUBLISHED for a draft that was never published", () => {
    assert.equal(
      publishState({
        status: "DRAFT",
        draftBlocks: blocks,
        publishedBlocks: null,
        publishedAt: null,
      }),
      "NEVER_PUBLISHED"
    );
  });

  it("is PUBLISHED when the draft matches what is live", () => {
    assert.equal(
      publishState({
        status: "PUBLISHED",
        draftBlocks: blocks,
        publishedBlocks: structuredClone(blocks),
        publishedAt: new Date(),
      }),
      "PUBLISHED"
    );
  });

  it("is UNPUBLISHED_CHANGES when the draft has moved on", () => {
    assert.equal(
      publishState({
        status: "PUBLISHED",
        draftBlocks: [{ id: "a", type: "hero", props: { headline: "New" } }],
        publishedBlocks: blocks,
        publishedAt: new Date(),
      }),
      "UNPUBLISHED_CHANGES"
    );
  });

  it("reports ARCHIVED ahead of any content comparison", () => {
    // "Taken down" is a deliberate act and describes the page better than
    // whether its draft happens to differ.
    assert.equal(
      publishState({
        status: "ARCHIVED",
        draftBlocks: blocks,
        publishedBlocks: blocks,
        publishedAt: new Date(),
      }),
      "ARCHIVED"
    );
  });
});

describe("isPubliclyVisible", () => {
  it("is true only while a published copy is being served", () => {
    assert.equal(isPubliclyVisible("PUBLISHED"), true);
    // Still visible — the OLDER published copy is what visitors get.
    assert.equal(isPubliclyVisible("UNPUBLISHED_CHANGES"), true);
    assert.equal(isPubliclyVisible("NEVER_PUBLISHED"), false);
    assert.equal(isPubliclyVisible("ARCHIVED"), false);
  });
});

describe("PUBLISH_STATE_LABEL", () => {
  it("says the public is seeing the DEFAULT site, not that nothing exists", () => {
    // The distinction matters: a visitor to an unpublished university's address
    // gets the platform default, so "Draft" would understate what is public.
    assert.equal(PUBLISH_STATE_LABEL.NEVER_PUBLISHED, "Using default website");
    assert.equal(PUBLISH_STATE_LABEL.PUBLISHED, "Published");
    assert.equal(PUBLISH_STATE_LABEL.UNPUBLISHED_CHANGES, "Unpublished changes");
  });
});

// ============================================================================
// TESTS: Starting website content.
//
// defaultLandingBlocks is the seam between "the platform has a default site"
// and "this university has one". It is exercised here against a stub client
// rather than a database: what matters is the DECISION it makes about stored
// JSON, and that decision must never throw on a template that predates a
// schema change.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultLandingBlocks, DEFAULT_LANDING_KEY } from "./cmsProvisioning";

/** A stand-in for the transaction client, returning one canned template row. */
function client(blocks: unknown) {
  return {
    cmsTemplate: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        assert.equal(where.key, DEFAULT_LANDING_KEY, "must read the default template");
        return blocks === undefined ? null : { blocks };
      },
    },
  } as never;
}

const validBlock = { id: "hero-1", type: "richText", props: { heading: "Hi", body: "Welcome" } };

describe("defaultLandingBlocks", () => {
  it("returns the template's blocks", async () => {
    const blocks = await defaultLandingBlocks(client([validBlock]));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "richText");
  });

  it("returns an empty array when no template exists", async () => {
    // A platform that has not authored a template must still be able to
    // onboard a university. Empty is an answer, not a failure.
    assert.deepEqual(await defaultLandingBlocks(client(undefined)), []);
  });

  it("returns an empty array for a template holding an empty list", async () => {
    assert.deepEqual(await defaultLandingBlocks(client([])), []);
  });

  it("does not throw on stored content it cannot parse", async () => {
    // The column is Json. A template saved before a schema change could hold
    // anything, and provisioning must not fail because of it.
    for (const junk of [null, "a string", 42, { not: "an array" }, [{ type: "unknown" }]]) {
      const blocks = await defaultLandingBlocks(client(junk));
      assert.ok(Array.isArray(blocks), `expected an array for ${JSON.stringify(junk)}`);
    }
  });

  it("rejects the WHOLE list when any entry is unparseable", async () => {
    // parseStoredBlocks validates the array as one value, so a single bad block
    // yields []. That is all-or-nothing rather than per-entry salvage, and it
    // is the safe direction here: provisioning then creates no page, and the
    // university starts on an empty canvas exactly as it did before this
    // module existed — rather than on a half a default site nobody authored.
    const blocks = await defaultLandingBlocks(client([validBlock, { type: "nonsense" }]));
    assert.deepEqual(blocks, []);
  });
});

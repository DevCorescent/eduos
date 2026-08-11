// ============================================================================
// The hero's first panel IS the block's own props, so that every hero already
// published — in the template, in the seed, on a live tenant domain — keeps
// parsing after the carousel was added. parseStoredBlocks answers a failed
// parse with an EMPTY page, so a regression here would blank institutions'
// homepages at deploy time rather than fail loudly. These assertions pin that.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksSchema, defaultBlock, heroSlides, parseStoredBlocks } from "./blocks";

/** A hero exactly as it was stored before carousels existed. */
const LEGACY_HERO = {
  id: "hero",
  type: "hero",
  props: {
    eyebrow: "Admissions open",
    heading: "Build a career worth the effort",
    subheading: "A sentence about the institution.",
    primaryCta: { label: "Apply now", href: "/admissions" },
    imageUrl: "https://images.example.com/campus.jpg",
  },
};

describe("hero — content stored before the carousel existed", () => {
  it("still parses", () => {
    const result = blocksSchema.safeParse([LEGACY_HERO]);
    assert.equal(result.success, true);
  });

  it("survives parseStoredBlocks rather than blanking the page", () => {
    assert.equal(parseStoredBlocks([LEGACY_HERO]).length, 1);
  });

  it("takes the schema's layout defaults", () => {
    const [block] = blocksSchema.parse([LEGACY_HERO]);
    assert.equal(block.type, "hero");
    if (block.type !== "hero") return;

    assert.equal(block.props.layout, "single");
    assert.equal(block.props.align, "left");
    assert.equal(block.props.height, "standard");
    assert.equal(block.props.autoplaySeconds, 6);
  });

  it("renders as exactly one panel", () => {
    const [block] = blocksSchema.parse([LEGACY_HERO]);
    if (block.type !== "hero") throw new Error("unreachable");

    const slides = heroSlides(block.props);
    assert.equal(slides.length, 1);
    assert.equal(slides[0].heading, "Build a career worth the effort");
  });
});

describe("heroSlides", () => {
  const withExtras = {
    ...LEGACY_HERO,
    props: {
      ...LEGACY_HERO.props,
      layout: "carousel",
      slides: [
        { heading: "Second panel" },
        { heading: "Third panel" },
      ],
    },
  };

  it("puts the block's own props first, then the extras in order", () => {
    const [block] = blocksSchema.parse([withExtras]);
    if (block.type !== "hero") throw new Error("unreachable");

    assert.deepEqual(
      heroSlides(block.props).map((slide) => slide.heading),
      ["Build a career worth the effort", "Second panel", "Third panel"]
    );
  });

  it("shows ONLY the first panel when layout is single, without deleting the rest", () => {
    const [block] = blocksSchema.parse([{ ...withExtras, props: { ...withExtras.props, layout: "single" } }]);
    if (block.type !== "hero") throw new Error("unreachable");

    assert.equal(heroSlides(block.props).length, 1);
    // Still stored — switching back to carousel must not have cost anything.
    assert.equal(block.props.slides?.length, 2);
  });

  it("carries no layout settings into a slide", () => {
    const [block] = blocksSchema.parse([withExtras]);
    if (block.type !== "hero") throw new Error("unreachable");

    for (const slide of heroSlides(block.props)) {
      assert.equal("height" in slide, false);
      assert.equal("align" in slide, false);
      assert.equal("style" in slide, false);
    }
  });
});

describe("hero — bounds", () => {
  it("refuses an autoplay too fast to read", () => {
    const result = blocksSchema.safeParse([
      { ...LEGACY_HERO, props: { ...LEGACY_HERO.props, autoplaySeconds: 1 } },
    ]);
    assert.equal(result.success, false);
  });

  it("refuses more extra panels than a visitor will ever scroll past", () => {
    const result = blocksSchema.safeParse([
      {
        ...LEGACY_HERO,
        props: {
          ...LEGACY_HERO.props,
          slides: Array.from({ length: 6 }, (_, i) => ({ heading: `Panel ${i}` })),
        },
      },
    ]);
    assert.equal(result.success, false);
  });
});

describe("defaultBlock('hero')", () => {
  it("parses against its own schema, so a freshly added hero can be saved", () => {
    const block = defaultBlock("hero", "new");
    assert.equal(blocksSchema.safeParse([block]).success, true);
  });

  it("writes the layout settings out, so the editor's selects are not blank", () => {
    const block = defaultBlock("hero", "new");
    if (block.type !== "hero") throw new Error("unreachable");

    assert.equal(block.props.layout, "single");
    assert.equal(block.props.height, "standard");
  });
});

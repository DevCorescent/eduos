// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Block Renderer (W4, PRD §7)
// LAYER  : Presentation (Server Component)
// PURPOSE: Turn a stored block array into a page.
//
// UNKNOWN TYPES RENDER NOTHING, THEY DO NOT THROW
//   parseStoredBlocks already dropped anything the schema rejects, so a type
//   reaching here without a component means one specific thing: content was
//   published by a NEWER deploy than the one now serving it — a rollback, or a
//   canary behind a load balancer.
//
//   Skipping costs the visitor one section. Throwing costs the university its
//   entire homepage, on its own domain, for as long as the rollback lasts. The
//   asymmetry is the whole argument.
//
// BANDING IS DECIDED HERE, NOT BY THE EDITOR
//   Consecutive sections need to read as separate without reading as different
//   pages, and the cheapest way to do that is to alternate the background. Doing
//   it here rather than as a per-block field means the alternation SURVIVES a
//   reorder: move a section up and the whole page re-bands itself correctly,
//   which is exactly what an editor expects and exactly what a stored per-block
//   tone would get wrong.
// ============================================================================

import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import type { SectionTone } from "./Section";
import {
  CardGridBlock,
  CtaBlock,
  FaqBlock,
  FeaturesBlock,
  HeroBlock,
  LinkGridBlock,
  PlacementsBlock,
  ProgrammesBlock,
  RichTextBlock,
  SplitBandBlock,
  StatsBlock,
  TestimonialsBlock,
} from "./blocks";

export interface BlockRendererProps {
  blocks: CmsBlocks;
  /**
   * Resolved from the hostname by the page, never from a URL parameter.
   *
   * NULL IN THE PLATFORM'S TEMPLATE PREVIEW, where there is no institution: the
   * programmes block then draws labelled sample rows instead of querying. Only
   * that block reads it, but it is passed to the renderer rather than to that
   * block alone — a block needing tenant-scoped data should not have to be
   * special-cased at every call site to get it.
   */
  tenantId: string | null;
}

/**
 * Block types that render inside the shared <Section> shell and therefore take
 * part in the alternating background.
 *
 * `hero` is full-bleed and `splitBand` is a coloured rule between sections;
 * both set their own ground, so counting them would put two same-toned sections
 * next to each other every time one appeared.
 */
const BANDED = new Set([
  "stats",
  "programmes",
  "features",
  "cardGrid",
  "linkGrid",
  "testimonials",
  "placements",
  "faq",
  "cta",
  "richText",
]);

export function BlockRenderer({ blocks, tenantId }: BlockRendererProps) {
  // Incremented only for banded blocks, so the stripe pattern is unbroken by a
  // hero or a split band sitting between two sections.
  let band = 0;

  return (
    <>
      {blocks.map((block) => {
        const tone: SectionTone = BANDED.has(block.type)
          ? band++ % 2 === 0
            ? "plain"
            : "muted"
          : "plain";

        // The switch is exhaustive over the discriminated union, so adding a
        // block type to lib/domain/cms/blocks.ts without adding a case here is
        // a TYPE ERROR at build time — the omission is caught before it can
        // become a silently missing section.
        switch (block.type) {
          case "hero":
            return <HeroBlock key={block.id} {...block} />;
          case "stats":
            return <StatsBlock key={block.id} {...block} tone={tone} />;
          case "programmes":
            return (
              <ProgrammesBlock key={block.id} {...block} tenantId={tenantId} tone={tone} />
            );
          case "features":
            return <FeaturesBlock key={block.id} {...block} tone={tone} />;
          case "cardGrid":
            return <CardGridBlock key={block.id} {...block} tone={tone} />;
          case "linkGrid":
            return <LinkGridBlock key={block.id} {...block} tone={tone} />;
          case "splitBand":
            return <SplitBandBlock key={block.id} {...block} />;
          case "testimonials":
            return <TestimonialsBlock key={block.id} {...block} tone={tone} />;
          case "placements":
            return <PlacementsBlock key={block.id} {...block} tone={tone} />;
          case "faq":
            return <FaqBlock key={block.id} {...block} tone={tone} />;
          case "cta":
            return <CtaBlock key={block.id} {...block} tone={tone} />;
          case "richText":
            return <RichTextBlock key={block.id} {...block} tone={tone} />;
          default:
            // Unreachable while the switch stays exhaustive; present so a
            // forward-rolled block type degrades to a gap rather than a crash.
            return null;
        }
      })}
    </>
  );
}

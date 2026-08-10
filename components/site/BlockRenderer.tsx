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
// ============================================================================

import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import {
  CardGridBlock,
  CtaBlock,
  FaqBlock,
  FeaturesBlock,
  HeroBlock,
  LinkGridBlock,
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
   * Only the programmes block reads it, but it is passed to the renderer rather
   * than to that block alone: a block that needs tenant-scoped data should not
   * have to be special-cased at every call site to get it.
   */
  tenantId: string;
}

export function BlockRenderer({ blocks, tenantId }: BlockRendererProps) {
  return (
    <>
      {blocks.map((block) => {
        // The switch is exhaustive over the discriminated union, so adding a
        // block type to lib/domain/cms/blocks.ts without adding a case here is
        // a TYPE ERROR at build time — the omission is caught before it can
        // become a silently missing section.
        switch (block.type) {
          case "hero":
            return <HeroBlock key={block.id} {...block} />;
          case "stats":
            return <StatsBlock key={block.id} {...block} />;
          case "programmes":
            return <ProgrammesBlock key={block.id} {...block} tenantId={tenantId} />;
          case "features":
            return <FeaturesBlock key={block.id} {...block} />;
          case "cardGrid":
            return <CardGridBlock key={block.id} {...block} />;
          case "linkGrid":
            return <LinkGridBlock key={block.id} {...block} />;
          case "splitBand":
            return <SplitBandBlock key={block.id} {...block} />;
          case "testimonials":
            return <TestimonialsBlock key={block.id} {...block} />;
          case "faq":
            return <FaqBlock key={block.id} {...block} />;
          case "cta":
            return <CtaBlock key={block.id} {...block} />;
          case "richText":
            return <RichTextBlock key={block.id} {...block} />;
          default:
            // Unreachable while the switch stays exhaustive; present so a
            // forward-rolled block type degrades to a gap rather than a crash.
            return null;
        }
      })}
    </>
  );
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Block Registry (W4, PRD §7.2, §7.3)
// LAYER  : Domain (pure — no React, no Prisma, no fetch)
// PURPOSE: Define what a block IS. One Zod schema per block type, and a
//          discriminated union over all of them.
//
// THIS FILE IS THE CONTRACT BETWEEN THE DATABASE AND THE RENDERER
//   CmsPage.draftBlocks is a Json column, so Postgres will accept any shape at
//   all — including one that makes the public website throw while rendering.
//   Nothing else stands between an editor's input and a live page, so every
//   write goes through `blocksSchema` here, and the renderer reads the SAME
//   schema's inferred types. A block that cannot be parsed cannot be saved, and
//   a block that was saved can always be rendered.
//
// PURE ON PURPOSE
//   No React import, so an API route can validate a page without pulling the
//   component tree into a server bundle. The components live in
//   components/site/blocks and are matched to these types by BlockRenderer.
//
// ADDING A BLOCK TYPE IS THREE EDITS, IN THIS ORDER
//   1. a schema here, added to the union
//   2. a component in components/site/blocks
//   3. an entry in BlockRenderer's map
//   Miss (3) and the block renders as nothing rather than crashing — see the
//   renderer's note on why unknown types are skipped rather than thrown on.
// ============================================================================

import { z } from "zod";
import { typographySchema } from "./typography";

// --- Shared field rules -----------------------------------------------------

/**
 * A link target an editor may type.
 *
 * Relative paths and https only. `javascript:` and `data:` are the reason this
 * is not a bare string: block props are tenant-authored and land in an href,
 * so an unvalidated value here is a stored-XSS vector on the one page of the
 * product that is served to anonymous visitors.
 *
 * Protocol-relative ("//evil.example") is rejected before the URL parser, which
 * would otherwise accept it and inherit the page's scheme.
 */
const href = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      if (value.startsWith("//")) return false;
      if (value.startsWith("/")) return true;
      if (value.startsWith("#")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "mailto:";
      } catch {
        return false;
      }
    },
    { message: "Must be a relative path, an https:// URL, or a mailto: link" }
  );

/**
 * An image source.
 *
 * Same rule as `href` minus mailto. There is no object storage in this project
 * yet — PRD §7.3 "Media library" is unbuilt — so an editor supplies a URL and
 * this is the only thing checking it.
 */
const imageUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      if (value.startsWith("//")) return false;
      if (value.startsWith("/")) return true;
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a relative path or an https:// URL" }
  );

/** A short display string. Bounded so one block cannot carry a document. */
const line = z.string().trim().min(1).max(200);

/** A paragraph. Longer bound, still bounded. */
const prose = z.string().trim().min(1).max(2000);

/** A call-to-action button. */
const cta = z.object({ label: line, href });

/**
 * A video source for the hero.
 *
 * Same host rules as an image. `.mp4`/`.webm` is not enforced — a CDN can serve
 * a video from an extensionless URL, and refusing those would reject valid
 * sources to catch a mistake the <video> element already handles by falling
 * back to its poster.
 */
const videoUrl = imageUrl;

/**
 * The icon vocabulary an editor may choose from.
 *
 * AN ENUM, NOT A FREE STRING, AND THAT IS A SECURITY BOUNDARY
 *   The renderer maps this to a React component. A free-text field would mean
 *   looking a component up by a name that came out of the database — which is
 *   how stored content starts choosing what code runs. A closed set can only
 *   ever select something this repository already contains.
 *
 *   The names are lucide's, so adding one is a one-line change in two files.
 */
export const BLOCK_ICONS = [
  "graduation-cap",
  "book-open",
  "microscope",
  "palette",
  "scale",
  "stethoscope",
  "cpu",
  "briefcase",
  "users",
  "trophy",
  "globe",
  "sparkles",
] as const;

const icon = z.enum(BLOCK_ICONS);

export type BlockIcon = (typeof BLOCK_ICONS)[number];

/**
 * Per-section typography, on EVERY block type.
 *
 * WHY EVERY BLOCK CARRIES THIS RATHER THAN A CHOSEN FEW
 *   "Change the font for this section" is a question an editor asks of whatever
 *   section they are looking at, and a control that appears on some blocks and
 *   not others reads as a bug. It is optional everywhere, emits nothing when
 *   unset, and costs an absent key in the stored JSON — so the uniformity is
 *   free.
 *
 * The site-wide setting lives on CmsSite/CmsTemplate; this overrides it for one
 * section. Neither is merged in code — see typography.ts on why the browser's
 * cascade resolves them.
 */
const style = typographySchema.optional();

// --- Block prop schemas -----------------------------------------------------

/**
 * One hero panel: everything a full-bleed opening slide needs.
 *
 * Extracted from the hero's own props so a carousel slide and a single hero are
 * literally the same shape. They are rendered by the same component, so a
 * template author switching between the two never loses a field or gains one.
 */
const heroSlideProps = z.object({
  /** A short line above the headline, as in the reference designs. */
  eyebrow: line.optional(),
  heading: line,
  subheading: prose.optional(),
  primaryCta: cta.optional(),
  secondaryCta: cta.optional(),
  imageUrl: imageUrl.optional(),
  /**
   * A looping background video.
   *
   * `imageUrl` doubles as its poster when both are set, so the still shows
   * immediately and the video takes over once enough of it has buffered. A
   * visitor on a slow connection, or one who has asked for reduced motion,
   * therefore never sees an empty hero — which is why the two fields are
   * independent rather than one "background" field with a type discriminator.
   */
  videoUrl: videoUrl.optional(),
});

export type HeroSlide = z.infer<typeof heroSlideProps>;

/**
 * The hero: one panel, or several on a timer.
 *
 * THE FIRST SLIDE IS THE BLOCK'S OWN PROPS, AND THAT IS A COMPATIBILITY
 * DECISION, NOT AN AESTHETIC ONE
 *   Every hero already stored — in the template, in the seed, on Demo
 *   University's live homepage — has `heading` and `subheading` at the top
 *   level. Moving them into a `slides[0]` would make `parseStoredBlocks` reject
 *   every one of them, and parseStoredBlocks answers a failed parse with an
 *   EMPTY PAGE. The upgrade would have blanked every published homepage on the
 *   platform at deploy time.
 *
 *   So the top level stays the first slide and `slides` holds the ones after
 *   it. Existing content parses unchanged and renders exactly as before, because
 *   `slides` is absent and a one-slide carousel is a hero.
 *
 * `layout` IS SEPARATE FROM THE SLIDE COUNT, DELIBERATELY
 *   An editor who has built four slides and wants to show one for a fortnight
 *   should not have to delete three. "single" shows the first and keeps the rest
 *   on the shelf.
 */
const heroProps = heroSlideProps.extend({
  layout: z.enum(["single", "carousel"]).default("single"),

  /** Slides AFTER the first. Bounded — a homepage carousel nobody scrolls past
   *  slide three is a well-documented waste of the six most valuable seconds a
   *  visitor will give an institution. */
  slides: z.array(heroSlideProps).max(5).optional(),

  /** Seconds each slide holds. Floor of 3 so a slide is readable; ceiling of 20
   *  so a stalled carousel is distinguishable from a broken one. */
  autoplaySeconds: z.number().int().min(3).max(20).default(6),

  align: z.enum(["left", "center"]).default("left"),

  /** How much vertical room the panel takes. */
  height: z.enum(["compact", "standard", "tall"]).default("standard"),

  style,
});

/**
 * Every panel this hero should show, in order.
 *
 * Pure and exported so the renderer, the carousel and any future preview all
 * agree on what "the slides" means rather than each re-deriving it.
 */
export function heroSlides(props: z.infer<typeof heroProps>): HeroSlide[] {
  // Named field by field rather than by rest-spread: a rest would carry
  // `align`, `height` and `style` into every "slide", and a slide that silently
  // holds layout settings is the kind of thing that reads fine until somebody
  // maps over slides and wonders why each one has a `height`.
  const first: HeroSlide = {
    eyebrow: props.eyebrow,
    heading: props.heading,
    subheading: props.subheading,
    primaryCta: props.primaryCta,
    secondaryCta: props.secondaryCta,
    imageUrl: props.imageUrl,
    videoUrl: props.videoUrl,
  };

  if (props.layout === "single" || !props.slides?.length) return [first];
  return [first, ...props.slides];
}

const statsProps = z.object({
  heading: line.optional(),
  /**
   * `value` is a STRING, not a number. A landing page stat reads "12,000+" or
   * "₹18 LPA" or "94%" — formatting is editorial, and storing 12000 would mean
   * inventing a formatter that guesses which of those the editor meant.
   */
  items: z.array(z.object({ label: line, value: line })).min(1).max(6),
  style,
});

const programmesProps = z.object({
  heading: line,
  subheading: prose.optional(),
  /**
   * How many live Programme rows to show. This block carries NO programme
   * content of its own — it names a query, and the renderer reads the tenant's
   * actual Programme table.
   *
   * That is the whole reason this CMS sits inside the ERP rather than beside
   * it: a university adds a programme in the admin portal and the public site
   * is correct with no second edit, which no bolted-on website can do.
   */
  limit: z.number().int().min(1).max(12).default(6),
  style,
});

const featuresProps = z.object({
  heading: line,
  subheading: prose.optional(),
  items: z
    .array(z.object({ title: line, body: prose, icon: icon.optional() }))
    .min(1)
    .max(8),
  style,
});

/**
 * Image cards with a caption bar — the reference designs' most repeated
 * pattern, used there for course levels, campuses and events alike.
 *
 * ONE BLOCK FOR ALL THREE, because they differ only in content. Three
 * near-identical blocks would be three components to keep in sync and three
 * entries an editor has to choose between on grounds that do not affect the
 * result.
 */
const cardGridProps = z.object({
  heading: line,
  subheading: prose.optional(),
  /** 2, 3 or 4 across on a wide screen. Below that the grid collapses. */
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  items: z
    .array(
      z.object({
        title: line,
        body: prose.optional(),
        imageUrl: imageUrl.optional(),
        link: cta.optional(),
      })
    )
    .min(1)
    .max(12),
  style,
});

/**
 * Icon-and-label tiles — the reference's "Find Your Interest" school list.
 *
 * Distinct from cardGrid because it carries no image and no body: it is a
 * dense index, and giving it the card treatment would make eight schools take
 * three screens.
 */
const linkGridProps = z.object({
  heading: line,
  subheading: prose.optional(),
  items: z
    .array(z.object({ label: line, href: href.optional(), icon: icon.optional() }))
    .min(1)
    .max(16),
  style,
});

/**
 * A two-tone band: figures on one side, a statement on the other.
 *
 * The reference puts this immediately under the hero, overlapping it. Here it
 * is an ordinary block in the flow — overlap would make the block's height
 * depend on the one above it, which a system where an editor can reorder
 * freely cannot guarantee.
 */
const splitBandProps = z.object({
  stats: z.array(z.object({ value: line, label: line })).min(1).max(3),
  message: prose,
  cta: cta.optional(),
  style,
});

const testimonialsProps = z.object({
  heading: line,
  items: z
    .array(z.object({ quote: prose, name: line, role: line.optional() }))
    .min(1)
    .max(8),
  style,
});

/**
 * Placement outcomes: figures and partner marks on one side, placed students
 * rotating on the other.
 *
 * THE STUDENTS ARE A CAROUSEL, NOT A STATIC GRID
 *   The reference designs show a 2×2 tile of portraits; institutions with
 *   twelve placed students still want them all shown, so the tiles rotate.
 *   Stats and partner logos stay fixed — they are the framing, not the content
 *   that changes every few seconds.
 */
const placementsProps = z.object({
  heading: line,
  subheading: prose.optional(),
  stats: z
    .array(
      z.object({
        value: line,
        /** A short supporting sentence under the figure, not just a caption. */
        body: prose,
        icon: icon.optional(),
      })
    )
    .min(1)
    .max(4),
  /** Recruiting partners shown as a logo strip under the stats. */
  partners: z
    .array(z.object({ name: line, logoUrl: imageUrl.optional() }))
    .max(12)
    .optional(),
  students: z
    .array(
      z.object({
        name: line,
        company: line,
        imageUrl: imageUrl.optional(),
        companyLogoUrl: imageUrl.optional(),
        programme: line.optional(),
      })
    )
    .min(1)
    .max(24),
  cta: cta.optional(),
  /** Seconds each student pair holds. Same bounds as the hero carousel. */
  autoplaySeconds: z.number().int().min(3).max(20).default(6),
  style,
});

const faqProps = z.object({
  heading: line,
  items: z.array(z.object({ question: line, answer: prose })).min(1).max(12),
  style,
});

const ctaBandProps = z.object({
  heading: line,
  body: prose.optional(),
  cta,
  style,
});

const richTextProps = z.object({
  heading: line.optional(),
  /**
   * PLAIN TEXT, rendered with whitespace preserved — not HTML and not markdown.
   *
   * §7.3 asks for a rich-text editor and this is deliberately less than that.
   * Accepting HTML here would mean sanitising it, and a half-correct sanitiser
   * on the anonymous-facing page is worse than no rich text at all. When a real
   * sanitiser is chosen this becomes a new block type rather than a change of
   * meaning for content already stored under this one.
   */
  body: z.string().trim().min(1).max(8000),
  style,
});

// --- The union --------------------------------------------------------------

/**
 * One block: a stable id, a type, and props matching that type.
 *
 * `id` is generated by the editor and is what React keys on and what a reorder
 * moves. It is not a database id — blocks are not rows — but it must be stable
 * across an edit so that moving block 3 does not remount blocks 1 and 2.
 */
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id: line, type: z.literal("hero"), props: heroProps }),
  z.object({ id: line, type: z.literal("stats"), props: statsProps }),
  z.object({ id: line, type: z.literal("programmes"), props: programmesProps }),
  z.object({ id: line, type: z.literal("features"), props: featuresProps }),
  z.object({ id: line, type: z.literal("cardGrid"), props: cardGridProps }),
  z.object({ id: line, type: z.literal("linkGrid"), props: linkGridProps }),
  z.object({ id: line, type: z.literal("splitBand"), props: splitBandProps }),
  z.object({ id: line, type: z.literal("testimonials"), props: testimonialsProps }),
  z.object({ id: line, type: z.literal("placements"), props: placementsProps }),
  z.object({ id: line, type: z.literal("faq"), props: faqProps }),
  z.object({ id: line, type: z.literal("cta"), props: ctaBandProps }),
  z.object({ id: line, type: z.literal("richText"), props: richTextProps }),
]);

/**
 * A whole page body.
 *
 * An EMPTY array is valid: a page an editor has cleared is a legitimate state,
 * and refusing to save it would trap them with content they want gone. The
 * upper bound stops one page becoming a payload nothing can render.
 */
export const blocksSchema = z.array(blockSchema).max(50);

export type CmsBlock = z.infer<typeof blockSchema>;
export type CmsBlocks = z.infer<typeof blocksSchema>;
export type CmsBlockType = CmsBlock["type"];

/** Narrow a block to one type, for the renderer's map. */
export type BlockOfType<T extends CmsBlockType> = Extract<CmsBlock, { type: T }>;

// --- Reading untrusted stored JSON ------------------------------------------

/**
 * Parse a Json column into blocks, refusing rather than guessing.
 *
 * WHY THIS RETURNS [] INSTEAD OF THROWING
 *   It is called while rendering the public website. A page whose stored JSON
 *   fails to parse — because it predates a schema change, or because it was
 *   written by hand — must not take the institution's homepage down with a 500.
 *   An empty page is a bad outcome; a broken one is worse, and an error page on
 *   a university's public domain is the most visible failure this product has.
 *
 *   The editor uses `blocksSchema.safeParse` directly and DOES surface the
 *   error, because there the reader can fix it.
 */
export function parseStoredBlocks(value: unknown): CmsBlocks {
  const parsed = blocksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

// --- Editor metadata --------------------------------------------------------

/** What the editor's "add a block" menu shows. */
export interface BlockDefinition {
  type: CmsBlockType;
  label: string;
  description: string;
}

/**
 * The catalogue, in the order the add-menu lists them.
 *
 * Derived from PRD §7.2's homepage list: value proposition (hero), career
 * outcome statistics (stats), featured degree programmes (programmes), why-us
 * (features), student success stories (testimonials), FAQs, and the apply-now
 * journey (cta).
 */
export const BLOCK_CATALOGUE: readonly BlockDefinition[] = [
  { type: "hero", label: "Hero", description: "Headline, subheading and up to two buttons." },
  { type: "stats", label: "Statistics", description: "Two to six figures, e.g. placement rate." },
  { type: "programmes", label: "Programmes", description: "Live programmes from your academic structure." },
  { type: "features", label: "Highlights", description: "Why study here — a grid of points, each with an icon." },
  { type: "cardGrid", label: "Image cards", description: "Photo cards with a title and a link — courses, campuses, events." },
  { type: "linkGrid", label: "Link tiles", description: "A dense index of schools or departments, with icons." },
  { type: "splitBand", label: "Split band", description: "Headline figures beside a statement." },
  { type: "testimonials", label: "Testimonials", description: "Student and alumni quotes." },
  {
    type: "placements",
    label: "Placements",
    description: "Placement stats, partner logos and a carousel of placed students.",
  },
  { type: "faq", label: "FAQ", description: "Questions and answers." },
  { type: "cta", label: "Call to action", description: "A band with one button, e.g. Apply now." },
  { type: "richText", label: "Text", description: "A heading and a paragraph of plain text." },
] as const;

/**
 * A newly added block, with the minimum valid props for its type.
 *
 * Every default below PARSES against its own schema — an editor who adds a
 * block and immediately saves must not hit a validation error for content they
 * have not written yet. The placeholder text is deliberately obvious so an
 * unedited block is recognisable on a published page rather than looking
 * intentional.
 */
export function defaultBlock(type: CmsBlockType, id: string): CmsBlock {
  switch (type) {
    case "hero":
      return {
        id,
        type,
        props: {
          heading: "Your headline here",
          subheading: "One or two sentences on what makes this institution worth applying to.",
          primaryCta: { label: "Apply now", href: "/admissions" },
          // The four layout fields carry schema defaults, so stored content
          // without them parses. They are written out here anyway: the editor
          // shows a select for each, and a select whose value is undefined
          // renders blank rather than showing the default that is actually in
          // force.
          layout: "single",
          autoplaySeconds: 6,
          align: "left",
          height: "standard",
        },
      };
    case "stats":
      return {
        id,
        type,
        props: {
          heading: "By the numbers",
          items: [
            { label: "Students", value: "0" },
            { label: "Programmes", value: "0" },
            { label: "Placement rate", value: "0%" },
          ],
        },
      };
    case "programmes":
      return {
        id,
        type,
        props: { heading: "Our programmes", limit: 6 },
      };
    case "features":
      return {
        id,
        type,
        props: {
          heading: "Why study here",
          items: [
            { title: "A reason", body: "A sentence or two supporting it.", icon: "sparkles" },
          ],
        },
      };
    case "cardGrid":
      return {
        id,
        type,
        props: {
          heading: "A section of cards",
          columns: 3,
          items: [{ title: "Card title", body: "A sentence about this card." }],
        },
      };
    case "linkGrid":
      return {
        id,
        type,
        props: {
          heading: "Find your interest",
          items: [{ label: "A school or department", icon: "book-open" }],
        },
      };
    case "splitBand":
      return {
        id,
        type,
        props: {
          stats: [{ value: "0+", label: "Something countable" }],
          message: "A sentence about what those numbers mean for an applicant.",
        },
      };
    case "testimonials":
      return {
        id,
        type,
        props: {
          heading: "What our students say",
          items: [{ quote: "A short quote from a student.", name: "Student name" }],
        },
      };
    case "placements":
      return {
        id,
        type,
        props: {
          heading: "Impeccable Placements",
          subheading: "Education that takes you where your ambition already points.",
          stats: [
            {
              value: "94% placed",
              body: "Graduates placed with recruiting partners in the last cycle.",
              icon: "trophy",
            },
            {
              value: "180+ companies",
              body: "National and global employers on campus every year.",
              icon: "briefcase",
            },
          ],
          partners: [
            { name: "Partner one" },
            { name: "Partner two" },
            { name: "Partner three" },
          ],
          students: [
            { name: "Student name", company: "Company", programme: "B.Tech" },
            { name: "Student name", company: "Company", programme: "MBA" },
          ],
          cta: { label: "View more placements", href: "/admissions" },
          autoplaySeconds: 6,
        },
      };
    case "faq":
      return {
        id,
        type,
        props: {
          heading: "Frequently asked questions",
          items: [{ question: "A question applicants ask?", answer: "The answer." }],
        },
      };
    case "cta":
      return {
        id,
        type,
        props: {
          heading: "Ready to apply?",
          cta: { label: "Start your application", href: "/admissions" },
        },
      };
    case "richText":
      return {
        id,
        type,
        props: { heading: "A heading", body: "Your text here." },
      };
  }
}

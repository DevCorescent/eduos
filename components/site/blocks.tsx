// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Block Components (W4, PRD §7.2)
// LAYER  : Presentation (Server Components)
// PURPOSE: One component per block type in lib/domain/cms/blocks.ts.
//
// ONE FILE, ELEVEN COMPONENTS
//   They share a section idiom and are only ever used together by BlockRenderer.
//   Splitting them across eleven files would put that shared idiom eleven files
//   away from each place it is applied. The idiom ITSELF now lives in
//   Section.tsx, because the hero carousel is a client component and needs it
//   too — see that file's note.
//
// PROPS ARE ALREADY VALIDATED
//   Every component takes the Zod-inferred type for its own block, so nothing
//   here re-checks a field. The parse happened on write and again on read
//   (parseStoredBlocks), which is what lets these be plain rendering functions
//   with no defensive branching.
//
// TYPOGRAPHY IS PASSED DOWN AS CUSTOM PROPERTIES, NOT AS PROPS
//   Each block's `props.style` goes to <Section style=…>, which emits the six
//   custom properties on the section element. Everything inside — a card title
//   three levels down — picks them up through the cascade. That is why no
//   component below takes a colour or a size as an argument: the classes
//   `.site-h2`, `.site-body` and friends read the properties themselves.
//
// TENANT COLOURS COME THROUGH TOKENS
//   `bg-primary`, `text-primary` and friends resolve to the CSS custom
//   properties app/layout.tsx injects per request from the tenant's branding. A
//   university that sets its brand colour repaints this page without any of
//   these components changing — the §45 requirement, met by not hardcoding a
//   single colour.
// ============================================================================

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Cpu,
  Globe,
  GraduationCap,
  Microscope,
  Palette,
  Quote,
  Scale,
  Sparkles,
  Stethoscope,
  Trophy,
  Users,
} from "lucide-react";
import type { BlockIcon, BlockOfType } from "@/lib/domain/cms/blocks";
import { heroSlides } from "@/lib/domain/cms/blocks";
import { typographyCssVars } from "@/lib/domain/cms/typography";
import { listPublicProgrammes, type PublicProgramme } from "@/lib/services/site";
import { cn } from "@/lib/utils";
import { Section, SectionHeading, type SectionTone } from "./Section";
import { HeroPanel } from "./HeroPanel";
import { HeroCarousel } from "./HeroCarousel";
import { PlacementsCarousel } from "./PlacementsCarousel";

/** Every block component takes the tone the renderer assigned it. */
type Toned = { tone?: SectionTone };

/**
 * The stored icon name → the component that draws it.
 *
 * The KEYS are exactly the BLOCK_ICONS enum, so this map is total: a name that
 * parsed against the schema always has a component here, and a name that did
 * not never reaches this file. `satisfies` makes adding an enum member without
 * adding an icon a compile error rather than a blank square on a live page.
 */
const ICONS = {
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  microscope: Microscope,
  palette: Palette,
  scale: Scale,
  stethoscope: Stethoscope,
  cpu: Cpu,
  briefcase: Briefcase,
  users: Users,
  trophy: Trophy,
  globe: Globe,
  sparkles: Sparkles,
} satisfies Record<BlockIcon, React.ComponentType<{ className?: string }>>;

/** Render one chosen icon, or nothing when the editor chose none. */
function BlockIconGlyph({ name, className }: { name?: BlockIcon; className?: string }) {
  if (!name) return null;
  const Glyph = ICONS[name];
  return <Glyph className={className} />;
}

// --- Hero -------------------------------------------------------------------

/**
 * The full-bleed opening panel, or several of them.
 *
 * ONE PANEL STAYS A SERVER COMPONENT
 *   The branch below is the whole reason HeroPanel is a separate, hook-free
 *   file. An institution with a single hero — which is most of them — gets
 *   server-rendered markup and no JavaScript; only a configured carousel pulls
 *   the client component in.
 *
 * The hero is NOT wrapped in <Section>: it is full-bleed and sets its own
 * vertical rhythm, so the shared container's max-width would letterbox the
 * photograph. It still emits the typography properties, on its own wrapper.
 */
export function HeroBlock({ props }: BlockOfType<"hero">) {
  const slides = heroSlides(props);
  const { align, height, autoplaySeconds, style } = props;

  return (
    <div style={typographyCssVars(style) as React.CSSProperties}>
      {slides.length > 1 ? (
        <HeroCarousel
          slides={slides}
          align={align}
          height={height}
          autoplaySeconds={autoplaySeconds}
        />
      ) : (
        <HeroPanel slide={slides[0]} align={align} height={height} />
      )}
    </div>
  );
}

// --- Stats ------------------------------------------------------------------

export function StatsBlock({ props, tone }: BlockOfType<"stats"> & Toned) {
  const { heading, items, style } = props;

  return (
    <Section tone={tone} style={style}>
      {heading && <SectionHeading heading={heading} />}

      {/* Column count follows the item count so three stats are not stranded in
          a four-column grid with a hole in it. */}
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-8 gap-y-10",
          heading && "mt-14",
          items.length <= 2
            ? "sm:grid-cols-2"
            : items.length === 3
              ? "sm:grid-cols-3"
              : "sm:grid-cols-3 lg:grid-cols-4"
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="text-center">
            <dt className="site-small site-ink-muted order-2 mt-2">{item.label}</dt>
            {/* order-* so the number reads first visually while the <dl> keeps
                its required dt-before-dd document order. */}
            <dd className="site-figure order-1 text-primary">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

// --- Programmes (live data) -------------------------------------------------

/**
 * Programmes read from the tenant's own Programme table.
 *
 * ASYNC, AND THE ONLY BLOCK THAT TOUCHES THE DATABASE. It is a Server
 * Component, so the query runs during the render that produces the HTML — no
 * loading state, no client fetch, no data in the browser bundle.
 *
 * `tenantId` IS NULL IN THE TEMPLATE PREVIEW, where there is no institution to
 * query. The block then draws the sample rows below rather than an empty
 * section, so an operator previewing the template sees the shape of the thing
 * they are designing. The sample is labelled as such on screen — a preview that
 * silently invents programme names is a preview nobody can trust.
 */
const SAMPLE_PROGRAMMES: PublicProgramme[] = [
  {
    id: "sample-1",
    name: "B.Tech Computer Science & Engineering",
    code: "BT-CSE",
    type: "UG",
    durationValue: 4,
    durationUnit: "YEARS",
    description:
      "Four years covering systems, data and software engineering, with an industry project from the second year.",
    departmentName: "School of Engineering & Technology",
  },
  {
    id: "sample-2",
    name: "M.Sc Applied Mathematics",
    code: "MS-AMT",
    type: "PG",
    durationValue: 2,
    durationUnit: "YEARS",
    description: "A two-year masters with a research or an industry track in the final semester.",
    departmentName: "School of Science",
  },
  {
    id: "sample-3",
    name: "BBA Business Administration",
    code: "BBA-GEN",
    type: "UG",
    durationValue: 3,
    durationUnit: "YEARS",
    description: "Management fundamentals taught through live case work with regional employers.",
    departmentName: "School of Commerce & Management",
  },
];

export async function ProgrammesBlock({
  props,
  tenantId,
  tone,
}: BlockOfType<"programmes"> & { tenantId: string | null } & Toned) {
  const { heading, subheading, limit, style } = props;

  const isSample = tenantId === null;
  const programmes = isSample
    ? SAMPLE_PROGRAMMES.slice(0, limit)
    : await listPublicProgrammes(tenantId, limit);

  return (
    <Section id="programmes" tone={tone} style={style}>
      <SectionHeading eyebrow="Academics" heading={heading} subheading={subheading} />

      {programmes.length === 0 ? (
        // A university with no active programmes yet. Saying so plainly beats
        // an empty grid, which reads as a broken page rather than a new one.
        <p className="site-small site-ink-muted mt-14 text-center">
          Programme details will be published here shortly.
        </p>
      ) : (
        <>
          <ul className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {programmes.map((programme) => (
              <li key={programme.id} className="glass hover-lift flex flex-col rounded-xl p-6">
                <p className="font-mono text-xs font-medium uppercase tracking-wide text-primary">
                  {programme.code}
                </p>
                <h3 className="site-h3 site-ink mt-2">{programme.name}</h3>
                <p className="site-small site-ink-muted mt-1">{programme.departmentName}</p>

                {programme.description && (
                  <p className="site-small site-ink-body mt-3 line-clamp-3">
                    {programme.description}
                  </p>
                )}

                <p className="site-small site-ink-muted mt-4 border-t border-border pt-4">
                  {programme.durationValue} {programme.durationUnit.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>

          {isSample && (
            <p className="site-small site-ink-muted mt-8 text-center">
              Sample rows. On a live site this section lists the institution&apos;s
              own active programmes.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

// --- Features ---------------------------------------------------------------

export function FeaturesBlock({ props, tone }: BlockOfType<"features"> & Toned) {
  const { heading, subheading, items, style } = props;

  return (
    <Section tone={tone} style={style}>
      <SectionHeading eyebrow="Why us" heading={heading} subheading={subheading} />

      <ul className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.title} className="glass rounded-xl p-6">
            {item.icon && (
              <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-bg-foreground">
                <BlockIconGlyph name={item.icon} className="size-5" />
              </span>
            )}
            <h3 className="site-h3 site-ink">{item.title}</h3>
            <p className="site-small site-ink-muted mt-2">{item.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// --- Image card grid --------------------------------------------------------

/**
 * Photo cards with a solid caption bar, as in the reference designs' course,
 * campus and event sections.
 *
 * A card WITHOUT an image still works: the caption bar becomes the whole card
 * over a tinted panel. An institution part-way through gathering photography
 * gets a page that looks deliberate rather than half-loaded.
 */
export function CardGridBlock({ props, tone }: BlockOfType<"cardGrid"> & Toned) {
  const { heading, subheading, columns, items, style } = props;

  return (
    <Section tone={tone} style={style}>
      <SectionHeading heading={heading} subheading={subheading} />

      <ul
        className={cn(
          "mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2",
          columns === 2 ? "lg:grid-cols-2" : columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
        )}
      >
        {items.map((item, index) => {
          const card = (
            <>
              <div className="relative aspect-4/3 w-full overflow-hidden bg-primary-bg">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- see HeroPanel
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                )}
              </div>

              <div className="flex flex-1 flex-col bg-primary px-5 py-4 text-primary-foreground">
                <h3 className="site-h3">{item.title}</h3>
                {item.body && (
                  <p className="site-small mt-1.5 line-clamp-3 text-primary-foreground/80">
                    {item.body}
                  </p>
                )}
                {item.link && (
                  <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 group-hover:underline">
                    {item.link.label}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                )}
              </div>
            </>
          );

          // Whole-card link when one is set, so the target is the card rather
          // than four words of it — the reference behaves this way and it is a
          // far larger tap target on a phone.
          return (
            <li key={`${item.title}-${index}`} className="contents">
              {item.link ? (
                <Link
                  href={item.link.href}
                  className="group flex flex-col overflow-hidden rounded-xl shadow-soft transition-shadow hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {card}
                </Link>
              ) : (
                <div className="group flex flex-col overflow-hidden rounded-xl shadow-soft">
                  {card}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// --- Link tiles -------------------------------------------------------------

export function LinkGridBlock({ props, tone }: BlockOfType<"linkGrid"> & Toned) {
  const { heading, subheading, items, style } = props;

  return (
    <Section id="schools" tone={tone} style={style}>
      {/* Left-aligned heading beside the tiles, as the reference's "Find Your
          Interest" does — a centred heading over a dense index reads as a new
          page rather than as a label for the grid. */}
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
        <SectionHeading
          align="left"
          eyebrow="Schools"
          heading={heading}
          subheading={subheading}
        />

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item, index) => {
            const inner = (
              <>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BlockIconGlyph name={item.icon} className="size-5" />
                </span>
                <span className="site-small site-ink min-w-0 font-medium">{item.label}</span>
              </>
            );

            return (
              <li key={`${item.label}-${index}`}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5 pr-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5 pr-4">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

// --- Split band -------------------------------------------------------------

/**
 * A two-tone band: figures on one side, a statement on the other.
 *
 * Given a TIGHTER vertical rhythm than a full section, because it is a rule
 * between two sections rather than a section of its own — the reference designs
 * use it the same way, immediately under the hero.
 */
export function SplitBandBlock({ props }: BlockOfType<"splitBand">) {
  const { stats, message, cta, style } = props;

  return (
    <section
      style={typographyCssVars(style) as React.CSSProperties}
      className="w-full py-10 sm:py-14"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid overflow-hidden rounded-2xl shadow-soft lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <dl className="gradient-primary flex flex-wrap items-center gap-x-12 gap-y-8 px-8 py-10 sm:px-12">
            {stats.map((stat, index) => (
              <div
                key={`${stat.label}-${index}`}
                // A rule between figures rather than around them, so the first
                // one does not sit behind a stray leading border.
                className={cn(index > 0 && "border-l border-white/25 pl-12")}
              >
                <dd className="site-figure site-ink-on-dark">{stat.value}</dd>
                <dt className="site-small site-ink-on-dark-soft mt-1">{stat.label}</dt>
              </div>
            ))}
          </dl>

          <div className="flex flex-col justify-center bg-tertiary-300 px-8 py-10 sm:px-12">
            <p className="site-lead font-medium text-tertiary-900">{message}</p>
            {cta && (
              <Link
                href={cta.href}
                className="mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-tertiary-900 px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {cta.label}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// --- Testimonials -----------------------------------------------------------

export function TestimonialsBlock({ props, tone }: BlockOfType<"testimonials"> & Toned) {
  const { heading, items, style } = props;

  return (
    <Section tone={tone} style={style}>
      <SectionHeading eyebrow="Student voices" heading={heading} />

      <ul className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="glass flex flex-col rounded-xl p-6">
            <Quote className="size-6 text-primary/40" aria-hidden="true" />
            <blockquote className="site-small site-ink-body mt-3 flex-1">
              {item.quote}
            </blockquote>
            <footer className="mt-4 border-t border-border pt-4">
              <p className="site-small site-ink font-semibold">{item.name}</p>
              {item.role && <p className="site-ink-muted text-xs">{item.role}</p>}
            </footer>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// --- Placements -------------------------------------------------------------

/**
 * Placement outcomes: figures and partners on the left, a student carousel on
 * the right — the reference "Impeccable Placements" composition.
 */
export function PlacementsBlock({ props, tone }: BlockOfType<"placements"> & Toned) {
  const { heading, subheading, stats, partners, students, cta, autoplaySeconds, style } = props;

  return (
    <Section id="placements" tone={tone} style={style}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:items-center">
        <div>
          <p className="site-eyebrow text-primary">Careers</p>
          <h2 className="site-h2 site-ink mt-3 bg-linear-to-r from-primary to-tertiary-600 bg-clip-text text-transparent">
            {heading}
          </h2>
          {subheading && (
            <p className="site-lead site-ink-muted mt-4 max-w-xl">{subheading}</p>
          )}

          <ul className="mt-10 space-y-6">
            {stats.map((stat, index) => (
              <li key={`${stat.value}-${index}`} className="flex gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <BlockIconGlyph name={stat.icon ?? "trophy"} className="size-5" />
                </span>
                <div>
                  <p className="site-h3 site-ink">{stat.value}</p>
                  <p className="site-small site-ink-muted mt-1">{stat.body}</p>
                </div>
              </li>
            ))}
          </ul>

          {partners && partners.length > 0 && (
            <ul className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
              {partners.map((partner, index) => (
                <li key={`${partner.name}-${index}`} className="flex h-8 items-center">
                  {partner.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={partner.logoUrl}
                      alt={partner.name}
                      className="h-7 w-auto max-w-24 object-contain opacity-70 grayscale transition-opacity hover:opacity-100 hover:grayscale-0"
                    />
                  ) : (
                    <span className="site-small site-ink-muted font-medium">{partner.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <PlacementsCarousel students={students} autoplaySeconds={autoplaySeconds} />
      </div>

      {cta && (
        <div className="mt-12 flex justify-center">
          <Link
            href={cta.href}
            className="inline-flex items-center gap-2 rounded-full border border-primary px-7 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {cta.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      )}
    </Section>
  );
}

// --- FAQ --------------------------------------------------------------------

/**
 * Questions and answers.
 *
 * NATIVE <details>, NOT AN ACCORDION COMPONENT. Open and close is browser
 * behaviour, keyboard-operable and screen-reader-announced with no JavaScript —
 * so this block ships none, which matters on the one page of the product that
 * anonymous visitors load cold.
 */
export function FaqBlock({ props, tone }: BlockOfType<"faq"> & Toned) {
  const { heading, items, style } = props;

  return (
    <Section tone={tone} style={style}>
      <SectionHeading eyebrow="Admissions" heading={heading} />

      <dl className="mx-auto mt-14 max-w-3xl divide-y divide-border">
        {items.map((item, index) => (
          <details key={`${item.question}-${index}`} className="group py-5">
            <summary className="site-body site-ink flex cursor-pointer items-center justify-between gap-4 text-left font-medium marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {item.question}
              <span
                aria-hidden="true"
                className="shrink-0 text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="site-small site-ink-muted mt-3">{item.answer}</p>
          </details>
        ))}
      </dl>
    </Section>
  );
}

// --- Call to action ---------------------------------------------------------

export function CtaBlock({ props, tone }: BlockOfType<"cta"> & Toned) {
  const { heading, body, cta, style } = props;

  return (
    <Section tone={tone} style={style}>
      <div className="gradient-primary relative overflow-hidden rounded-2xl px-6 py-16 text-center sm:px-12">
        <h2 className="site-h2 site-ink-on-dark">{heading}</h2>
        {body && (
          <p className="site-lead site-ink-on-dark-soft mx-auto mt-4 max-w-2xl">{body}</p>
        )}
        <Link
          href={cta.href}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-neutral-900 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
        >
          {cta.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </Section>
  );
}

// --- Rich text --------------------------------------------------------------

export function RichTextBlock({ props, tone }: BlockOfType<"richText"> & Toned) {
  const { heading, body, style } = props;

  return (
    <Section tone={tone} style={style}>
      <div className="mx-auto max-w-3xl">
        {heading && <h2 className="site-h2 site-ink">{heading}</h2>}
        {/* whitespace-pre-line, not a markdown or HTML renderer: the schema
            stores plain text precisely so nothing here has to sanitise. */}
        <p className="site-body site-ink-body mt-4 whitespace-pre-line">{body}</p>
      </div>
    </Section>
  );
}

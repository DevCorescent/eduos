// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Block Components (W4, PRD §7.2)
// LAYER  : Presentation (Server Components)
// PURPOSE: One component per block type in lib/domain/cms/blocks.ts.
//
// ONE FILE, EIGHT COMPONENTS
//   They share a section idiom — same max width, same vertical rhythm, same
//   heading treatment — and are only ever used together by BlockRenderer.
//   Splitting them across eight files would put that shared idiom eight files
//   away from each place it is applied.
//
// PROPS ARE ALREADY VALIDATED
//   Every component takes the Zod-inferred type for its own block, so nothing
//   here re-checks a field. The parse happened on write and again on read
//   (parseStoredBlocks), which is what lets these be plain rendering functions
//   with no defensive branching.
//
// TENANT COLOURS COME THROUGH TOKENS
//   `bg-primary`, `text-primary` and friends resolve to the CSS custom
//   properties app/layout.tsx injects per request from the tenant's branding.
//   A university that sets its brand colour repaints this page without any of
//   these components changing — which is the §45 requirement, met by not
//   hardcoding a single colour.
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
import { listPublicProgrammes } from "@/lib/services/site";
import { cn } from "@/lib/utils";

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

// --- Shared section shell ---------------------------------------------------

/** The horizontal rhythm every block shares. */
function Section({
  children,
  className,
  tone = "plain",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "plain" | "muted";
}) {
  return (
    <section className={cn("w-full py-16 sm:py-20", tone === "muted" && "bg-muted/60", className)}>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

/** Centred heading + optional subheading, above a block's content. */
function SectionHeading({ heading, subheading }: { heading: string; subheading?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight text-heading sm:text-4xl">{heading}</h2>
      {subheading && (
        <p className="mt-4 text-base leading-7 text-muted-foreground">{subheading}</p>
      )}
    </div>
  );
}

// --- Hero -------------------------------------------------------------------

/**
 * The full-bleed opening panel.
 *
 * THE OVERLAY IS A LEGIBILITY REQUIREMENT, NOT A STYLE CHOICE
 *   An institution supplies its own photograph and nobody reviews it for
 *   contrast. White text straight onto an arbitrary image is unreadable
 *   roughly half the time, so a gradient scrim sits between them — dense on the
 *   left where the text is, clearing to the right where the picture shows.
 *   That way any photograph works and none has to be vetted.
 *
 *   With no image the same layout renders over the brand gradient, so a
 *   university that has uploaded nothing still gets a finished-looking page.
 */
export function HeroBlock({ props }: BlockOfType<"hero">) {
  const { eyebrow, heading, subheading, primaryCta, secondaryCta, imageUrl, videoUrl } = props;

  const hasBackground = Boolean(imageUrl || videoUrl);

  return (
    <section className="relative isolate overflow-hidden">
      {videoUrl ? (
        // muted + playsInline are what let a browser autoplay at all; without
        // both, mobile Safari and Chrome refuse and the hero stays on its
        // poster. `poster` is the still, so there is never an empty frame while
        // the video buffers, and a visitor who blocks media sees the image.
        <video
          className="absolute inset-0 -z-20 size-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={imageUrl}
          aria-hidden="true"
        >
          <source src={videoUrl} />
        </video>
      ) : imageUrl ? (
        // Tenant-supplied external URL; see SiteHeader for why next/image
        // cannot be used in a multi-tenant product.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
      ) : null}

      {hasBackground ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-linear-to-r from-neutral-950/85 via-neutral-950/65 to-neutral-950/25"
        />
      ) : (
        <div aria-hidden="true" className="gradient-primary absolute inset-0 -z-10" />
      )}

      <div className="mx-auto w-full max-w-7xl px-4 py-28 sm:px-6 sm:py-36 lg:px-8">
        <div className="max-w-2xl">
          {eyebrow && (
            <p className="mb-4 inline-block rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-white backdrop-blur-sm">
              {eyebrow}
            </p>
          )}
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
            {heading}
          </h1>

          {subheading && (
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/85">{subheading}</p>
          )}

          {(primaryCta || secondaryCta) && (
            <div className="mt-10 flex flex-wrap items-center gap-4">
              {primaryCta && (
                <Link
                  href={primaryCta.href}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  {primaryCta.label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              )}
              {secondaryCta && (
                <Link
                  href={secondaryCta.href}
                  className="inline-flex items-center rounded-full border border-white/70 bg-white/10 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  {secondaryCta.label}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// --- Stats ------------------------------------------------------------------

export function StatsBlock({ props }: BlockOfType<"stats">) {
  const { heading, items } = props;

  return (
    <Section tone="muted">
      {heading && (
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight text-heading">
          {heading}
        </h2>
      )}

      {/* Column count follows the item count so three stats are not stranded in
          a four-column grid with a hole in it. */}
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-8 gap-y-10",
          items.length <= 2 ? "sm:grid-cols-2" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-3 lg:grid-cols-4"
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="text-center">
            <dt className="order-2 mt-2 text-sm font-medium text-muted-foreground">
              {item.label}
            </dt>
            {/* flex-col-reverse so the number reads first visually while the
                <dl> keeps its required dt-before-dd document order. */}
            <dd className="order-1 text-4xl font-bold tracking-tight text-primary sm:text-5xl">
              {item.value}
            </dd>
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
 */
export async function ProgrammesBlock({
  props,
  tenantId,
}: BlockOfType<"programmes"> & { tenantId: string }) {
  const { heading, subheading, limit } = props;
  const programmes = await listPublicProgrammes(tenantId, limit);

  return (
    <Section>
      <SectionHeading heading={heading} subheading={subheading} />

      {programmes.length === 0 ? (
        // A university with no active programmes yet. Saying so plainly beats
        // an empty grid, which reads as a broken page rather than a new one.
        <p className="mt-12 text-center text-sm text-muted-foreground">
          Programme details will be published here shortly.
        </p>
      ) : (
        <ul className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {programmes.map((programme) => (
            <li
              key={programme.id}
              className="glass hover-lift flex flex-col rounded-xl p-6"
            >
              <p className="font-mono text-xs font-medium uppercase tracking-wide text-primary">
                {programme.code}
              </p>
              <h3 className="mt-2 text-lg font-semibold leading-snug text-heading">
                {programme.name}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{programme.departmentName}</p>

              {programme.description && (
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-foreground/80">
                  {programme.description}
                </p>
              )}

              <p className="mt-4 pt-4 text-xs text-muted-foreground border-t border-border">
                {programme.durationValue} {programme.durationUnit.toLowerCase()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// --- Features ---------------------------------------------------------------

export function FeaturesBlock({ props }: BlockOfType<"features">) {
  const { heading, subheading, items } = props;

  return (
    <Section>
      <SectionHeading heading={heading} subheading={subheading} />

      <ul className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.title} className="glass rounded-xl p-6">
            {item.icon && (
              <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary-bg text-primary-bg-foreground">
                <BlockIconGlyph name={item.icon} className="size-5" />
              </span>
            )}
            <h3 className="text-base font-semibold text-heading">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
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
export function CardGridBlock({ props }: BlockOfType<"cardGrid">) {
  const { heading, subheading, columns, items } = props;

  return (
    <Section>
      <SectionHeading heading={heading} subheading={subheading} />

      <ul
        className={cn(
          "mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2",
          columns === 2 ? "lg:grid-cols-2" : columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
        )}
      >
        {items.map((item, index) => {
          const card = (
            <>
              <div className="relative aspect-4/3 w-full overflow-hidden bg-primary-bg">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- see above
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                )}
              </div>

              <div className="flex flex-1 flex-col bg-primary px-5 py-4 text-primary-foreground">
                <h3 className="text-base font-semibold leading-snug">{item.title}</h3>
                {item.body && (
                  <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-primary-foreground/80">
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

export function LinkGridBlock({ props }: BlockOfType<"linkGrid">) {
  const { heading, subheading, items } = props;

  return (
    <Section tone="muted">
      {/* Left-aligned heading beside the tiles, as the reference's "Find Your
          Interest" does — a centred heading over a dense index reads as a new
          page rather than a label for the grid. */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
        <div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-heading sm:text-4xl">
            {heading}
          </h2>
          {subheading && (
            <p className="mt-4 border-l-2 border-primary pl-4 text-base leading-7 text-muted-foreground">
              {subheading}
            </p>
          )}
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item, index) => {
            const inner = (
              <>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BlockIconGlyph name={item.icon} className="size-5" />
                </span>
                <span className="min-w-0 text-sm font-medium text-heading">{item.label}</span>
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

export function SplitBandBlock({ props }: BlockOfType<"splitBand">) {
  const { stats, message, cta } = props;

  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid overflow-hidden rounded-2xl lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <dl className="gradient-primary flex flex-wrap items-center gap-x-12 gap-y-8 px-8 py-10 sm:px-12">
            {stats.map((stat, index) => (
              <div
                key={`${stat.label}-${index}`}
                // A rule between figures rather than around them, so the first
                // one does not sit behind a stray leading border.
                className={cn(index > 0 && "border-l border-white/25 pl-12")}
              >
                <dd className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                  {stat.value}
                </dd>
                <dt className="mt-1 text-sm text-white/80">{stat.label}</dt>
              </div>
            ))}
          </dl>

          <div className="flex flex-col justify-center bg-tertiary-300 px-8 py-10 sm:px-12">
            <p className="text-lg font-medium leading-8 text-tertiary-900">{message}</p>
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

export function TestimonialsBlock({ props }: BlockOfType<"testimonials">) {
  const { heading, items } = props;

  return (
    <Section tone="muted">
      <SectionHeading heading={heading} />

      <ul className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="glass flex flex-col rounded-xl p-6">
            <Quote className="size-6 text-primary/40" aria-hidden="true" />
            <blockquote className="mt-3 flex-1 text-sm leading-6 text-foreground">
              {item.quote}
            </blockquote>
            <footer className="mt-4 border-t border-border pt-4">
              <p className="text-sm font-semibold text-heading">{item.name}</p>
              {item.role && <p className="text-xs text-muted-foreground">{item.role}</p>}
            </footer>
          </li>
        ))}
      </ul>
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
export function FaqBlock({ props }: BlockOfType<"faq">) {
  const { heading, items } = props;

  return (
    <Section>
      <SectionHeading heading={heading} />

      <dl className="mx-auto mt-12 max-w-3xl divide-y divide-border">
        {items.map((item, index) => (
          <details key={`${item.question}-${index}`} className="group py-5">
            <summary className="flex cursor-pointer items-center justify-between gap-4 text-left text-base font-medium text-heading marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {item.question}
              <span
                aria-hidden="true"
                className="shrink-0 text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </dl>
    </Section>
  );
}

// --- Call to action ---------------------------------------------------------

export function CtaBlock({ props }: BlockOfType<"cta">) {
  const { heading, body, cta } = props;

  return (
    <Section>
      <div className="gradient-primary relative overflow-hidden rounded-2xl px-6 py-14 text-center sm:px-12">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{heading}</h2>
        {body && (
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/85">{body}</p>
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

export function RichTextBlock({ props }: BlockOfType<"richText">) {
  const { heading, body } = props;

  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        {heading && (
          <h2 className="text-3xl font-bold tracking-tight text-heading">{heading}</h2>
        )}
        {/* whitespace-pre-line, not a markdown or HTML renderer: the schema
            stores plain text precisely so nothing here has to sanitise. */}
        <p className="mt-4 whitespace-pre-line text-base leading-7 text-foreground/85">
          {body}
        </p>
      </div>
    </Section>
  );
}

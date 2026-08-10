import type { ReactNode } from "react";

/**
 * The welcome banner — Primary palette, per the locked colour rules.
 *
 * THE DECORATIVE TILE IS PURE CSS, BY REQUIREMENT AND BY PREFERENCE
 *   No bitmap, no downloaded SVG. It is a rotated rounded square carrying the
 *   same glass treatment as every other surface — gradient fill, blur, soft
 *   shadow, 1px light edge — with a conic sweep inside it standing in for the
 *   chart glyph the reference shows.
 *
 *   Building it from the token system rather than an asset means it recolours
 *   with the brand instead of going stale, adds nothing to the bundle, and
 *   needs no binary in the repository. It is also aria-hidden: it carries no
 *   information, and announcing it would interrupt the sentence beside it.
 *
 *   It is hidden below `md`. On a phone the banner's job is the message and the
 *   action; a 200px ornament competing for that width is what makes a mobile
 *   dashboard feel like a shrunken desktop.
 */
export function HeroBanner({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-xl bg-primary-100 p-6 shadow-soft sm:p-8">
      <div className="relative z-10 max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-neutral-800 sm:text-base">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 top-1/2 hidden -translate-y-1/2 md:block"
      >
        <div className="relative size-44 rotate-12 rounded-[2rem] bg-secondary-200/80 shadow-hover ring-1 ring-white/60 backdrop-blur-sm lg:size-52">
          {/* The conic sweep reads as a segmented chart without being one — the
              reference's glyph is ornament, and drawing a real chart here would
              imply data this page does not have. */}
          <div className="absolute inset-6 rounded-full bg-[conic-gradient(var(--secondary-700)_0deg_120deg,var(--secondary-500)_120deg_220deg,var(--secondary-300)_220deg_360deg)] opacity-90" />
          <div className="absolute inset-[3.25rem] rounded-full bg-primary-100" />
        </div>
      </div>

      {/* A second, softer field behind the tile so the banner has depth rather
          than a single flat fill. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 size-72 rounded-full bg-tertiary-200 opacity-50 blur-3xl"
      />
    </section>
  );
}

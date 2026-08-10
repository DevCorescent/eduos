import type { ReactNode } from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

/**
 * Shell for the signed-out pages: login, forgot password, reset password.
 *
 * No session guard here, by design — these are the only routes a signed-out
 * visitor is meant to reach, so requiring a session would make signing in
 * impossible. The redirect runs the other way instead: the portal layouts send
 * anyone without a session here.
 *
 * min-h-dvh rather than min-h-screen: on mobile browsers 100vh counts the
 * address bar that is not actually on screen, which pushes a centred card
 * visibly off-centre.
 *
 * THE AMBIENT SHAPES ARE LOAD-BEARING, NOT DECORATION
 *   A frosted card needs something behind it to frost. On a flat canvas
 *   backdrop-filter has nothing to sample and the glass renders as a plain
 *   panel — which is exactly what these pages looked like before. The three
 *   blurred fields below give it content to pick up, and they are drawn from
 *   the brand palette so the tint bleeding through the card is the product's
 *   own colour rather than a wash of grey.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4 py-12">
      {/* aria-hidden and pointer-events-none: this is atmosphere, and it must
          be invisible to assistive technology and unreachable by a cursor. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-secondary-200 opacity-60 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 size-[32rem] rounded-full bg-primary-100 opacity-70 blur-3xl" />
        <div className="absolute right-1/4 top-1/3 size-72 rounded-full bg-tertiary-200 opacity-40 blur-3xl" />
      </div>

      <Link
        href="/"
        className="relative flex items-center gap-3 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The mark sits on its own clay disc so it reads as an object rather
            than a floating glyph — the same treatment the stat-card icons get. */}
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary-200 text-neutral-800 shadow-soft">
          <GraduationCap className="size-6" aria-hidden="true" />
        </span>
        <span className="text-xl font-semibold tracking-tight text-heading">eduOS</span>
      </Link>

      {/* The card itself is the page's, not the layout's: the three auth pages
          differ in width and in what they render around the form. */}
      <div className="relative w-full max-w-sm">{children}</div>

      <p className="relative text-center text-xs text-muted-foreground">
        Multi-University Digital Education Operating System
      </p>
    </div>
  );
}

import Link from "next/link";
import { GraduationCap, SearchX } from "lucide-react";
import { buttonStyles } from "@/components/ui/Button";

/**
 * The 404 page.
 *
 * Rendered at the root, so it sits outside every portal layout — which is
 * correct: a request for a route that does not exist has no portal to belong
 * to, and rendering a sidebar around it would imply the visitor is signed in
 * somewhere they may not be.
 *
 * Also what `notFound()` renders when a detail page cannot find its record, so
 * the copy covers both "wrong URL" and "this record is gone".
 */
export default function NotFound() {
  return (
    <div className="gradient-hero flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="mb-10 flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GraduationCap className="size-7 text-primary" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight text-heading">eduOS</span>
      </Link>

      <div className="glass w-full max-w-md rounded-lg p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-7" aria-hidden="true" />
        </div>

        <h1 className="mt-5 text-2xl font-semibold text-heading">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page does not exist, or the record it pointed to has since been removed.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {/* "/" resolves per-role, so this returns the visitor to whichever
              portal they belong to rather than guessing at one. */}
          <Link href="/" className={buttonStyles()}>
            Back to my dashboard
          </Link>
          <Link href="/login" className={buttonStyles({ variant: "secondary" })}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

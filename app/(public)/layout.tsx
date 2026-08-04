import type { ReactNode } from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

/**
 * Shell for the public, unauthenticated pages.
 *
 * No session guard, deliberately. Certificate verification is used by employers
 * and other institutions who have no account here — requiring one would defeat
 * the purpose of a public verification link.
 *
 * Nothing behind this layout reads tenant-scoped data: the verification service
 * returns only the holder's name, what was awarded, and whether it still
 * stands.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gradient-hero flex min-h-dvh flex-col">
      <header className="glass-plain border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GraduationCap className="size-7 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold tracking-tight text-heading">eduOS</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-16">
        {children}
      </main>

      <footer className="border-t border-border py-6">
        <p className="mx-auto max-w-4xl px-4 text-center text-xs text-muted-foreground sm:px-6">
          Certificate verification is provided by the issuing institution through eduOS.
        </p>
      </footer>
    </div>
  );
}

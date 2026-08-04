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
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GraduationCap className="size-8 text-primary" aria-hidden="true" />
        <span className="text-xl font-semibold tracking-tight text-foreground">eduOS</span>
      </Link>

      {/* The card itself is the page's, not the layout's: the three auth pages
          differ in width and in what they render around the form. */}
      {children}

      <p className="text-center text-xs text-muted-foreground">
        Multi-University Digital Education Operating System
      </p>
    </div>
  );
}

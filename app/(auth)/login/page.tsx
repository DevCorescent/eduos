import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Login page — a Server Component wrapping the interactive form.
 *
 * The Suspense boundary is required, not stylistic: LoginForm reads
 * useSearchParams() (for ?tenant= and ?next=), which suspends during
 * prerendering. Without a boundary Next.js fails the build; with one, the card
 * shell renders immediately and only the form waits.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFormFallback />}>
      <LoginForm />
    </Suspense>
  );
}

/** Matches the form's card dimensions so the layout does not shift on swap. */
function LoginFormFallback() {
  return (
    <div className="glass w-full rounded-xl p-8">
      <Skeleton height="1.5rem" width="60%" />
      <Skeleton height="1rem" width="85%" className="mt-2" />

      <div className="mt-6 flex flex-col gap-4">
        <Skeleton height="4rem" />
        <Skeleton height="4rem" />
        <Skeleton height="4rem" />
        <Skeleton height="3rem" />
      </div>
    </div>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/Skeleton";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password",
};

/**
 * Step two of the password reset.
 *
 * Wrapped in Suspense for the same reason as the login page: the form reads
 * useSearchParams() (for ?tenant= and ?email=), which suspends during
 * prerendering and fails the build without a boundary.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordFallback() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
      <Skeleton height="1.5rem" width="70%" />
      <Skeleton height="1rem" width="90%" className="mt-2" />

      <div className="mt-6 flex flex-col gap-4">
        <Skeleton height="4rem" />
        <Skeleton height="4.75rem" />
        <Skeleton height="4rem" />
        <Skeleton height="3rem" />
      </div>
    </div>
  );
}

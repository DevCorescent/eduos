"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { platformLogout } from "@/services/platformUsers";

/**
 * End this platform session.
 *
 * Posts to /api/super-admin/auth/logout, which clears edu_platform — the only
 * cookie a platform operator holds. The tenant sign-out in services/auth.ts is
 * deliberately NOT used: it clears edu_access and edu_refresh, neither of which
 * exists here, and would report success while leaving the operator signed in.
 *
 * WHY THERE IS NO "SIGN OUT EVERYWHERE" BESIDE THIS
 *   A platform session is a signed JWT in a cookie. There is no PlatformSession
 *   table, so nothing records the other devices an operator is signed in on and
 *   nothing can revoke them — the tenant Session model has no platform
 *   counterpart. A button offering it would end this session and quietly leave
 *   every other one running, which is worse than not offering it at all.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      <div>
        <Button
          type="button"
          variant="danger"
          isLoading={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await platformLogout();

              if (!result.success) {
                setError(result.error);
                return;
              }

              // replace(), not push(): the console must not be reachable with
              // the back button once the session is gone. refresh() then
              // discards the cached Server Component payload, which still holds
              // this session's rendered data.
              //
              // /super-admin/login, never /login — a platform operator belongs
              // to no tenant and has no institution code to supply.
              router.replace("/super-admin/login");
              router.refresh();
            })
          }
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

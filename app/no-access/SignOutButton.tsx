"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { logout } from "@/services/auth";

/**
 * Sign out from the terminal no-portal page.
 *
 * The only action available here. Navigation uses replace() rather than push()
 * so the back button cannot return to a page that would immediately redirect
 * again — the very behaviour this route exists to end.
 */
export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  return (
    <Button
      variant="secondary"
      isLoading={isPending}
      onClick={async () => {
        setIsPending(true);
        await logout();
        console.log("[ROUTER] SignOutButton router.replace(", "/login", ")");
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}

"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_ACCOUNTS, MOCK_TENANT_SLUG } from "@/mock/auth";

interface DemoCredentials {
  tenantSlug: string;
  email: string;
  password: string;
}

/**
 * One-click sign-in for each demo account, shown only while mocks are on.
 *
 * The four portals differ by role, so reviewing the product means signing in
 * four times with addresses that exist nowhere in the UI. Listing them here
 * removes that — and it exercises the real path rather than a shortcut: picking
 * an account fills the form, and the user still submits it through the same
 * validation, service call and role-based redirect as any other sign-in.
 *
 * The login page renders this behind `USE_MOCKS`, so it disappears entirely
 * once the app is pointed at the live API.
 */
export function DemoAccountHint({ onPick }: { onPick: (credentials: DemoCredentials) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 rounded-md text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>Demo accounts — mock data, no backend</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <ul className="mt-3 flex flex-col gap-1">
          {MOCK_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                onClick={() =>
                  onPick({
                    tenantSlug: MOCK_TENANT_SLUG,
                    email: account.email,
                    // Any password signs in except the one the mock rejects, so
                    // this only needs to be non-empty to clear validation.
                    password: "demo",
                  })
                }
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block text-xs font-medium text-foreground">
                  {account.email}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {account.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

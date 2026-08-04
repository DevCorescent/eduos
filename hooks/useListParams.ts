"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Read and write the list controls held in the URL query string.
 *
 * Search, filters and the page number live in the URL rather than in component
 * state, and that is the load-bearing decision behind every list screen. It
 * means a filtered view can be linked, bookmarked and reloaded; the back button
 * steps through filter changes; and — because the page is a Server Component
 * reading searchParams — the data is fetched on the server rather than in a
 * client effect after paint.
 *
 * @example
 * ```tsx
 * const { get, setParam } = useListParams()
 * <Select value={get("status") ?? ""} onChange={e => setParam("status", e.target.value)} />
 * ```
 */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback(
    (key: string): string | null => searchParams.get(key),
    [searchParams]
  );

  /**
   * Set or clear one param and navigate.
   *
   * Two rules are applied on every write:
   *
   *  - An empty value removes the key instead of writing `?status=`, keeping
   *    URLs clean and matching what the service treats as "no filter".
   *  - Changing anything other than the page resets to page 1. Without that,
   *    narrowing a filter while on page 4 lands on a page that no longer
   *    exists, and the table reads as empty when it is not.
   */
  const setParam = useCallback(
    (key: string, value: string | null | undefined) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === null || value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }

      if (key !== "page") params.delete("page");

      const query = params.toString();
      // replace(), not push(): each keystroke in a search box would otherwise
      // become its own history entry, so leaving the page would mean pressing
      // back once per character typed.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  /** Set several params in one navigation, e.g. clearing a whole filter set. */
  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }

      params.delete("page");

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { get, setParam, setParams, pathname, searchParams };
}

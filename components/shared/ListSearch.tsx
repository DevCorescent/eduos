"use client";

import { SearchInput } from "@/components/ui/SearchInput";
import { useListParams } from "@/hooks/useListParams";

export interface ListSearchProps {
  /** Query-string key to write. @default "q" */
  paramKey?: string;
  placeholder?: string;
  className?: string;
  /**
   * Set when the backend cannot search this collection.
   *
   * The control stays on screen and stops working: it renders disabled with
   * this text beside it. That is deliberate — a search box that accepts typing
   * and silently returns the unfiltered list is worse than no search box,
   * because the user believes they have searched and trusts the result. The
   * string should name what is missing, not apologise.
   */
  unsupported?: string;
}

/**
 * Search box wired to the URL query string.
 *
 * Thin by design: SearchInput already owns the typed value and the debounce, so
 * this only supplies the initial value and writes the settled query through
 * useListParams. Re-implementing the debounce here would mean two components
 * disagreeing about the delay.
 *
 * Putting the query in the URL rather than in state is what lets a filtered
 * view be linked and reloaded, and lets the page fetch on the server instead of
 * in a client effect after paint.
 *
 * SearchInput is uncontrolled, so the field does not visibly reset if the user
 * navigates back to an earlier query — the results do, since those follow the
 * URL. Controlling it would mean remounting on every settled search and losing
 * focus mid-typing, which is the worse trade.
 *
 * @example
 * ```tsx
 * <ListSearch placeholder="Search tenants by name or code…" />
 * ```
 */
export function ListSearch({
  paramKey = "q",
  placeholder,
  className,
  unsupported,
}: ListSearchProps) {
  const { get, setParam } = useListParams();

  if (unsupported) {
    return (
      <div className={className}>
        <SearchInput
          disabled
          defaultValue=""
          onSearch={() => undefined}
          placeholder={placeholder ?? "Search…"}
          aria-describedby={`${paramKey}-unsupported`}
        />
        <p id={`${paramKey}-unsupported`} className="mt-1.5 text-xs text-muted-foreground">
          {unsupported}
        </p>
      </div>
    );
  }

  return (
    <SearchInput
      defaultValue={get(paramKey) ?? ""}
      onSearch={(query) => setParam(paramKey, query)}
      placeholder={placeholder ?? "Search…"}
      className={className}
      aria-label={placeholder ?? "Search"}
    />
  );
}

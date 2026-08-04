// components/ui/SearchInput.tsx

"use client";

import { useEffect, useState, forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "value" | "onChange" | "defaultValue"> {
  /** Initial value. Component manages its own typed state internally. */
  defaultValue?: string;
  /** Fires with the trimmed query after `debounceMs` of no typing. */
  onSearch: (query: string) => void;
  /** Debounce delay in ms. @default 300 */
  debounceMs?: number;
  size?: "sm" | "md" | "lg";
}

const sizeStyles = {
  sm: "h-8 text-sm pl-8 pr-8",
  md: "h-10 text-sm pl-9 pr-9",
  lg: "h-12 text-base pl-10 pr-10",
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

/**
 * Debounced search field. Keeps its own typed value in local state (so
 * every keystroke feels instant) and only calls `onSearch` after typing
 * pauses for `debounceMs` — the caller doesn't debounce anything itself,
 * it just receives a settled query, typically to refetch data or update
 * a `?q=` URL param.
 *
 * `"use client"` is required: debouncing needs `useEffect`/`useState`.
 *
 * @example
 * ```tsx
 * <SearchInput
 *   placeholder="Search students..."
 *   onSearch={(query) => router.push(`/students?q=${query}`)}
 * />
 * ```
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ defaultValue = "", onSearch, debounceMs = 300, size = "md", disabled, className, placeholder = "Search...", ...props }, ref) => {
    const [query, setQuery] = useState(defaultValue);

    useEffect(() => {
      const handle = setTimeout(() => {
        onSearch(query.trim());
      }, debounceMs);
      return () => clearTimeout(handle);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- onSearch intentionally excluded: including it would re-debounce on every parent render unless the caller memoizes it
    }, [query, debounceMs]);

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          <SearchIcon />
        </span>

        <input
          ref={ref}
          type="text"
          role="searchbox"
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-md border border-border bg-surface text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:opacity-50 disabled:pointer-events-none",
            sizeStyles[size],
            className
          )}
          {...props}
        />

        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <ClearIcon />
          </button>
        )}
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
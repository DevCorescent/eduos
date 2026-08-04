// components/ui/Breadcrumb.tsx

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string; // omitted or undefined on the last (current) item
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5 text-muted-foreground">
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  );
}

/**
 * Navigation trail showing the current page's location in the hierarchy.
 * The last item is treated as the current page — rendered as plain text,
 * not a link, with `aria-current="page"`, regardless of whether `href`
 * was passed for it.
 *
 * @example
 * ```tsx
 * <Breadcrumb
 *   items={[
 *     { label: "Dashboard", href: "/dashboard" },
 *     { label: "Students", href: "/students" },
 *     { label: "Priya Sharma" },
 *   ]}
 * />
 * ```
 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronIcon />}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(isLast ? "font-medium text-foreground" : "text-muted-foreground")}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground hover:underline"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
// components/ui/Pagination.tsx

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  /** Path to link to, without the query string, e.g. "/students". */
  basePath: string;
  /** Other query params to preserve across page links, e.g. { status: "active" }. */
  searchParams?: Record<string, string>;
  /** How many page numbers to show on each side of the current page. @default 1 */
  siblingCount?: number;
}

function buildHref(basePath: string, page: number, searchParams?: Record<string, string>) {
  const params = new URLSearchParams(searchParams);
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

/** Builds the ellipsis-collapsed page list, e.g. [1, "...", 4, 5, 6, "...", 20]. */
function getPageRange(current: number, total: number, siblingCount: number): (number | "ellipsis")[] {
  const totalSlots = siblingCount * 2 + 5; // first + last + current + 2 ellipses
  if (total <= totalSlots) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const left = Math.max(current - siblingCount, 2);
  const right = Math.min(current + siblingCount, total - 1);

  const pages: (number | "ellipsis")[] = [1];
  if (left > 2) pages.push("ellipsis");
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < total - 1) pages.push("ellipsis");
  pages.push(total);

  return pages;
}

/**
 * Page navigation built on real `<Link>` anchors that read/write the
 * `?page=` query param — not client-side state. This means it works with
 * zero JavaScript, is a Server Component (no `"use client"` needed), and
 * page state survives refresh/back-button/sharing a URL, which a
 * `useState`-based pager wouldn't get for free.
 *
 * The parent Server Component reads `searchParams.page` itself (Next.js
 * gives this to page components automatically) and passes the parsed
 * `currentPage` down — this component never touches `window` or hooks.
 *
 * @example
 * ```tsx
 * // app/students/page.tsx
 * export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
 *   const { page } = await searchParams;
 *   const currentPage = Number(page ?? 1);
 *   const { data, totalPages } = await getStudents({ page: currentPage });
 *
 *   return (
 *     <>
 *       <Table columns={columns} data={data} rowKey={(s) => s.id} />
 *       <Pagination currentPage={currentPage} totalPages={totalPages} basePath="/students" />
 *     </>
 *   );
 * }
 * ```
 */
export function Pagination({
  currentPage,
  totalPages,
  basePath,
  searchParams,
  siblingCount = 1,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getPageRange(currentPage, totalPages, siblingCount);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1">
      <PageLink
        href={currentPage > 1 ? buildHref(basePath, currentPage - 1, searchParams) : undefined}
        disabled={currentPage <= 1}
        ariaLabel="Previous page"
      >
        Prev
      </PageLink>

      {pages.map((page, i) =>
        page === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground" aria-hidden="true">
            …
          </span>
        ) : (
          <PageLink
            key={page}
            href={buildHref(basePath, page, searchParams)}
            isCurrent={page === currentPage}
            ariaLabel={`Page ${page}`}
          >
            {page}
          </PageLink>
        )
      )}

      <PageLink
        href={currentPage < totalPages ? buildHref(basePath, currentPage + 1, searchParams) : undefined}
        disabled={currentPage >= totalPages}
        ariaLabel="Next page"
      >
        Next
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  isCurrent,
  disabled,
  ariaLabel,
  children,
}: {
  href?: string;
  isCurrent?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const baseStyles = cn(
    "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );

  if (disabled || !href) {
    return (
      <span aria-disabled="true" className={cn(baseStyles, "text-muted-foreground/50 cursor-not-allowed")}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        baseStyles,
        isCurrent
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted"
      )}
    >
      {children}
    </Link>
  );
}
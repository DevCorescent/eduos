// components/layout/PortalBreadcrumb.tsx

"use client";

import { usePathname } from "next/navigation";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/Breadcrumb";
import { NAV_LABELS } from "@/constants/navigation";

/**
 * Matches a cuid — Prisma's `@default(cuid())`, so every id in this system:
 * a literal "c" followed by 24 base-36 characters. The looser
 * `[0-9a-f-]{20,}` alternative also catches a UUID, in case an id ever arrives
 * from an integration rather than from Prisma.
 */
const ID_SEGMENT = /^(c[a-z0-9]{24}|[0-9a-f-]{20,})$/i;

/**
 * Segments that are URL levels but not pages.
 *
 * "/setup/campuses" is a real route; "/setup" is not — nothing is mounted
 * there. Linking such a segment in the trail would hand the user a 404, so
 * these render as plain text. They are still shown, because dropping them
 * would make the trail misrepresent the hierarchy.
 */
const STRUCTURAL_SEGMENTS = new Set([
  "setup",
  "calendar",
  "curriculum",
  "finance",
  "certificates",
  "attendance",
  "platform",
]);

/**
 * Turn an unrecognised URL segment into a readable label.
 *
 * Only reached for segments absent from NAV_LABELS — a hyphenated slug the nav
 * tree does not link to directly. Title-casing beats rendering "fee-structures"
 * raw, and it degrades gracefully.
 */
function humanize(segment: string): string {
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface PortalBreadcrumbProps {
  /**
   * Label for the trail's first entry, and where it links.
   * @default { label: "Home", href: "/" }
   */
  root?: { label: string; href: string };
  className?: string;
}

/**
 * Breadcrumb derived from the current URL.
 *
 * Segment labels resolve through NAV_LABELS, which is built from the same nav
 * trees the sidebar renders — so renaming a nav entry updates the trail too,
 * instead of leaving a second hand-maintained map to drift.
 *
 * Id segments become "Details" rather than showing a raw cuid. A page that
 * knows the record's real name should render its own trail through
 * `<PageHeader breadcrumb={…}>`; this component cannot, because it only has the
 * URL and fetching a name here would mean a second request per navigation.
 *
 * Renders nothing at the portal root — a one-item trail pointing at the page
 * you are already on is noise.
 */
export function PortalBreadcrumb({
  root = { label: "Home", href: "/" },
  className,
}: PortalBreadcrumbProps) {
  const pathname = usePathname();
  const segments = pathname?.split("/").filter(Boolean) ?? [];

  // The root href is itself a path (e.g. "/platform/dashboard"), so its own
  // segments must not be repeated in the trail behind it.
  const rootDepth = root.href.split("/").filter(Boolean).length;
  const trail = segments.slice(rootDepth);

  if (trail.length === 0) return null;

  const items: BreadcrumbItem[] = [
    { label: root.label, href: root.href },
    ...trail.map((segment, i) => {
      const isLast = i === trail.length - 1;
      const href = `/${segments.slice(0, rootDepth + i + 1).join("/")}`;
      const label = ID_SEGMENT.test(segment)
        ? "Details"
        : (NAV_LABELS[segment] ?? humanize(segment));

      // Breadcrumb already renders the final item as plain text. The
      // structural check covers the other case: an intermediate segment that
      // looks linkable but has no page behind it.
      const isLinkable = !isLast && !STRUCTURAL_SEGMENTS.has(segment);
      return { label, href: isLinkable ? href : undefined };
    }),
  ];

  return <Breadcrumb items={items} className={className} />;
}

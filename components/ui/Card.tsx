// components/ui/Card.tsx

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Rendered in the header slot, above a border-separated divider. */
  header?: ReactNode;
  /** Rendered in the footer slot, below a border-separated divider. */
  footer?: ReactNode;
  /** Removes default body padding — useful when a Table fills the card. */
  noPadding?: boolean;
  children?: ReactNode;
}

/**
 * Basic surface container — white (or surface-token) box with rounded
 * corners and a subtle border/shadow. Optional header and footer slots
 * are visually separated from the body by a divider, matching the
 * Stripe/Linear "card with toolbar" pattern.
 *
 * @example Basic
 * ```tsx
 * <Card>Plain content</Card>
 * ```
 *
 * @example With header + footer
 * ```tsx
 * <Card
 *   header={<h2 className="font-semibold">Recent Submissions</h2>}
 *   footer={<Button size="sm">View all</Button>}
 * >
 *   ...
 * </Card>
 * ```
 *
 * @example Housing a Table (no double padding)
 * ```tsx
 * <Card header={<h2>Students</h2>} noPadding>
 *   <Table columns={columns} data={students} />
 * </Card>
 * ```
 */
export function Card({ header, footer, noPadding = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        // `glass` supplies the frosted fill, border and soft shadow together —
        // the three are one look, and splitting them across utilities is how a
        // card ends up frosted but flat, or shadowed but opaque.
        "glass rounded-lg",
        className
      )}
      {...props}
    >
      {header && (
        <div className="border-b border-border px-5 py-4">{header}</div>
      )}

      <div className={cn(!noPadding && "p-5")}>{children}</div>

      {footer && (
        <div className="border-t border-border px-5 py-4">{footer}</div>
      )}
    </div>
  );
}
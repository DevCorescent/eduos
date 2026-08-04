// components/shared/StatusBadge.tsx

import { Badge, type BadgeVariant } from "@/components/ui/Badge";

export interface StatusBadgeProps {
  /** Display text, from the matching `*_LABELS` map. */
  label: string;
  /** Semantic colour, from the matching `*_VARIANTS` map. */
  variant: BadgeVariant;
  /** Shows a leading dot. Useful in dense tables where colour alone is easy to miss. */
  withDot?: boolean;
  size?: "sm" | "md";
}

/**
 * A status chip, resolved from the label and variant maps in constants/labels.
 *
 * Deliberately takes a resolved label and variant rather than a raw enum value
 * plus an entity name. A `<StatusBadge entity="tenant" value={...} />` would
 * need a registry mapping entity names to maps, and TypeScript could not then
 * check that a StudentStatus was not passed as a tenant's — the call site is
 * where both are already known concretely.
 *
 * The thin wrapper still earns its place: every status cell across thirty-odd
 * tables goes through one component, so adding the dot, or changing how an
 * unknown status renders, is one edit rather than thirty.
 *
 * @example
 * ```tsx
 * <StatusBadge
 *   label={STUDENT_STATUS_LABELS[student.status]}
 *   variant={STUDENT_STATUS_VARIANTS[student.status]}
 * />
 * ```
 */
export function StatusBadge({ label, variant, withDot = true, size = "sm" }: StatusBadgeProps) {
  return (
    <Badge variant={variant} size={size} withDot={withDot}>
      {label}
    </Badge>
  );
}

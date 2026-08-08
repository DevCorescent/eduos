"use client";

import { Select, type SelectOption } from "@/components/ui/Select";
import { useListParams } from "@/hooks/useListParams";

export interface ListFilterProps {
  /** Query-string key this filter writes, e.g. "status". */
  paramKey: string;
  /** Accessible label. Rendered visually unless `hideLabel` is set. */
  label: string;
  options: SelectOption[];
  /** Label for the "no filter" option. @default `All ${label}` */
  allLabel?: string;
  hideLabel?: boolean;
  className?: string;
  /**
   * Set when the backend's query schema does not accept this key.
   *
   * Renders the control disabled rather than removing it, so the shape of the
   * screen does not change when the filter lands. A dropdown that writes a
   * parameter the route drops looks like a filter that found nothing, which
   * sends the user hunting for data that was never excluded.
   */
  unsupported?: string;
}

/**
 * Dropdown filter wired to the URL query string.
 *
 * The empty-string option means "unfiltered" and removes the key from the URL
 * rather than writing `?status=`, which keeps a default view's URL clean and
 * matches what the service layer treats as no filter.
 *
 * Selecting a filter also resets to page 1 — useListParams does that for any
 * key but `page`. Without it, narrowing a filter while on page 4 lands on a
 * page that no longer exists and the table reads as empty when it is not.
 *
 * @example
 * ```tsx
 * <ListFilter
 *   paramKey="status"
 *   label="Status"
 *   options={TENANT_STATUS_VALUES.map(v => ({ value: v, label: TENANT_STATUS_LABELS[v] }))}
 * />
 * ```
 */
export function ListFilter({
  paramKey,
  label,
  options,
  allLabel,
  hideLabel = false,
  className,
  unsupported,
}: ListFilterProps) {
  const { get, setParam } = useListParams();

  if (unsupported) {
    return (
      <Select
        label={hideLabel ? undefined : label}
        aria-label={`${label} — ${unsupported}`}
        title={unsupported}
        disabled
        value=""
        onChange={() => undefined}
        options={[{ value: "", label: allLabel ?? `All ${label}` }]}
        className={className}
      />
    );
  }

  return (
    <Select
      label={hideLabel ? undefined : label}
      aria-label={label}
      value={get(paramKey) ?? ""}
      // Select hands back the value itself, not the change event.
      onChange={(value) => setParam(paramKey, value)}
      options={[{ value: "", label: allLabel ?? `All ${label}` }, ...options]}
      className={className}
    />
  );
}

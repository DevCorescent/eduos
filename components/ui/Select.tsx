// components/ui/Select.tsx

import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "value" | "onChange"> {
  /** Options rendered in order. */
  options: SelectOption[];
  /** Currently selected value. Select is always controlled — no internal state. */
  value: string;
  /** Fires with the new value on selection. */
  onChange: (value: string) => void;
  /** Field label rendered above the select. */
  label?: string;
  /** Error message. Switches to error visual state and replaces helperText. */
  error?: string;
  /** Supporting text shown below the field when there's no error. */
  helperText?: string;
  /** Shown as a disabled first option when no value matches. */
  placeholder?: string;
  /** Physical size. @default "md" */
  size?: "sm" | "md" | "lg";
  containerClassName?: string;
}

const sizeStyles = {
  sm: "h-8 text-sm pl-3 pr-8",
  md: "h-10 text-sm pl-3 pr-9",
  lg: "h-12 text-base pl-4 pr-10",
};

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Controlled dropdown built on the native `<select>` — gets keyboard
 * navigation, typeahead, and mobile-native picker UI for free, which a
 * custom-built listbox would have to reimplement from scratch.
 *
 * Always controlled: `value` and `onChange` are required, not optional.
 * A dropdown with silently-diverging internal state is a common source of
 * bugs in forms (e.g. a value that looks selected but isn't submitted) —
 * making it uncontrollable removes that failure mode entirely.
 *
 * @example Basic
 * ```tsx
 * <Select
 *   label="Class"
 *   value={classId}
 *   onChange={setClassId}
 *   options={[
 *     { value: "c1", label: "Grade 6 - A" },
 *     { value: "c2", label: "Grade 6 - B" },
 *   ]}
 *   placeholder="Select a class"
 * />
 * ```
 *
 * @example Error state
 * ```tsx
 * <Select label="Status" value={status} onChange={setStatus} options={statusOptions} error="Please select a status" />
 * ```
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      options,
      value,
      onChange,
      label,
      error,
      helperText,
      placeholder,
      size = "md",
      disabled,
      required,
      className,
      containerClassName,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;
    const helperId = `${selectId}-helper`;
    const hasError = Boolean(error);

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-foreground">
            {label}
            {required && <span className="ml-0.5 text-danger">*</span>}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            value={value}
            disabled={disabled}
            required={required}
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : helperText ? helperId : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "w-full appearance-none rounded-md border bg-surface text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:opacity-50 disabled:pointer-events-none",
              hasError
                ? "border-danger focus-visible:ring-danger"
                : "border-border focus-visible:ring-ring",
              sizeStyles[size],
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled hidden={value !== ""}>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <ChevronIcon />
          </span>
        </div>

        {hasError ? (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : (
          helperText && (
            <p id={helperId} className="text-xs text-muted-foreground">
              {helperText}
            </p>
          )
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
// components/ui/Switch.tsx

"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Label rendered beside the track. Clicking it toggles the switch. */
  label?: ReactNode;
  /** Supporting text below the label. Replaced by `error` when that is set. */
  helperText?: string;
  error?: string;
  /** Which side the label sits on. @default "right" */
  labelPosition?: "left" | "right";
  size?: "sm" | "md";
  containerClassName?: string;
}

const trackStyles = {
  sm: "h-5 w-9",
  md: "h-6 w-11",
};

const thumbStyles = {
  sm: "size-4",
  md: "size-5",
};

/**
 * The thumb is a descendant of the track, not a sibling of the input, so
 * `peer-checked:` cannot target it directly — that variant compiles to a
 * sibling combinator. The slide is therefore applied from the track, which
 * *is* a sibling, down onto its child.
 */
const thumbSlideStyles = {
  sm: "peer-checked:[&>span]:translate-x-4",
  md: "peer-checked:[&>span]:translate-x-5",
};

/**
 * Toggle for a setting that applies immediately — "Set as current academic
 * year", "Notify parents on absence".
 *
 * Use a Checkbox instead when the value is only committed on submit. The visual
 * difference carries real meaning to users: a switch reads as "this is on now",
 * a checkbox as "this will be included when I save".
 *
 * Like Checkbox, it wraps a real `<input type="checkbox">` — kept in the DOM
 * and focusable, with only its native rendering suppressed — so form
 * participation, the space-bar toggle and screen-reader semantics all come from
 * the platform. `role="switch"` refines the announcement from "checkbox,
 * checked" to "switch, on".
 *
 * @example
 * ```tsx
 * <Switch label="Set as current" checked={isCurrent} onChange={e => setCurrent(e.target.checked)} />
 * ```
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      label,
      helperText,
      error,
      labelPosition = "right",
      size = "md",
      disabled,
      className,
      containerClassName,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;
    const hasError = Boolean(error);

    const labelNode = label && (
      <label
        htmlFor={inputId}
        className={cn(
          "cursor-pointer text-sm text-foreground",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {label}
      </label>
    );

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        <div className="flex items-center gap-2.5">
          {labelPosition === "left" && labelNode}

          <span className="relative inline-flex shrink-0 items-center">
            <input
              ref={ref}
              id={inputId}
              type="checkbox"
              role="switch"
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : helperText ? helperId : undefined}
              className={cn(
                "peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed",
                trackStyles[size]
              )}
              {...props}
            />

            <span
              aria-hidden="true"
              className={cn(
                "flex items-center rounded-full border border-transparent bg-surface-active p-0.5 transition-colors",
                "peer-checked:bg-primary",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                "peer-disabled:opacity-50",
                hasError && "border-danger",
                trackStyles[size],
                thumbSlideStyles[size],
                className
              )}
            >
              <span
                className={cn(
                  "rounded-full bg-surface shadow-sm transition-transform",
                  thumbStyles[size]
                )}
              />
            </span>
          </span>

          {labelPosition === "right" && labelNode}
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

Switch.displayName = "Switch";

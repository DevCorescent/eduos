// components/ui/Checkbox.tsx

"use client";

import { forwardRef, useEffect, useId, useRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Label rendered to the right of the box. Clicking it toggles the checkbox. */
  label?: ReactNode;
  /** Supporting text below the label. Replaced by `error` when that is set. */
  helperText?: string;
  /** Error message. Switches the box to the danger state. */
  error?: string;
  /**
   * Renders the "some but not all" dash, for a header checkbox over a
   * partially-selected table.
   */
  indeterminate?: boolean;
  size?: "sm" | "md";
  containerClassName?: string;
}

const sizeStyles = {
  sm: "size-4",
  md: "size-5",
};

/**
 * Checkbox built on a real `<input type="checkbox">` that is visually hidden
 * but still present and focusable, with the visible box drawn as a sibling.
 *
 * This keeps the native control's entire behaviour for free — form
 * participation and submitted values, the space-bar toggle, `:checked` state,
 * screen-reader role and announcements — none of which a `<div role="checkbox">`
 * gets without reimplementing each one, usually incompletely.
 *
 * `indeterminate` is applied through a ref rather than a prop because it is a
 * DOM *property* with no corresponding HTML attribute, so React cannot set it
 * declaratively.
 *
 * @example Single
 * ```tsx
 * <Checkbox label="Mark attendance as final" checked={isFinal} onChange={e => setFinal(e.target.checked)} />
 * ```
 *
 * @example Table header (select-all)
 * ```tsx
 * <Checkbox
 *   checked={allSelected}
 *   indeterminate={someSelected && !allSelected}
 *   onChange={toggleAll}
 * />
 * ```
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      helperText,
      error,
      indeterminate = false,
      size = "md",
      disabled,
      className,
      containerClassName,
      id,
      ...props
    },
    forwardedRef
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;
    const hasError = Boolean(error);

    const innerRef = useRef<HTMLInputElement>(null);

    // The forwarded ref must still reach the caller, so it is populated by hand
    // alongside the local one rather than being passed straight to the input.
    useEffect(() => {
      const node = innerRef.current;
      if (!node) return;

      node.indeterminate = indeterminate;

      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [indeterminate, forwardedRef]);

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        <div className="flex items-start gap-2.5">
          <span className="relative flex shrink-0 items-center">
            <input
              ref={innerRef}
              id={inputId}
              type="checkbox"
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : helperText ? helperId : undefined}
              className={cn(
                // Kept in the layout and focusable — only its own rendering is
                // suppressed, so `peer-*` below can style the visible box from
                // the input's real state.
                "peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed",
                sizeStyles[size]
              )}
              {...props}
            />

            <span
              aria-hidden="true"
              className={cn(
                "flex items-center justify-center rounded border bg-surface text-primary-foreground transition-colors",
                "peer-checked:border-primary peer-checked:bg-primary",
                "peer-indeterminate:border-primary peer-indeterminate:bg-primary",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                "peer-disabled:opacity-50",
                // The tick is a *descendant*, not a sibling, so `peer-checked:`
                // cannot reach it directly — Tailwind compiles that variant to a
                // sibling combinator. Targeting the child from the sibling span
                // is what makes the state actually apply.
                "[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100 peer-indeterminate:[&>svg]:opacity-100",
                hasError ? "border-danger" : "border-border",
                sizeStyles[size],
                className
              )}
            >
              {indeterminate ? (
                <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
                  <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
                  <path
                    d="M13 4.5L6.5 11 3 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </span>

          {label && (
            <label
              htmlFor={inputId}
              className={cn(
                "cursor-pointer text-sm text-foreground",
                size === "sm" ? "leading-4" : "leading-5",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {label}
            </label>
          )}
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

Checkbox.displayName = "Checkbox";

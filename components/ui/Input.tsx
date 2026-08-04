// components/ui/Input.tsx

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Field label rendered above the input. */
  label?: string;
  /** Error message. When present, the field switches to an error visual state and this text replaces helperText. */
  error?: string;
  /** Supporting text shown below the field when there's no error. */
  helperText?: string;
  /** Icon rendered inside the field, left side. */
  leftIcon?: ReactNode;
  /** Icon rendered inside the field, right side. Hidden while isLoading. */
  rightIcon?: ReactNode;
  /** Shows a spinner in the right-icon slot and disables the field. */
  isLoading?: boolean;
  /** Physical size. @default "md" */
  size?: "sm" | "md" | "lg";
  containerClassName?: string;
}

const sizeStyles = {
  sm: "h-8 text-sm",
  md: "h-10 text-sm",
  lg: "h-12 text-base",
};

const iconPadding = {
  sm: { left: "pl-8", right: "pr-8" },
  md: { left: "pl-9", right: "pr-9" },
  lg: { left: "pl-10", right: "pr-10" },
};

function FieldSpinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * Text input with an optional label, helper text, and error state.
 * Built on the native `<input>`, so all standard HTML attributes pass
 * through untouched.
 *
 * Error and helper text are mutually exclusive by design: when `error`
 * is set, it fully replaces `helperText` in the DOM rather than showing
 * both — two competing messages under one field is confusing, not helpful.
 *
 * @example Basic
 * ```tsx
 * <Input label="Email" placeholder="you@school.edu" />
 * ```
 *
 * @example With helper text
 * ```tsx
 * <Input label="Class code" helperText="6-digit code shared by your teacher" />
 * ```
 *
 * @example Error state
 * ```tsx
 * <Input label="Email" error="Please enter a valid email address" />
 * ```
 *
 * @example Icons + loading
 * ```tsx
 * <Input label="Search" leftIcon={<SearchIcon />} isLoading={isChecking} />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      isLoading = false,
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
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;
    const hasError = Boolean(error);
    const isDisabled = disabled || isLoading;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}

        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground [&>svg]:size-4">
              {leftIcon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={isDisabled}
            required={required}
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : helperText ? helperId : undefined}
            className={cn(
              "w-full rounded-md border bg-surface px-3 text-foreground placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:opacity-50 disabled:pointer-events-none",
              hasError
                ? "border-danger focus-visible:ring-danger"
                : "border-border focus-visible:ring-ring",
              sizeStyles[size],
              leftIcon && iconPadding[size].left,
              (rightIcon || isLoading) && iconPadding[size].right,
              className
            )}
            {...props}
          />

          {isLoading ? (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <FieldSpinner />
            </span>
          ) : (
            rightIcon && (
              <span className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground [&>svg]:size-4">
                {rightIcon}
              </span>
            )
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

Input.displayName = "Input";
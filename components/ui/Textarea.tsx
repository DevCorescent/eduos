// components/ui/Textarea.tsx

import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /** Field label rendered above the textarea. */
  label?: string;
  /** Error message. Switches to error visual state and replaces helperText. */
  error?: string;
  /** Supporting text shown below the field when there's no error. */
  helperText?: string;
  /** Physical size, affects min-height and padding. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Resize behavior. @default "vertical" */
  resize?: "none" | "vertical" | "horizontal" | "both";
  /** Shows a live character counter when maxLength is set. */
  showCount?: boolean;
  containerClassName?: string;
}

const sizeStyles = {
  sm: "min-h-16 text-sm px-3 py-1.5",
  md: "min-h-24 text-sm px-3 py-2",
  lg: "min-h-32 text-base px-4 py-2.5",
};

const resizeStyles = {
  none: "resize-none",
  vertical: "resize-y",
  horizontal: "resize-x",
  both: "resize",
};

/**
 * Multi-line text field with an optional label, helper text, error state,
 * and character counter. Built on the native `<textarea>`.
 *
 * Error and helper text are mutually exclusive, matching Input — `error`
 * fully replaces `helperText` rather than showing both at once.
 *
 * @example Basic
 * ```tsx
 * <Textarea label="Description" placeholder="Add class details..." />
 * ```
 *
 * @example With character limit
 * ```tsx
 * <Textarea label="Bio" maxLength={200} showCount />
 * ```
 *
 * @example Error state
 * ```tsx
 * <Textarea label="Feedback" error="Feedback cannot be empty" />
 * ```
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      helperText,
      size = "md",
      resize = "vertical",
      showCount = false,
      disabled,
      required,
      maxLength,
      value,
      defaultValue,
      className,
      containerClassName,
      id,
      onChange,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;
    const countId = `${textareaId}-count`;
    const hasError = Boolean(error);

    // Character count works for both controlled and uncontrolled usage —
    // controlled reads from `value`, uncontrolled falls back to `defaultValue`
    // as an initial count only (won't live-update without a value prop).
    const currentLength =
      typeof value === "string"
        ? value.length
        : typeof defaultValue === "string"
          ? defaultValue.length
          : undefined;

    const describedBy =
      [
        hasError ? errorId : helperText ? helperId : null,
        showCount && maxLength ? countId : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-foreground">
            {label}
            {required && <span className="ml-0.5 text-danger">*</span>}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          disabled={disabled}
          required={required}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-md border bg-surface text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:opacity-50 disabled:pointer-events-none",
            hasError
              ? "border-danger focus-visible:ring-danger"
              : "border-border focus-visible:ring-ring",
            sizeStyles[size],
            resizeStyles[resize],
            className
          )}
          {...props}
        />

        <div className="flex items-start justify-between gap-2">
          <div>
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

          {showCount && maxLength && (
            <p
              id={countId}
              className={cn(
                "shrink-0 text-xs tabular-nums text-muted-foreground",
                currentLength !== undefined &&
                  currentLength >= maxLength &&
                  "text-danger"
              )}
            >
              {currentLength ?? 0}/{maxLength}
            </p>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
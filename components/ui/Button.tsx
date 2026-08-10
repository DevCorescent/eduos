// components/ui/Button.tsx

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Visual style of the button — each maps to a distinct semantic purpose.
 *
 * `danger` is retained as the historical spelling of `destructive`. Both are
 * accepted and render identically, so the ~4 existing call sites did not have
 * to be rewritten to gain the new variants; the alias costs nothing at runtime
 * and can be dropped once nothing uses it.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outlined"
  | "inverted"
  | "destructive"
  | "danger"
  | "ghost"
  | "link"
  | "icon";

/** Physical size of the button, controlling height, padding, and font size. */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Visual style. @default "primary" */
  variant?: ButtonVariant;
  /** Physical size. @default "md" */
  size?: ButtonSize;
  /**
   * Shows a spinner in place of leftIcon and disables interaction,
   * while preserving the button's width and label for layout stability.
   */
  isLoading?: boolean;
  /** Icon rendered before the label. Hidden automatically while loading. */
  leftIcon?: ReactNode;
  /** Icon rendered after the label. */
  rightIcon?: ReactNode;
  /** Stretches the button to fill its container's width. */
  fullWidth?: boolean;
  /** Button label / content. */
  children?: ReactNode;
}

const baseStyles = [
  "inline-flex items-center justify-center gap-2",
  "font-medium whitespace-nowrap select-none",
  // `transition-all`, not `transition-colors`: the primary variant lifts and
  // grows its shadow on hover, and neither would animate otherwise.
  // Pill, always. DESIGN.md: "Buttons & Chips: Always fully pill-shaped (50%
  // of height) to contrast against the rectangular grid of the dashboard."
  "rounded-full transition-all duration-200",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-50",
].join(" ");

const variantStyles: Record<ButtonVariant, string> = {
  // The gradient, its clay lighting and the press inversion all live in
  // .btn-gradient in globals.css — a gradient cannot be expressed as a Tailwind
  // colour token, and keeping it there means the brand surface is defined once
  // for buttons, hero panels and text alike.
  primary: "btn-gradient",

  // Filled with the surface, not the canvas, so it stays legible on both.
  secondary:
    "bg-surface text-foreground border border-border shadow-soft hover:bg-surface-hover hover:shadow-hover active:shadow-inset",

  // Border only. Distinct from `secondary`, which is filled — an outlined
  // button on a glass panel lets the panel show through, which is the point.
  outlined:
    "bg-transparent text-foreground border border-outline hover:bg-surface-hover hover:border-foreground",

  // The high-contrast counterweight to `primary`, for the one action on a
  // light panel that must outrank everything around it.
  inverted:
    "bg-heading text-background shadow-soft hover:shadow-hover hover:opacity-90 active:shadow-inset",

  destructive:
    "bg-danger text-danger-foreground shadow-soft hover:bg-danger-hover hover:shadow-hover active:bg-danger-active",
  danger:
    "bg-danger text-danger-foreground shadow-soft hover:bg-danger-hover hover:shadow-hover active:bg-danger-active",

  ghost: "bg-transparent text-foreground hover:bg-muted",

  // No chrome at all: sits inline in prose and must not look like a control
  // until it is hovered.
  link: "bg-transparent text-primary underline-offset-4 hover:underline p-0 h-auto",

  // Icon-only. Squared to its own height by sizeStyles below so it lands as a
  // circle rather than a stretched pill.
  icon: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-4 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-base",
};

/**
 * Icon-only sizing: width equals height so the pill radius resolves to a
 * circle. Applied instead of the padded sizes above, never alongside them.
 */
const iconOnlySizeStyles: Record<ButtonSize, string> = {
  sm: "size-8 p-0",
  md: "size-10 p-0",
  lg: "size-12 p-0",
};

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: "size-4",
  md: "size-4",
  lg: "size-5",
};

/**
 * The class string Button renders with, exposed for elements that must not be
 * a `<button>`.
 *
 * A navigation action has to be a real `<a>`: an anchor is what gives
 * middle-click, "open in new tab", the status-bar URL preview and crawlable
 * markup, none of which a button with an onClick handler provides. Rather than
 * add an `asChild` prop — which would mean cloneElement and merging props by
 * hand — the styling is shared and the element stays whatever it should be.
 *
 * @example
 * ```tsx
 * <Link href="/students/new" className={buttonStyles({ size: "lg", fullWidth: true })}>
 *   Enrol student
 * </Link>
 * ```
 */
export function buttonStyles({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    baseStyles,
    variantStyles[variant],
    // `icon` is squared to a circle and `link` carries no box at all, so
    // neither takes the padded size ramp the other variants share.
    variant === "icon"
      ? iconOnlySizeStyles[size]
      : variant === "link"
        ? ""
        : sizeStyles[size],
    fullWidth && "w-full",
    className
  );
}

/** Inline loading spinner, self-contained so Button has no dependency on Spinner.tsx. */
function ButtonSpinner({ size }: { size: ButtonSize }) {
  return (
    <svg
      className={cn("animate-spin", iconSizeStyles[size])}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Primary interactive action element used across eduOS.
 *
 * Supports four semantic variants (primary, secondary, ghost, danger),
 * three sizes (sm, md, lg), loading state, leading/trailing icons, and
 * full-width layout. Built on the native `<button>` element, so all
 * standard HTML button attributes (`type`, `form`, `aria-*`, `onClick`,
 * etc.) pass through untouched.
 *
 * @example Basic usage
 * ```tsx
 * <Button onClick={handleSave}>Save changes</Button>
 * ```
 *
 * @example Variants and sizes
 * ```tsx
 * <Button variant="danger" size="sm">Delete</Button>
 * <Button variant="ghost" size="lg">Cancel</Button>
 * ```
 *
 * @example Icons
 * ```tsx
 * <Button leftIcon={<PlusIcon />}>New course</Button>
 * <Button rightIcon={<ArrowRightIcon />} variant="secondary">Continue</Button>
 * ```
 *
 * @example Loading + async submit
 * ```tsx
 * <Button isLoading={isPending} onClick={handleSubmit}>
 *   Create student
 * </Button>
 * ```
 *
 * @example Full width in a form footer
 * ```tsx
 * <Button fullWidth type="submit">Sign in</Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      disabled,
      className,
      children,
      type = "button",
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={isLoading}
        className={buttonStyles({ variant, size, fullWidth, className })}
        {...props}
      >
        {isLoading ? (
          <ButtonSpinner size={size} />
        ) : (
          leftIcon && (
            <span className={cn("inline-flex shrink-0", iconSizeStyles[size])}>
              {leftIcon}
            </span>
          )
        )}

        {children && <span className="truncate">{children}</span>}

        {!isLoading && rightIcon && (
          <span className={cn("inline-flex shrink-0", iconSizeStyles[size])}>
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
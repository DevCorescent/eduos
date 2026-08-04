// components/ui/Alert.tsx

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AlertVariant = "success" | "error" | "warning" | "info";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  /** Bold heading line above the description. */
  title?: string;
  /** Optional icon override. Defaults to a per-variant icon. */
  icon?: ReactNode;
  /** Shows a dismiss (×) button and fires this on click. */
  onDismiss?: () => void;
  children?: ReactNode;
}

const variantStyles: Record<AlertVariant, string> = {
  success: "bg-success-bg border-success/20 text-success-bg-foreground",
  error: "bg-danger-bg border-danger/20 text-danger-bg-foreground",
  warning: "bg-warning-bg border-warning/20 text-warning-bg-foreground",
  info: "bg-info-bg border-info/20 text-info-bg-foreground",
};

const defaultIcons: Record<AlertVariant, ReactNode> = {
  success: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.14a.75.75 0 00-1.214-.882l-3.483 4.79-1.68-1.68a.75.75 0 00-1.06 1.061l2.32 2.32a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
    </svg>
  ),
};

/**
 * Inline banner for surfacing a status message tied to page content —
 * form submission results, background job outcomes, system notices.
 * Not for transient toasts; this renders inline and stays until dismissed
 * or the parent removes it (build a separate Toast component for
 * auto-expiring notifications).
 *
 * Background/text use the `*-bg` / `*-bg-foreground` token pairs for
 * dark-mode-safe contrast; the border keeps solid `variant/20` opacity
 * since it's a thin accent line, not a large contrast-bearing surface.
 *
 * @example
 * ```tsx
 * <Alert variant="error" title="Failed to save">
 *   Check the required fields and try again.
 * </Alert>
 * ```
 *
 * @example Dismissible
 * ```tsx
 * <Alert variant="success" onDismiss={() => setShow(false)}>
 *   Student record updated.
 * </Alert>
 * ```
 */
export function Alert({
  variant = "info",
  title,
  icon,
  onDismiss,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-md border px-4 py-3",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      <div className="shrink-0">{icon ?? defaultIcons[variant]}</div>

      <div className="flex-1 text-sm">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          // currentColor at low opacity, so the hover tint is drawn from the
          // alert's own variant instead of a neutral grey that clashes with it.
          className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  );
}
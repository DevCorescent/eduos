// components/ui/Drawer.tsx

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible dialog title, also rendered in the header. */
  title: string;
  description?: string;
  /** Edge the panel slides in from. @default "right" */
  side?: "left" | "right";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  /** Pinned to the bottom of the panel — typically Cancel / Save. */
  footer?: ReactNode;
}

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
};

/**
 * Side panel for content too tall or too long-lived for a Modal: a filter
 * stack, a record's detail beside the list it came from, a multi-field form
 * that would otherwise force the dialog to scroll.
 *
 * Reach for Modal instead when the interaction is a short interruption that
 * must be resolved before anything else — a confirmation, a two-field create.
 *
 * Rendered through a portal to `document.body` for the same reason as Modal: it
 * must escape any ancestor's `overflow: hidden` or z-index stacking context,
 * which is otherwise a recurring source of "the panel is clipped" bugs in a
 * deeply nested tree.
 *
 * The full-height side panel is what makes this usable on a phone, where a
 * centred dialog with a long form has nowhere to go.
 *
 * @example
 * ```tsx
 * <Drawer isOpen={showFilters} onClose={close} title="Filter students" side="right">
 *   <StudentFilters />
 * </Drawer>
 * ```
 */
export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  side = "right",
  size = "md",
  children,
  footer,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Unique per instance. A hardcoded id would collide the moment two drawers
  // are mounted at once, pointing every aria-labelledby at whichever rendered
  // first.
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) return;

    triggerRef.current = document.activeElement as HTMLElement;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    // The page behind must not scroll while the panel is open, or a scroll
    // gesture over the backdrop moves the wrong content.
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      // Focus returns to whatever opened the drawer, so keyboard users are not
      // dropped back at the top of the document.
      triggerRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          // Solid for the same reason as Modal: it holds content to be read.
          "absolute inset-y-0 flex w-full flex-col border-border bg-surface shadow-hover",
          "focus-visible:outline-none",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          sizeStyles[size]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-heading">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Only the body scrolls, so the header and footer stay reachable
            however long the content runs. */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

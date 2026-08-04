// components/ui/Modal.tsx

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible dialog title — also rendered visually in the header. */
  title: string;
  /** Optional content below the title, e.g. a short description. */
  description?: string;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

/**
 * Dialog overlay rendered via a portal to `document.body`, so it escapes
 * any parent `overflow: hidden` / `z-index` stacking context — a common
 * bug source when modals are rendered inline in a deeply nested tree.
 *
 * Closes on Escape and on backdrop click. Traps nothing beyond returning
 * focus to the trigger on close and moving focus into the dialog on open
 * — a full focus trap (cycling Tab within the dialog) is deliberately
 * left out here; wire up `focus-trap-react` or similar if a specific
 * modal needs strict trapping (e.g. a blocking confirmation dialog).
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false);
 *
 * <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Delete student?">
 *   <p>This action cannot be undone.</p>
 * </Modal>
 * ```
 */
export function Modal({ isOpen, onClose, title, description, size = "md", children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Unique per instance. Hardcoded ids would collide as soon as two modals are
  // mounted together — a confirm dialog opened from inside a form modal, say —
  // pointing both aria-labelledby attributes at whichever rendered first.
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) return;

    triggerRef.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      triggerRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          // Solid, not frosted: a dialog sits over a blurred backdrop, and
          // frosting it too would let the page show through the content the
          // user is being asked to read.
          "relative w-full rounded-lg border border-border bg-surface shadow-hover",
          "focus-visible:outline-none",
          sizeStyles[size]
        )}
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-heading">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
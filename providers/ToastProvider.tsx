// providers/ToastProvider.tsx

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  /** Optional second line, e.g. the API's error message. */
  description?: string;
  /** Milliseconds before auto-dismissal. Pass 0 to require a manual close. */
  duration: number;
}

/** What a caller supplies; `id` is assigned and `duration` defaulted here. */
export interface ToastInput {
  variant?: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Long enough to read a two-line message without feeling stuck. */
const DEFAULT_DURATION = 5000;

/** Errors persist until dismissed — they usually require the user to do something. */
const ERROR_DURATION = 0;

/**
 * Holds the toast queue and renders the viewport.
 *
 * Mounted once in the root layout. Confirmation of a mutation ("Student
 * enrolled") belongs here rather than in an inline <Alert>, because the
 * component that triggered the action is frequently unmounted by the time it
 * succeeds — a modal closes, a row is removed — leaving no place for inline
 * feedback to live. Field-level validation is the opposite case and stays
 * inline on the input.
 *
 * @example
 * ```tsx
 * const { toast } = useToast()
 * const res = await createCampus(values)
 * res.success
 *   ? toast({ variant: "success", title: "Campus created" })
 *   : toast({ variant: "error", title: "Could not create campus", description: res.error })
 * ```
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Timers are tracked so a manual dismiss can cancel the pending auto-dismiss;
  // otherwise a stale timeout fires later against an id that is already gone.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput): string => {
      const variant = input.variant ?? "info";
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const duration =
        input.duration ?? (variant === "error" ? ERROR_DURATION : DEFAULT_DURATION);

      setToasts((current) => [...current, { id, variant, title: input.title, description: input.description, duration }]);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }

      return id;
    },
    [dismiss]
  );

  // Every pending timer is cleared on unmount so none fires against a
  // setState on an unmounted provider.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Access the toast queue.
 *
 * Throws when called outside the provider rather than returning a no-op. A
 * silent no-op would mean a failed mutation reports nothing at all, which is
 * strictly worse than a loud error during development.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a <ToastProvider>.");
  }
  return context;
}

// --- Viewport ---------------------------------------------------------------

const variantStyles: Record<ToastVariant, string> = {
  success: "bg-success-bg border-success/30 text-success-bg-foreground",
  error: "bg-danger-bg border-danger/30 text-danger-bg-foreground",
  warning: "bg-warning-bg border-warning/30 text-warning-bg-foreground",
  info: "bg-info-bg border-info/30 text-info-bg-foreground",
};

const variantIcons: Record<ToastVariant, ReactNode> = {
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
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
    </svg>
  ),
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  // createPortal needs a real document, which does not exist during the server
  // render — but no mount gate is required to avoid that. An empty queue
  // renders null, and the queue can only become non-empty from an event
  // handler, which cannot run before hydration. So the server render and the
  // first client render both return null here and always agree.
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      // "polite" so an announcement waits for the screen reader to finish its
      // current utterance. "assertive" would interrupt mid-sentence, and a
      // success confirmation never warrants that.
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg",
            variantStyles[t.variant]
          )}
        >
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {variantIcons[t.variant]}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.title}</p>
            {t.description && <p className="mt-0.5 text-sm opacity-90">{t.description}</p>}
          </div>

          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="-mr-1 -mt-1 shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

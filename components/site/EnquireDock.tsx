"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Enquire Dock (W4d)
// LAYER  : Presentation (client)
// PURPOSE: Optional quick-action cluster for admissions enquiries.
//
// PLACEMENT: BOTTOM-RIGHT FAB, NOT A MID-PAGE VERTICAL RAIL
//   The reference pins a tall strip to the middle of the right edge. That strip
//   covers carousel arrows, body copy and mobile viewport width on every scroll
//   position. A collapsed button in the thumb zone stays clear of content until
//   the visitor opens it — and institutions that do not want it leave
//   `enabled` false, in which case this component returns null.
// ============================================================================

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Calendar,
  FileText,
  Link2,
  MessageCircle,
  MessageSquarePlus,
  PencilLine,
  Phone,
  X,
} from "lucide-react";
import type { EnquireIcon, EnquireRail } from "@/lib/domain/cms/site";
import { cn } from "@/lib/utils";

const ICONS = {
  whatsapp: MessageCircle,
  apply: PencilLine,
  phone: Phone,
  message: MessageSquarePlus,
  document: FileText,
  calendar: Calendar,
  chart: BarChart3,
  link: Link2,
} satisfies Record<EnquireIcon, React.ComponentType<{ className?: string }>>;

export function EnquireDock({ rail }: { rail: EnquireRail }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Close on outside click / Escape — the dock is a disclosure, not a modal.
  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!rail.enabled || rail.items.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="pointer-events-none fixed bottom-6 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-8 sm:right-6"
    >
      {open && (
        <ul
          id={panelId}
          className="pointer-events-auto flex w-56 flex-col gap-2 rounded-2xl border border-border bg-surface p-2 shadow-hover"
          role="menu"
          aria-label={rail.label}
        >
          {rail.items.map((item) => {
            const Glyph = item.icon ? ICONS[item.icon] : Link2;
            return (
              <li key={`${item.label}-${item.href}`} role="none">
                <Link
                  href={item.href}
                  role="menuitem"
                  className="flex items-center gap-3 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setOpen(false)}
                >
                  <Glyph className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className={cn(
          "pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-hover transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          open && "pr-3"
        )}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <>
            <span>Close</span>
            <X className="size-4" aria-hidden="true" />
          </>
        ) : (
          <>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            <span>{rail.label}</span>
          </>
        )}
      </button>
    </div>
  );
}

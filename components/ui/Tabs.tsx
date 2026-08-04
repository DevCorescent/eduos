// components/ui/Tabs.tsx

"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Horizontal tab bar with a sliding active indicator. Controlled — the
 * parent owns which tab is active and swaps the associated panel content;
 * this component only renders the tab list and fires `onChange`, it does
 * not render or manage panel content itself (keeps it reusable for any
 * shape of tab content).
 *
 * Requires `"use client"` for keyboard arrow-key navigation between tabs
 * per the WAI-ARIA tabs pattern (roving tabindex).
 *
 * @example
 * ```tsx
 * const [tab, setTab] = useState("overview");
 *
 * <Tabs
 *   tabs={[
 *     { value: "overview", label: "Overview" },
 *     { value: "grades", label: "Grades" },
 *     { value: "attendance", label: "Attendance" },
 *   ]}
 *   value={tab}
 *   onChange={setTab}
 * />
 *
 * {tab === "overview" && <OverviewPanel />}
 * {tab === "grades" && <GradesPanel />}
 * ```
 */
export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  const baseId = useId();

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const enabled = tabs.map((t, i) => ({ ...t, i })).filter((t) => !t.disabled);
    const currentPos = enabled.findIndex((t) => t.i === index);

    let nextPos: number | null = null;
    if (e.key === "ArrowRight") nextPos = (currentPos + 1) % enabled.length;
    if (e.key === "ArrowLeft") nextPos = (currentPos - 1 + enabled.length) % enabled.length;
    if (e.key === "Home") nextPos = 0;
    if (e.key === "End") nextPos = enabled.length - 1;

    if (nextPos !== null) {
      e.preventDefault();
      const next = enabled[nextPos];
      onChange(next.value);
      document.getElementById(`${baseId}-tab-${next.value}`)?.focus();
    }
  }

  return (
    <div role="tablist" aria-orientation="horizontal" className={cn("flex gap-1 border-b border-border", className)}>
      {tabs.map((tab, i) => {
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            id={`${baseId}-tab-${tab.value}`}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`${baseId}-panel-${tab.value}`}
            disabled={tab.disabled}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "relative px-3 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "disabled:opacity-50 disabled:pointer-events-none",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

/**
 * A dashboard panel whose data the backend cannot yet supply.
 *
 * WHY THIS EXISTS RATHER THAN THE PANEL BEING OMITTED
 *   Resource usage, system health and platform-wide AI insights are all named
 *   in the specification and all shown in the reference, and none has an
 *   endpoint: there is no metrics model, no health route, and /api/ai/* is
 *   tenant-scoped question answering rather than platform analytics.
 *
 *   The reference fills those panels with figures — 65% CPU, 82% storage. Those
 *   numbers are illustration. Reproducing them would put fabricated operational
 *   data in front of the person responsible for the platform's uptime, which is
 *   the single worst place in the product to invent a number.
 *
 *   Removing the panels instead would lose the layout, and the section would
 *   have to be designed again when the endpoint lands. So the panel keeps its
 *   place and its proportions, and says plainly what is missing. `reason` names
 *   the endpoint, because the person reading this is usually the person who can
 *   commission it.
 */
export function UnavailablePanel({
  title,
  subtitle,
  reason,
  icon,
  className,
}: {
  title: string;
  subtitle?: string;
  reason: string;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={className}
      header={
        <div>
          <h2 className="text-sm font-semibold text-heading">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          {icon}
        </span>
        <p className="text-sm font-medium text-foreground">Not yet available</p>
        <p className="max-w-xs text-xs leading-5 text-muted-foreground">{reason}</p>
      </div>
    </Card>
  );
}

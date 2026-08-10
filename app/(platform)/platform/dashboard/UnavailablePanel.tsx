import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { UnavailableState } from "@/components/shared/UnavailableState";

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
      {/* Delegates to the shared third state so every "not built yet" panel in
          the product reads identically — see UnavailableState for why this is a
          distinct state rather than an empty one. */}
      <UnavailableState title="Not yet available" description={reason} icon={icon} />
    </Card>
  );
}

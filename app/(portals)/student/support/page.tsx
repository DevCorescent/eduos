import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "Support" };

/**
 * PRD §57 "Support" — raising a ticket, tracking it, and the knowledge base.
 *
 * §38 is NOT_STARTED: no ticket model, no SLA, no assignment or escalation.
 * §35.1 grievances are a separate, also-unbuilt workflow — a grievance is not
 * a support ticket, and merging them here would prejudge that design.
 */
export default function StudentSupportPage() {
  return (
    <StubPage
      title="Support"
      subtitle="Raise a request, track its progress and search the knowledge base."
      prdSection="§38 Helpdesk and Support"
    />
  );
}

import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "Events" };

/**
 * PRD §57 "Events" — campus events, registration, QR check-in and the clubs
 * and societies a student belongs to.
 *
 * §34 is NOT_STARTED: no event model, no registration, no ticketing. Note that
 * Announcements (§33, Phase 27) IS built and lives at /notifications — an
 * announcement about an event is not the same thing as the event.
 */
export default function StudentEventsPage() {
  return (
    <StubPage
      title="Events"
      subtitle="Campus events, registrations, clubs and societies."
      prdSection="§34 Events, Clubs and Campus Engagement"
    />
  );
}

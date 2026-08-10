import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "Placements" };

/**
 * PRD §57 "Placements" — the student's employability profile, open drives,
 * applications and offers.
 *
 * §29 is NOT_STARTED: no company model, no job posting, no application. PRD
 * Phase 9.
 */
export default function StudentPlacementsPage() {
  return (
    <StubPage
      title="Placements"
      subtitle="Open drives, your applications, interviews and offers."
      prdSection="§29 Placement and Career Services"
    />
  );
}

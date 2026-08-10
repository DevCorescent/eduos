import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "Library" };

/**
 * PRD §57 "Library" — the student's own borrowing: issued books, due dates,
 * renewals, reservations and fines.
 *
 * §26 is NOT_STARTED in full: no catalogue model, no member model, no issue or
 * return. PRD Phase 8 (Campus Operations).
 */
export default function StudentLibraryPage() {
  return (
    <StubPage
      title="Library"
      subtitle="Books you have issued, due dates, renewals and reservations."
      prdSection="§26 Library Management"
    />
  );
}

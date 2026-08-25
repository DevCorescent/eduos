import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "Examinations" };

/**
 * PRD §57 "Examinations" — registration, eligibility, hall tickets and the
 * examination timetable.
 *
 * NOT the same thing as Results, which is built and lives at /student/results.
 * The `Examination` and `ExamResult` models exist and the university portal
 * schedules against them; what is missing is §17.2 — student eligibility,
 * examination registration, hall-ticket generation and seat allocation. None
 * of those has a model, so there is nothing for a student to see here yet.
 */
export default function StudentExaminationsPage() {
  return (
    <StubPage
      title="Examinations"
      subtitle="Registration, eligibility, hall tickets and your examination timetable."
      prdSection="§17.2 Examination Configuration"
    />
  );
}

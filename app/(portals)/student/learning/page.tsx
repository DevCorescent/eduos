import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "Learning" };

/**
 * PRD §57 "Learning" — the LMS surface: course content, video lessons, live
 * classes and progress.
 *
 * §14 in full is NOT_STARTED: no course-builder model, no content model, no
 * enrolment-to-content link. This is the largest single unbuilt module in the
 * product (PRD Phase 4, 10–12 weeks).
 */
export default function StudentLearningPage() {
  return (
    <StubPage
      title="Learning"
      subtitle="Course content, lessons, live classes and your progress through them."
      prdSection="§14 Advanced Learning Management System"
    />
  );
}

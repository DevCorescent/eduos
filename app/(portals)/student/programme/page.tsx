import type { Metadata } from "next";
import { StubPage } from "../_components";

export const metadata: Metadata = { title: "My Programme" };

/**
 * PRD §57 "My Programme" — the curriculum the student is enrolled on.
 *
 * The models exist (Programme, Curriculum, CurriculumSubject) and the
 * university portal reads them, but there is no self-scoped endpoint that
 * answers "my programme structure" for a signed-in student. Building this page
 * against the admin routes is what the dashboard used to do, and those routes
 * are requireRole("UNIVERSITY_ADMIN") — a student receives 403 and the screen
 * renders empty while appearing to work.
 */
export default function StudentProgrammePage() {
  return (
    <StubPage
      title="My Programme"
      subtitle="Your curriculum, semester structure and credit requirements."
      prdSection="§11.2 Curriculum Management"
    />
  );
}

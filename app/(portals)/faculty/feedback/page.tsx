import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { FeedbackSummary } from "@/components/feedback/FeedbackSummary";
import { getCurrentFaculty } from "@/services/portal";
import { getPortalSession } from "@/services/session";
import { getFacultyFeedback } from "@/services/feedback";

export const metadata: Metadata = { title: "My Feedback" };

/**
 * The lecturer's own teaching feedback.
 *
 * GET /api/feedback/faculty/[facultyId] permits a lecturer to read their own
 * record, so the summary itself is reachable — but only once the FacultyMember
 * id is known, and resolving a User to a FacultyMember has no self-scoped
 * endpoint. getCurrentFaculty() explains that gap; here it means the page
 * cannot identify the reader and says so, rather than showing somebody else's
 * scores or an empty state that reads as "no feedback".
 */
export default async function FacultyFeedbackPage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const faculty = await getCurrentFaculty();

  const header = (
    <PageHeader
      title="My Feedback"
      subtitle="What students said about your teaching, aggregated and anonymised."
    />
  );

  if (!faculty) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't identify your faculty record"
          description="Your account is signed in, but the record linking it to a faculty member could not be read. Ask an administrator to confirm your faculty profile is linked to this login."
        />
      </>
    );
  }

  const result = await getFacultyFeedback(faculty.id);

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load your feedback" description={result.error} />
      </>
    );
  }

  return (
    <>
      {header}
      <FeedbackSummary summary={result.data} />
    </>
  );
}

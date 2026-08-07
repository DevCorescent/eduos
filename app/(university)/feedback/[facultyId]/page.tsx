import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { FeedbackSummary } from "@/components/feedback/FeedbackSummary";
import { getFacultyFeedback } from "@/services/feedback";
import { getFaculty } from "@/services/faculty";

export const metadata: Metadata = { title: "Faculty Feedback" };

/** params is a Promise in Next.js 16 — await before destructuring. */
type Params = Promise<{ facultyId: string }>;

/**
 * One lecturer's feedback summary.
 *
 * The name is fetched separately and treated as optional: GET /api/faculty/[id]
 * is requireRole("UNIVERSITY_ADMIN"), so a head of department permitted to read
 * this report may not be permitted to read the person's record. The summary is
 * the point of the page and renders either way; only the heading falls back to
 * the id.
 */
export default async function FacultyFeedbackPage({ params }: { params: Params }) {
  const { facultyId } = await params;

  const [summaryResult, facultyResult] = await Promise.all([
    getFacultyFeedback(facultyId),
    getFaculty(facultyId),
  ]);

  const name = facultyResult.success
    ? facultyResult.data.fullName || facultyResult.data.employeeId
    : facultyId;

  const header = (
    <>
      <Link
        href="/feedback"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the report
      </Link>
      <PageHeader title={name} subtitle="Teaching feedback for this faculty member." />
    </>
  );

  if (!summaryResult.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load the summary" description={summaryResult.error} />
      </>
    );
  }

  return (
    <>
      {header}
      <FeedbackSummary summary={summaryResult.data} />
    </>
  );
}

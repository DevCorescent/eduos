import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { TranscriptViewer } from "@/components/evaluation/TranscriptViewer";
import { getCurrentStudent } from "@/services/portal";
import { getTranscript } from "@/services/evaluation";

export const metadata: Metadata = { title: "My Transcript" };

/**
 * The student's own transcript.
 *
 * Reads GET /api/results/transcript/[studentId], which is guarded by
 * requireResultAccess and therefore permits a student their own record — NOT
 * /api/students/[id]/transcript, which is requireRole("UNIVERSITY_ADMIN") and
 * answers a student with 403. The two paths return the same document to
 * different audiences; only this one is reachable from the portal.
 */
export default async function StudentTranscriptPage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const result = await getTranscript(student.id);

  const header = (
    <PageHeader
      title="My Transcript"
      subtitle="Every semester on record, with credits earned and grades awarded."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="transcripts"
          message={result.error}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <TranscriptViewer transcript={result.data} />
    </>
  );
}

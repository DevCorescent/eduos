import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { TranscriptViewer } from "@/components/evaluation/TranscriptViewer";
import { getTranscript } from "@/services/evaluation";
import { listStudents } from "@/services/students";

export const metadata: Metadata = { title: "Transcript" };

type SearchParams = Promise<{ studentId?: string }>;

/**
 * A student's transcript, chosen from the register.
 *
 * The picker is a plain student list rather than a search box because
 * GET /api/students implements no ?q — listStudentsQuerySchema is pagination
 * and nothing else. A search input that filtered nothing would be worse than a
 * list that plainly shows its bounds.
 */
export default async function TranscriptPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { studentId } = await searchParams;

  const studentsResult = await listStudents({ page: 1, limit: 100 });
  const students = studentsResult.success ? studentsResult.data.items : [];

  const header = (
    <PageHeader
      title="Transcript"
      subtitle="A student's full academic record, semester by semester."
    />
  );

  const toolbar = (
    <ListToolbar
      filters={
        <ListFilter
          paramKey="studentId"
          label="Student"
          hideLabel
          allLabel="Select a student"
          options={students.map((student) => ({
            value: student.id,
            // The list endpoint returns no name, so the enrollment number is
            // the only identifier available here — and the one a registrar
            // actually searches by.
            label: student.enrollmentNo,
          }))}
        />
      }
    />
  );

  if (!studentId) {
    return (
      <>
        {header}
        {toolbar}
        <Card>
          <EmptyState
            icon={<ScrollText />}
            title="Choose a student"
            description="Pick a student above to see their transcript."
          />
        </Card>
      </>
    );
  }

  const result = await getTranscript(studentId);

  if (!result.success) {
    return (
      <>
        {header}
        {toolbar}
        <ErrorState title="Couldn't load the transcript" description={result.error} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Transcript"
        subtitle={`Enrollment ${result.data.enrollmentNo}`}
      />
      {toolbar}
      <TranscriptViewer transcript={result.data} />
    </>
  );
}

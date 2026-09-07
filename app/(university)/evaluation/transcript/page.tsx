import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { TranscriptViewer } from "@/components/evaluation/TranscriptViewer";
import { getTranscript, listResultStudents } from "@/services/evaluation";

export const metadata: Metadata = { title: "Transcript" };

type SearchParams = Promise<{ studentId?: string }>;

/**
 * A student's transcript, chosen from the students this caller may read.
 *
 * THE PICKER NO LONGER READS THE STUDENT REGISTRY — tester issue #48.
 *   It filled itself from GET /api/students, which is STUDENT_READ_ROLES:
 *   [UNIVERSITY_ADMIN, DEPARTMENT_HOD]. The Controller of Examination is
 *   deliberately absent from that set — a test asserts it — so this screen
 *   showed a head a full list and the examination office an empty one, while
 *   the transcript BELOW it was readable by both. The office held the
 *   permission to read the document and no permitted way to name its subject.
 *
 *   listResultStudents reads /api/results/students instead, gated on
 *   requireResultAccess — the same authority this page's own transcript call
 *   uses. The list therefore cannot offer a student whose transcript would then
 *   be refused, and a head is still narrowed to their own department by the
 *   same rule as before.
 *
 * It stays a plain list rather than a search box: the endpoint takes no
 * parameters at all, which is what makes it impossible for client input to
 * widen the predicate.
 */
export default async function TranscriptPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { studentId } = await searchParams;

  const studentsResult = await listResultStudents();
  const students = studentsResult.success ? studentsResult.data : [];

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
            // Name AND enrolment number. The registry listing returned no name,
            // so this picker could only ever show the number; /api/results/
            // students joins the User, which is what tester issue #48 asked for
            // — "students along with their Enrollment Numbers".
            label: `${student.name} — ${student.enrollmentNo}`,
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
      <PageHeader
        title="Transcript"
        subtitle={`Enrollment ${result.data.enrollmentNo}`}
      />
      {toolbar}
      <TranscriptViewer transcript={result.data} />
    </>
  );
}

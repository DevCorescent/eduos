import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getAssignment, listSubmissions } from "@/services/assignments";
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_VARIANTS,
  ASSIGNMENT_TYPE_LABELS,
} from "@/constants/labels";
import { formatDate, formatNumber } from "@/utils/format";
import { GradingList } from "./GradingList";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getAssignment(id);
  return { title: result.success ? result.data.title : "Assignment" };
}

export default async function AssignmentGradingPage({ params }: { params: Params }) {
  const { id } = await params;

  const [assignmentResult, submissionsResult] = await Promise.all([
    getAssignment(id),
    listSubmissions(id),
  ]);

  if (!assignmentResult.success) {
    if (assignmentResult.code === "NOT_FOUND") notFound();
    throw new Error(assignmentResult.error);
  }

  const assignment = assignmentResult.data;
  const submissions = submissionsResult.success ? submissionsResult.data : [];

  const graded = submissions.filter((s) => s.status === "GRADED");
  const pending = submissions.length - graded.length;

  // Averaged over marked work only. Including ungraded submissions as zero
  // would drag the class average down by however much is still in the queue.
  const average =
    graded.length === 0
      ? 0
      : graded.reduce((sum, s) => sum + (s.marks ?? 0), 0) / graded.length;

  return (
    <>
      <Link
        href="/faculty/assignments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to assignments
      </Link>

      <PageHeader
        title={assignment.title}
        subtitle={`${assignment.courseCode} · ${assignment.courseName}`}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{ASSIGNMENT_TYPE_LABELS[assignment.type]}</Badge>
            <StatusBadge
              label={ASSIGNMENT_STATUS_LABELS[assignment.status]}
              variant={ASSIGNMENT_STATUS_VARIANTS[assignment.status]}
              size="md"
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Submissions" value={formatNumber(submissions.length)} />
        <StatCard
          label="To Grade"
          value={formatNumber(pending)}
          caption={pending > 0 ? "Waiting" : "All marked"}
        />
        <StatCard
          label="Class Average"
          value={
            graded.length > 0
              ? `${average.toFixed(1)} / ${assignment.maxMarks}`
              : "—"
          }
          caption={graded.length > 0 ? `${graded.length} marked` : "Nothing marked yet"}
        />
        <StatCard label="Due" value={formatDate(assignment.dueDate)} />
      </div>

      {assignment.description && (
        <Card className="mt-6" header={<h2 className="text-sm font-semibold text-heading">Brief</h2>}>
          <p className="text-sm text-foreground">{assignment.description}</p>
        </Card>
      )}

      <div className="mt-6">
        {!submissionsResult.success ? (
          <ErrorState
            title="Couldn't load submissions"
            description={submissionsResult.error}
          />
        ) : (
          <GradingList
            submissions={submissions.map((submission) => ({
              id: submission.id,
              studentName: submission.studentName,
              enrollmentNo: submission.enrollmentNo,
              status: submission.status,
              marks: submission.marks,
              feedback: submission.feedback,
              submittedAt: submission.submittedAt,
            }))}
            maxMarks={assignment.maxMarks}
          />
        )}
      </div>
    </>
  );
}

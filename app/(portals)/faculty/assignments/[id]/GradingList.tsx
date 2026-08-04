"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/providers/ToastProvider";
import { gradeSubmissionAction } from "@/actions/grading";
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_VARIANTS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { SubmissionStatus } from "@/types";

interface SubmissionItem {
  id: string;
  studentName: string;
  enrollmentNo: string;
  status: SubmissionStatus;
  marks: number | null;
  feedback: string | null;
  submittedAt: string | null;
}

export interface GradingListProps {
  submissions: SubmissionItem[];
  maxMarks: number;
}

/**
 * The grading queue.
 *
 * Marks are entered and saved per row rather than as one bulk submit. Grading
 * is genuinely incremental — a lecturer marks a few, stops, comes back — and a
 * single submit at the end would lose everything entered if the page were
 * closed midway. This is the opposite trade-off from the attendance register,
 * which is one sitting and one act.
 *
 * `pendingId` tracks the specific row being saved so only that row shows a
 * pending state; a single shared flag would freeze the whole list for one save.
 */
export function GradingList({ submissions, maxMarks }: GradingListProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [drafts, setDrafts] = useState<Record<string, { marks: string; feedback: string }>>(
    () =>
      Object.fromEntries(
        submissions.map((submission) => [
          submission.id,
          {
            marks: submission.marks !== null ? String(submission.marks) : "",
            feedback: submission.feedback ?? "",
          },
        ])
      )
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  function setDraft(id: string, patch: Partial<{ marks: string; feedback: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSave(submission: SubmissionItem) {
    const draft = drafts[submission.id]!;
    const marks = Number(draft.marks);

    if (draft.marks.trim() === "" || Number.isNaN(marks)) {
      setErrors((prev) => ({ ...prev, [submission.id]: "Enter a mark." }));
      return;
    }

    setPendingId(submission.id);
    const result = await gradeSubmissionAction(submission.id, marks, draft.feedback);
    setPendingId(null);

    if (!result.success) {
      setErrors((prev) => ({ ...prev, [submission.id]: result.error }));
      return;
    }

    toast({ variant: "success", title: `${submission.studentName} graded` });
    router.refresh();
  }

  if (submissions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileText />}
          title="No submissions yet"
          description="Work handed in by students appears here for marking."
        />
      </Card>
    );
  }

  return (
    <Card
      noPadding
      header={
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-heading">Submissions</h2>
          <span className="text-xs text-muted-foreground">Out of {maxMarks}</span>
        </div>
      }
    >
      <ul className="divide-y divide-border">
        {submissions.map((submission) => {
          const draft = drafts[submission.id]!;
          const error = errors[submission.id];
          const isGraded = submission.status === "GRADED";

          return (
            <li key={submission.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={submission.studentName} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {submission.studentName}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {submission.enrollmentNo}
                      {submission.submittedAt
                        ? ` · ${formatDate(submission.submittedAt)}`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge
                    label={SUBMISSION_STATUS_LABELS[submission.status]}
                    variant={SUBMISSION_STATUS_VARIANTS[submission.status]}
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-start lg:shrink-0">
                  <Input
                    aria-label={`Marks for ${submission.studentName}`}
                    type="number"
                    min={0}
                    max={maxMarks}
                    value={draft.marks}
                    onChange={(e) => setDraft(submission.id, { marks: e.target.value })}
                    error={error}
                    placeholder={`0–${maxMarks}`}
                    containerClassName="w-full sm:w-28"
                  />

                  <Input
                    aria-label={`Feedback for ${submission.studentName}`}
                    value={draft.feedback}
                    onChange={(e) => setDraft(submission.id, { feedback: e.target.value })}
                    placeholder="Feedback (optional)"
                    containerClassName="w-full sm:w-64"
                  />

                  <Button
                    size="md"
                    variant={isGraded ? "secondary" : "primary"}
                    onClick={() => handleSave(submission)}
                    isLoading={pendingId === submission.id}
                    leftIcon={<Check className="size-4" />}
                  >
                    {isGraded ? "Update" : "Save"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

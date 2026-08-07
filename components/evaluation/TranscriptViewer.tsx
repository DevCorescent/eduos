// ============================================================================
// MODULE : Components — Transcript Viewer
// PURPOSE: Render a transcript, semester by semester, for whoever is entitled
//          to see it — a registrar on the university side and the student on
//          their own.
//
//          Shared rather than written twice because the document is the same
//          document. Two implementations would be two chances for a printed
//          transcript to disagree with the one the student was shown.
//
// PROVISIONAL IS STATED, NEVER IMPLIED
//   `isProvisional` is true while anything is outstanding, and a transcript
//   with anything outstanding is not a final transcript. It is banner-level
//   information: somebody may be about to rely on this document.
// ============================================================================

import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import type { TranscriptCourseDTO, TranscriptDTO } from "@/lib/dto/result.dto";
import { formatNumber } from "@/utils/format";

/** PASS is unremarkable; anything else is what the reader is looking for. */
function outcomeVariant(outcome: TranscriptCourseDTO["outcome"]) {
  if (outcome === "PASS") return "success" as const;
  if (outcome === "FAIL") return "danger" as const;
  return "neutral" as const;
}

export function TranscriptViewer({ transcript }: { transcript: TranscriptDTO }) {
  const { degreeSummary, standing } = transcript;

  const columns: TableColumn<TranscriptCourseDTO>[] = [
    {
      key: "courseCode",
      header: "Course",
      render: (course) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{course.courseName}</p>
          <p className="truncate text-xs text-muted-foreground">{course.courseCode}</p>
        </div>
      ),
    },
    {
      key: "credits",
      header: "Credits",
      align: "right",
      render: (course) => course.credits,
    },
    {
      key: "grade",
      header: "Grade",
      align: "right",
      render: (course) => (
        <span className="font-medium text-foreground">{course.grade ?? "—"}</span>
      ),
    },
    {
      key: "gradePoint",
      header: "Points",
      align: "right",
      render: (course) => course.gradePoint ?? "—",
    },
    {
      key: "attemptNumber",
      header: "Attempt",
      align: "right",
      // A repeat is part of the record, not a footnote — it is shown for every
      // course rather than only when it exceeds one.
      render: (course) => course.attemptNumber,
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (course) => (
        <Badge variant={outcomeVariant(course.outcome)} size="sm">
          {course.outcome}
        </Badge>
      ),
    },
  ];

  return (
    <>
      {transcript.isProvisional && (
        <Alert variant="warning" className="mb-6">
          This transcript is provisional. Some results are still outstanding, so it should
          not be relied on as a final record.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="CGPA" value={degreeSummary.cgpa ?? "—"} />
        <StatCard
          label="Credits earned"
          value={degreeSummary.creditsEarned}
          caption={`of ${degreeSummary.creditsRegistered} registered`}
        />
        <StatCard
          label="Semesters completed"
          value={formatNumber(degreeSummary.semestersCompleted)}
        />
        <StatCard
          label="Backlogs"
          value={formatNumber(standing.backlogCount)}
          caption={standing.isClear ? "All clear" : "Outstanding"}
        />
      </div>

      {degreeSummary.classification && (
        <p className="mt-4 text-sm text-muted-foreground">
          Classification: <span className="text-foreground">{degreeSummary.classification}</span>
        </p>
      )}

      {transcript.lines.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            icon={<ScrollText />}
            title="Nothing on record"
            description="No semester result has been computed for this student yet."
          />
        </Card>
      ) : (
        <div className="mt-6 space-y-6">
          {transcript.lines.map((line) => (
            <Card
              key={line.semesterId}
              header={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-heading">{line.semesterName}</h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      SGPA <span className="text-foreground">{line.sgpa ?? "—"}</span>
                    </span>
                    <span>
                      CGPA <span className="text-foreground">{line.cgpa ?? "—"}</span>
                    </span>
                    <span>
                      Credits{" "}
                      <span className="text-foreground">
                        {line.creditsEarned}/{line.creditsRegistered}
                      </span>
                    </span>
                    {line.backlogCount > 0 && (
                      <Badge variant="danger" size="sm">
                        {line.backlogCount} backlog{line.backlogCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                </div>
              }
              noPadding
            >
              <Table
                columns={columns}
                data={line.courses}
                rowKey={(course) => `${line.semesterId}-${course.courseCode}-${course.attemptNumber}`}
                emptyState={
                  <EmptyState
                    icon={<ScrollText />}
                    title="No courses"
                    description="No course is recorded for this semester."
                  />
                }
              />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

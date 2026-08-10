import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getAssessmentEvent, getMarksSheet } from "@/services/evaluation";
import { courseIndex, semesterIndex } from "@/services/reference";
import type { StudentComponentScoreDTO } from "@/lib/dto/studentComponentScore.dto";
import { formatDate, formatNumber } from "@/utils/format";

export const metadata: Metadata = { title: "Assessment Event" };

/** params is a Promise in Next.js 16 — await before destructuring. */
type Params = Promise<{ id: string }>;

/**
 * One sitting, and the marks recorded against it.
 *
 * The sheet is shown whole and unpaginated because that is what the endpoint
 * returns, and for its stated reason: an examiner reconciling entries against a
 * register needs every row at once, and a page of a marks sheet invites the
 * transcription error the reconciliation exists to catch.
 *
 * Rows are identified by courseRegistrationId, not by student name. No endpoint
 * maps a registration to a student that this page may call for a whole cohort,
 * and inventing a name would be worse than showing the identifier the examiner
 * uploaded against.
 */
export default async function AssessmentEventPage({ params }: { params: Params }) {
  const { id } = await params;

  const [eventResult, sheetResult, courses, semesters] = await Promise.all([
    getAssessmentEvent(id),
    getMarksSheet(id),
    courseIndex(),
    semesterIndex(),
  ]);

  const back = (
    <Link
      href="/evaluation/assessment-events"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to assessment events
    </Link>
  );

  if (!eventResult.success) {
    return (
      <>
        {back}
        <StateView
          state={resolveFailureState(eventResult)}
          subject="the sitting"
          message={eventResult.error}
        />
      </>
    );
  }

  const event = eventResult.data;
  const course = courses.get(event.courseId);
  const semester = semesters.get(event.semesterId);

  const columns: TableColumn<StudentComponentScoreDTO>[] = [
    {
      key: "courseRegistrationId",
      header: "Registration",
      render: (entry) => (
        <span className="font-mono text-xs text-foreground">
          {entry.courseRegistrationId}
        </span>
      ),
    },
    {
      key: "marksObtained",
      header: "Marks",
      align: "right",
      render: (entry) => (
        <span className="font-medium text-foreground">
          {/* Null means ABSENT, which the status column states. Rendering it as
              0 would record a score the student did not receive. */}
          {entry.marksObtained ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (entry) => (
        <Badge
          variant={
            entry.status === "ABSENT"
              ? "warning"
              : entry.status === "WITHHELD"
                ? "danger"
                : "neutral"
          }
          size="sm"
        >
          {entry.status}
        </Badge>
      ),
    },
    {
      key: "remarks",
      header: "Remarks",
      render: (entry) => (
        <span className="text-sm text-muted-foreground">{entry.remarks ?? "—"}</span>
      ),
    },
  ];

  return (
    <>
      {back}
      <PageHeader
        title={event.title}
        subtitle={`${course?.code ?? event.courseId} · ${semester?.name ?? "Unknown semester"} · attempt ${event.sequenceNumber}`}
        action={
          <Badge variant={event.isPublished ? "success" : "neutral"}>{event.status}</Badge>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Out of" value={event.maxMarks} />
        <StatCard
          label="Recorded"
          value={sheetResult.success ? formatNumber(sheetResult.data.recordedCount) : "—"}
        />
        <StatCard
          label="Absent"
          value={sheetResult.success ? formatNumber(sheetResult.data.absentCount) : "—"}
        />
        <StatCard
          label="Withheld"
          value={sheetResult.success ? formatNumber(sheetResult.data.withheldCount) : "—"}
        />
      </div>

      <div className="mt-6">
        {event.scheduledAt && (
          <p className="mb-4 text-sm text-muted-foreground">
            Scheduled for {formatDate(event.scheduledAt)}.
          </p>
        )}

        {event.acceptsMarks ? (
          <Alert variant="info" className="mb-4">
            This sitting is accepting marks. Uploads are made through the internal or
            external marks endpoints.
          </Alert>
        ) : (
          <Alert variant="warning" className="mb-4">
            This sitting is not accepting marks. Its entries are shown as recorded.
          </Alert>
        )}

        <Card
          header={<h2 className="text-sm font-semibold text-heading">Marks sheet</h2>}
          noPadding
        >
          {!sheetResult.success ? (
            <div className="px-5 py-6">
              <StateView
          state={resolveFailureState(sheetResult)}
          subject="the marks sheet"
          message={sheetResult.error}
        />
            </div>
          ) : (
            <Table
              columns={columns}
              data={sheetResult.data.entries}
              rowKey={(entry) => entry.id}
              emptyState={
                <EmptyState
                  icon={<FileSpreadsheet />}
                  title="No marks recorded"
                  description="Nothing has been entered against this sitting yet."
                />
              }
            />
          )}
        </Card>
      </div>
    </>
  );
}

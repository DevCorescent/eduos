import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import {
  getExamination,
  getExaminationEligibility,
  type EligibilityRowDTO,
} from "@/services/examinations";
import { EXAMINATION_TYPE_LABELS, EXAM_STATUS_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { ExamStatus } from "@/types";
import { IssueHallTicketsButton } from "./IssueHallTicketsButton";
import { AllocateSeatsButton } from "./AllocateSeatsButton";

export const metadata: Metadata = { title: "Examination" };

type Params = Promise<{ id: string }>;

/** Why a student may not sit, in words. Mirrors INELIGIBILITY_REASON. */
const REASON_LABELS: Record<string, string> = {
  NOT_REGISTERED: "Not registered for this course",
  REGISTRATION_NOT_ACTIVE: "Enrolment withdrawn or cancelled",
  ATTENDANCE_SHORTAGE: "Attendance below the required minimum",
};

/**
 * One examination: its details, its cohort's eligibility, and hall tickets.
 *
 * PRD §17.2 — "Student eligibility" and "Hall-ticket generation".
 *
 * THE COHORT COMES FROM COURSE REGISTRATION
 *   There is no separate examination registration. The students shown are those
 *   enrolled in this examination's course for its semester, which is what makes
 *   the eligibility roll a view of data that already existed rather than a
 *   parallel record somebody has to maintain.
 *
 * ELIGIBILITY IS RECOMPUTED, NOT READ FROM A COLUMN
 *   Every row is derived from the enrolment status and the attendance register
 *   on each request, so this screen cannot show a verdict that has gone stale
 *   against the register it came from.
 *
 * THE BUTTON IS NOT THE GATE
 *   Issuing sends only this examination's id. The server recomputes eligibility
 *   and issues to the students it judges eligible, so no state on this page can
 *   put a ticket in an ineligible student's hands.
 */
export default async function ExaminationDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [examResult, eligibilityResult] = await Promise.all([
    getExamination(id),
    getExaminationEligibility(id),
  ]);

  if (!examResult.success && examResult.code === "NOT_FOUND") notFound();

  if (!examResult.success) {
    return (
      <>
        <PageHeader title="Examination" />
        <StateView
          state={resolveFailureState(examResult)}
          subject="this examination"
          message={examResult.error}
        />
      </>
    );
  }

  const exam = examResult.data;

  const header = (
    <PageHeader
      title={exam.title}
      subtitle={`${exam.courseCode} · ${exam.semesterName} · ${
        EXAMINATION_TYPE_LABELS[exam.type] ?? exam.type
      }`}
    />
  );

  const details = (
    <Card className="mb-4" header={<h2 className="text-sm font-semibold text-heading">Details</h2>}>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        {[
          { label: "Date", value: exam.date ? formatDate(exam.date) : "Not scheduled" },
          {
            label: "Time",
            value:
              exam.startTime && exam.endTime
                ? `${exam.startTime} – ${exam.endTime}`
                : "—",
          },
          { label: "Venue", value: exam.venue ?? "—" },
          { label: "Maximum marks", value: String(exam.maxMarks) },
          { label: "Pass mark", value: exam.passMark === null ? "—" : String(exam.passMark) },
          { label: "Duration", value: exam.duration ? `${exam.duration} minutes` : "—" },
        ].map((field) => (
          <div key={field.label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {field.label}
            </dt>
            <dd className="mt-1 text-sm text-heading">{field.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-border pt-4">
        <Badge variant={exam.status === "COMPLETED" ? "success" : "neutral"}>
          {EXAM_STATUS_LABELS[exam.status as ExamStatus] ?? exam.status}
        </Badge>
      </div>
    </Card>
  );

  // The eligibility roll is examination-office only, so a caller who may read
  // the examination but not the roll gets the details and an explanation rather
  // than a blank half-page.
  if (!eligibilityResult.success) {
    return (
      <>
        {header}
        {details}
        <StateView
          state={resolveFailureState(eligibilityResult)}
          subject="the eligibility roll"
          message={eligibilityResult.error}
        />
      </>
    );
  }

  const { rows, summary } = eligibilityResult.data;

  const columns: TableColumn<EligibilityRowDTO>[] = [
    {
      key: "student",
      header: "Student",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-heading">{row.studentName}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {row.enrollmentNo}
          </p>
        </div>
      ),
    },
    { key: "registrationStatus", header: "Enrolment", render: (row) => row.registrationStatus },
    {
      key: "attendance",
      header: "Attendance",
      render: (row) => (
        <span className={row.decision.attendancePercentage < 75 ? "text-danger" : undefined}>
          {row.decision.attendancePercentage}%
          <span className="ml-1 text-xs text-muted-foreground">
            ({row.sessionsAttended}/{row.sessionsHeld})
          </span>
        </span>
      ),
    },
    {
      key: "eligibility",
      header: "Eligibility",
      render: (row) =>
        row.decision.eligible ? (
          <Badge variant="success">Eligible</Badge>
        ) : (
          <div>
            <Badge variant="danger">Not eligible</Badge>
            <p className="mt-1 text-xs text-muted-foreground">
              {REASON_LABELS[row.decision.reason] ?? row.decision.reason}
            </p>
          </div>
        ),
    },
    {
      key: "ticketNo",
      header: "Hall ticket",
      render: (row) =>
        row.ticketNo ? (
          <span className="font-mono text-xs">{row.ticketNo}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Not issued</span>
        ),
    },
    {
      key: "seatNo",
      header: "Seat",
      render: (row) =>
        row.seatNo ? (
          <span className="font-mono text-xs">{row.seatNo}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      {header}
      {details}

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <StatCard label="Cohort" value={String(summary.total)} />
        <StatCard label="Eligible" value={String(summary.eligible)} />
        <StatCard label="Not eligible" value={String(summary.ineligible)} />
        <StatCard label="Tickets issued" value={String(summary.ticketsIssued)} />
        <StatCard label="Seats allocated" value={String(summary.seated)} />
      </div>

      <Card
        className="mb-4"
        header={<h2 className="text-sm font-semibold text-heading">Hall tickets</h2>}
      >
        <div className="space-y-4">
          <IssueHallTicketsButton
            examinationId={exam.id}
            eligibleCount={summary.eligible}
            issuedCount={summary.ticketsIssued}
          />
          <div className="border-t border-border pt-4">
            <AllocateSeatsButton
              examinationId={exam.id}
              issuedCount={summary.ticketsIssued}
              seatedCount={summary.seated}
            />
          </div>
        </div>
      </Card>

      <Card
        header={
          <h2 className="text-sm font-semibold text-heading">
            Eligibility roll
          </h2>
        }
        noPadding
      >
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.studentId}
          emptyState={
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No students enrolled"
              description="Nobody is registered for this examination's course in this semester, so there is no cohort to assess."
            />
          }
        />
      </Card>
    </>
  );
}

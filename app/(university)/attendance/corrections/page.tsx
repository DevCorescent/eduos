import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listAttendanceCorrections, type AttendanceCorrectionRow } from "@/services/academics";
import { getPortalSession } from "@/services/session";
import { hasAnyRole, homeRouteForRoles } from "@/constants/roles";
import {
  ATTENDANCE_CORRECTION_READ_ROLES,
  ATTENDANCE_CORRECTION_REVIEW_ROLES,
} from "@/lib/constants/attendanceCorrection";
import { formatDate } from "@/utils/format";
import { CorrectionReviewPanel } from "./CorrectionReviewPanel";

export const metadata: Metadata = { title: "Attendance Corrections" };

type SearchParams = Promise<{ status?: string }>;

/**
 * The attendance correction queue — PRD §13.2 "Attendance correction requests",
 * "Faculty approval", "Academic admin approval".
 *
 * WHY A REQUEST QUEUE AND NOT AN EDIT SCREEN
 *   Attendance has no PATCH handler and no updatedAt column: markedAt and
 *   markedBy describe the ORIGINAL mark, so editing in place would silently
 *   rewrite who recorded what and when — the provenance an attendance dispute
 *   turns on. A request records the change as its own fact instead.
 *
 * THE BUTTONS ARE NOT THE GATE
 *   `canReview` decides what this page RENDERS. The API applies
 *   ATTENDANCE_CORRECTION_REVIEW_ROLES and refuses self-review regardless of
 *   what was rendered, so a lecturer calling the endpoint directly is refused
 *   just the same.
 */
export default async function AttendanceCorrectionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status } = await searchParams;

  const session = await getPortalSession();
  if (!session) redirect("/login");

  // The (university) layout admits every UNIVERSITY_ROLE, which includes the
  // Controller of Examination — a role this workflow has nothing to do with and
  // that GET /api/attendance/corrections refuses. Without this they reached a
  // fully rendered page whose only content was the API's own refusal: a
  // destination that exists solely to fail. Sent home instead, matching the
  // sidebar, which never offered them the link.
  if (!hasAnyRole(session.roles, ATTENDANCE_CORRECTION_READ_ROLES)) {
    redirect(homeRouteForRoles(session.roles));
  }

  const result = await listAttendanceCorrections(status);

  // FACULTY may raise a correction but not decide one, the same line the lock
  // module draws at unlock. Read from the shared constant rather than respelled
  // here, so the screen cannot drift from what the route enforces.
  const canReview = hasAnyRole(session.roles, ATTENDANCE_CORRECTION_REVIEW_ROLES);

  const header = (
    <PageHeader
      title="Attendance Corrections"
      subtitle="Requested changes to the register, and their decisions."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="attendance corrections"
          message={result.error}
        />
      </>
    );
  }

  const rows = result.data;

  const columns: TableColumn<AttendanceCorrectionRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-heading">
            {row.attendance?.student?.enrollmentNo ?? "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.attendance?.date ? formatDate(row.attendance.date) : "—"}
            {row.attendance?.sessionType ? ` · ${row.attendance.sessionType}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "change",
      header: "Requested change",
      render: (row) => (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="neutral">{row.currentStatus}</Badge>
          <span className="text-muted-foreground">→</span>
          <Badge variant="info">{row.requestedStatus}</Badge>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <p className="max-w-xs text-sm text-muted-foreground">{row.reason}</p>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge
          variant={
            row.status === "APPROVED" ? "success" : row.status === "REJECTED" ? "danger" : "warning"
          }
        >
          {row.status}
        </Badge>
      ),
    },
    {
      key: "decision",
      header: "Decision",
      render: (row) => <CorrectionReviewPanel request={row} canReview={canReview} />,
    },
  ];

  const pending = rows.filter((r) => r.status === "PENDING").length;
  const approved = rows.filter((r) => r.status === "APPROVED").length;
  const rejected = rows.filter((r) => r.status === "REJECTED").length;

  return (
    <>
      {header}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting review" value={String(pending)} />
        <StatCard label="Applied" value={String(approved)} />
        <StatCard label="Rejected" value={String(rejected)} />
      </div>

      <ListToolbar
        filters={
          <ListFilter
            paramKey="status"
            label="Status"
            hideLabel
            allLabel="All statuses"
            options={[
              { value: "PENDING", label: "Awaiting review" },
              { value: "APPROVED", label: "Applied" },
              { value: "REJECTED", label: "Rejected" },
            ]}
          />
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<ClipboardCheck className="h-6 w-6" />}
              title="No correction requests"
              description="A request appears here when somebody asks for an attendance mark to be changed."
            />
          }
        />
      </Card>
    </>
  );
}

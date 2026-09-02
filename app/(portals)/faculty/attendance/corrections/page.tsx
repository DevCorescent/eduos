import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import {
  listAttendanceCorrections,
  type AttendanceCorrectionRow,
} from "@/services/academics";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "My Corrections" };

type SearchParams = Promise<{ status?: string }>;

/**
 * A lecturer's own attendance corrections — PRD §13.2.
 *
 * WHY A SEPARATE PAGE FROM THE REVIEW QUEUE
 *   /attendance/corrections lives under the (university) layout, which admits
 *   UNIVERSITY_ROLES only — FACULTY is redirected out of it. Without this page a
 *   lecturer could raise a correction from the register and then never learn
 *   what became of it, which makes the approval step invisible to the one
 *   person waiting on it.
 *
 * IT SHOWS ONLY THEIR OWN, AND NOT BECAUSE OF THIS FILE
 *   GET /api/attendance/corrections narrows the queue to the caller's own
 *   requests unless they hold ATTENDANCE_CORRECTION_REVIEW_ROLES. The scoping
 *   is the route's, so it holds for anything else that calls the endpoint too.
 *
 * THERE ARE NO DECISION CONTROLS HERE, DELIBERATELY
 *   FACULTY is absent from ATTENDANCE_CORRECTION_REVIEW_ROLES and the domain
 *   refuses self-review besides. Rendering buttons that the API would refuse
 *   would only teach the lecturer that the screen lies.
 */
export default async function FacultyCorrectionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status } = await searchParams;
  const result = await listAttendanceCorrections(status);

  const header = (
    <PageHeader
      title="My Corrections"
      subtitle="Attendance changes you have asked for, and what was decided."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="your correction requests"
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
      header: "Outcome",
      render: (row) => (
        <div className="space-y-1">
          <Badge
            variant={
              row.status === "APPROVED"
                ? "success"
                : row.status === "REJECTED"
                  ? "danger"
                  : "warning"
            }
          >
            {row.status === "APPROVED"
              ? "Applied"
              : row.status === "REJECTED"
                ? "Rejected"
                : "Awaiting review"}
          </Badge>
          {/* The reviewer's note is the whole point of a rejection: without it
              the lecturer knows only that they were refused. */}
          {row.reviewNote && (
            <p className="text-xs text-muted-foreground">{row.reviewNote}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {header}

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
              description="Ask for a correction from the register, on the Attendance screen."
            />
          }
        />
      </Card>
    </>
  );
}

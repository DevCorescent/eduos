import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentStudent } from "@/services/portal";
import { listStudentAssignments } from "@/services/assignments";
import {
  ASSIGNMENT_TYPE_LABELS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_VARIANTS,
} from "@/constants/labels";
import { formatDate, formatNumber } from "@/utils/format";
import { cn } from "@/lib/utils";
import type { AssignmentRow } from "@/types";

export const metadata: Metadata = { title: "My Assignments" };

type SearchParams = Promise<{ q?: string; state?: string }>;

export default async function StudentAssignmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, state } = await searchParams;

  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const result = await listStudentAssignments(student.id, { page: 1, limit: 100, q });

  const header = (
    <PageHeader title="My Assignments" subtitle="Work set for your courses." />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load your assignments" description={result.error} />
      </>
    );
  }

  const all = result.data.items;

  // Filtered by *submission* state rather than the assignment's own status —
  // "have I done it" is the question a student actually asks, and that lives on
  // the submission, not on the assignment.
  const rows = all.filter((row) => {
    if (state === "pending") return !row.submission;
    if (state === "submitted")
      return row.submission !== null && row.submission.status !== "GRADED";
    if (state === "graded") return row.submission?.status === "GRADED";
    return true;
  });

  const pending = all.filter((row) => !row.submission).length;
  const graded = all.filter((row) => row.submission?.status === "GRADED").length;

  const columns: TableColumn<AssignmentRow>[] = [
    {
      key: "title",
      header: "Assignment",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.title}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.courseCode}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <Badge variant="neutral" size="sm">
          {ASSIGNMENT_TYPE_LABELS[row.type]}
        </Badge>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => {
        const overdue =
          row.dueDate !== null && Date.parse(row.dueDate) < Date.now() && !row.submission;
        return (
          <span
            className={cn(
              overdue ? "font-medium text-danger" : "text-muted-foreground"
            )}
          >
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      key: "submission",
      header: "Status",
      render: (row) =>
        row.submission ? (
          <StatusBadge
            label={SUBMISSION_STATUS_LABELS[row.submission.status]}
            variant={SUBMISSION_STATUS_VARIANTS[row.submission.status]}
          />
        ) : row.status === "CLOSED" ? (
          <StatusBadge label="Missed" variant="danger" />
        ) : (
          <StatusBadge label="Not submitted" variant="warning" />
        ),
    },
    {
      key: "marks",
      header: "Marks",
      align: "right",
      render: (row) =>
        row.submission?.marks !== null && row.submission?.marks !== undefined ? (
          <span className="font-medium">
            {row.submission.marks}
            <span className="text-muted-foreground"> / {row.maxMarks}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "feedback",
      header: "Feedback",
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.submission?.feedback ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Set" value={formatNumber(all.length)} />
        <StatCard
          label="Not Submitted"
          value={formatNumber(pending)}
          caption={pending > 0 ? "Needs your attention" : "All handed in"}
        />
        <StatCard label="Graded" value={formatNumber(graded)} />
      </div>

      <ListToolbar
        className="mt-6"
        search={<ListSearch placeholder="Search assignments…" />}
        filters={
          <ListFilter
            paramKey="state"
            label="State"
            hideLabel
            allLabel="All"
            options={[
              { value: "pending", label: "Not submitted" },
              { value: "submitted", label: "Awaiting marks" },
              { value: "graded", label: "Graded" },
            ]}
          />
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[48rem]"
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<FileText />}
              title={q || state ? "Nothing matches" : "No assignments yet"}
              description={
                q || state
                  ? "No assignment matches these filters."
                  : "Work set by your lecturers appears here."
              }
            />
          }
        />
      </Card>
    </>
  );
}

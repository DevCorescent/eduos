import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentFaculty } from "@/services/portal";
import {
  listFacultyAssignments,
  type FacultyAssignmentSummary,
} from "@/services/assignments";
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_VARIANTS,
  ASSIGNMENT_TYPE_LABELS,
} from "@/constants/labels";
import { formatDate, formatNumber } from "@/utils/format";

/**
 * Verified against the running API, not inferred: this collection's query
 * schema accepts page and limit only, and drops every other key before the
 * handler sees it — a filtered request returns the same rows as an unfiltered
 * one. The controls stay visible and disabled rather than silently returning
 * everything.
 */
const UNSUPPORTED_SEARCH = "Search will be available when backend support is enabled.";

export const metadata: Metadata = { title: "My Assignments" };

type SearchParams = Promise<{ q?: string }>;

export default async function FacultyAssignmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q } = await searchParams;

  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  // Keyed by user id: Assignment.createdBy is a User id, not a FacultyMember id.
  const result = await listFacultyAssignments(faculty.userId, { page: 1, limit: 100, q });

  const header = (
    <PageHeader
      title="My Assignments"
      subtitle="Work you have set, and what is waiting to be marked."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="assignments"
          message={result.error}
        />
      </>
    );
  }

  const rows = result.data.items;
  const totalPending = rows.reduce((sum, row) => sum + row.pendingCount, 0);
  const totalSubmissions = rows.reduce((sum, row) => sum + row.submissionCount, 0);

  const columns: TableColumn<FacultyAssignmentSummary>[] = [
    {
      key: "title",
      header: "Assignment",
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/faculty/assignments/${row.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {row.title}
          </Link>
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
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={ASSIGNMENT_STATUS_LABELS[row.status]}
          variant={ASSIGNMENT_STATUS_VARIANTS[row.status]}
        />
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => (
        <span className="text-muted-foreground">{formatDate(row.dueDate)}</span>
      ),
    },
    {
      key: "submissionCount",
      header: "Submitted",
      align: "right",
      render: (row) => formatNumber(row.submissionCount),
    },
    {
      key: "pendingCount",
      header: "To grade",
      align: "right",
      render: (row) =>
        row.pendingCount > 0 ? (
          <Badge variant="warning" size="sm">
            {row.pendingCount}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Assignments Set" value={formatNumber(rows.length)} />
        <StatCard label="Submissions" value={formatNumber(totalSubmissions)} />
        <StatCard
          label="Waiting to Grade"
          value={formatNumber(totalPending)}
          caption={totalPending > 0 ? "Across your courses" : "All marked"}
        />
      </div>

      <ListToolbar
        className="mt-6"
        search={<ListSearch
              unsupported={UNSUPPORTED_SEARCH} placeholder="Search assignments…" />}
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
              title={q ? "Nothing matches" : "No assignments set"}
              description={
                q
                  ? "No assignment matches that search."
                  : "Work you set for your courses appears here with its grading queue."
              }
            />
          }
        />
      </Card>
    </>
  );
}

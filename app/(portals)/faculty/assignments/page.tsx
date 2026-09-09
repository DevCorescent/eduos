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
import { EntityCreateButton } from "@/components/shared/EntityCrud";
import {
  SET_ASSIGNMENT_DEFAULTS,
  courseworkTargetOptions,
  setAssignmentFields,
} from "@/components/shared/assignmentFields";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentFaculty } from "@/services/portal";
import { getMyTeaching } from "@/services/academics";
import { createAssignmentAction } from "@/actions/assignments";
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

/*
 * The search box was rendered DISABLED here, because the assignments listing
 * parsed bare pagination and Zod dropped ?q before the handler saw it — tester
 * issue #39. GET /api/assignments now accepts it, so the `unsupported` prop is
 * gone and nothing else on this page changed: it already read ?q from
 * searchParams and already passed it to listAssignments.
 */

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

  // Both are this lecturer's own data and neither depends on the other, so they
  // are issued together rather than in sequence.
  //
  // Keyed by user id: Assignment.createdBy is a User id, not a FacultyMember id.
  const [result, teachingResult] = await Promise.all([
    listFacultyAssignments(faculty.userId, { page: 1, limit: 100, q }),
    getMyTeaching(),
  ]);

  // A failure here is not fatal to the page — the list below still renders. It
  // only means the Set assignment dialog has nothing valid to offer, which is
  // handled by withholding the control rather than by blocking the screen. Same
  // treatment as the Schedule class dialog on My Schedule.
  const teaching = teachingResult.success ? teachingResult.data : [];

  // The classes this lecturer may set work for, drawn from
  // GET /api/faculty/me/teaching — the endpoint that returns precisely the
  // pairs POST /api/assignments accepts. This list is a CONVENIENCE and never
  // the authorization: the route re-runs facultyMaySetCoursework against
  // whatever is actually submitted.
  const targets = courseworkTargetOptions(teaching);
  const canSetWork = targets.length > 0;

  const header = (
    <PageHeader
      title="My Assignments"
      subtitle="Work you have set, and what is waiting to be marked."
      action={
        // Withheld when there is nothing valid to set work against. A button
        // opening a dialog whose only select is empty is a control that cannot
        // be used, and the Alert below says why rather than leaving the
        // lecturer guessing.
        canSetWork ? (
          <EntityCreateButton
            entityLabel="Assignment"
            label="Set assignment"
            fields={setAssignmentFields(targets)}
            initialValues={{ ...SET_ASSIGNMENT_DEFAULTS }}
            action={createAssignmentAction}
            modalSize="lg"
          />
        ) : undefined
      }
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

      {!canSetWork && (
        // The reason the Set assignment button is absent. Without this the
        // screen looks identical to one where the feature does not exist.
        <Alert variant="info" title="No course to set work for" className="mb-6">
          Work is set against a course you are assigned to teach, and your
          account has no teaching assignment or timetabled class yet. Ask your
          department to assign you a course.
        </Alert>
      )}

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
        search={<ListSearch placeholder="Search assignments…" />}
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

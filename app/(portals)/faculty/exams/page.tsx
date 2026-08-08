import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
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
import { getCurrentFaculty } from "@/services/portal";
import { listFacultyExaminations, type ExaminationRow } from "@/services/examinations";
import {
  EXAMINATION_TYPE_LABELS,
  EXAM_STATUS_LABELS,
  EXAM_STATUS_VARIANTS,
} from "@/constants/labels";
import { EXAM_STATUS_VALUES } from "@/types";
import { formatDate, formatNumber } from "@/utils/format";

/**
 * Verified against the running API, not inferred: this collection's query
 * schema accepts page and limit only, and drops every other key before the
 * handler sees it — a filtered request returns the same rows as an unfiltered
 * one. The controls stay visible and disabled rather than silently returning
 * everything.
 */
const UNSUPPORTED_SEARCH = "Search will be available when backend support is enabled.";
const UNSUPPORTED_FILTER = "Filtering will be available when backend support is enabled.";

export const metadata: Metadata = { title: "My Exams" };

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function FacultyExamsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, status } = await searchParams;

  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const result = await listFacultyExaminations(faculty.id, { page: 1, limit: 100, q, status });

  const header = (
    <PageHeader
      title="My Exams"
      subtitle="Papers set for the courses you teach, and their result status."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Examination service is currently unavailable" description={result.error} />
      </>
    );
  }

  const rows = result.data.items;
  const scheduled = rows.filter((row) => row.status === "SCHEDULED").length;
  // Papers sat but whose marks are not fully released — the queue that needs
  // the lecturer's attention.
  const awaitingRelease = rows.filter(
    (row) => row.status === "COMPLETED" && row.publishedCount < row.resultCount
  ).length;

  const columns: TableColumn<ExaminationRow>[] = [
    {
      key: "title",
      header: "Examination",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.title}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.courseCode} · {row.semesterName}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <Badge variant="neutral" size="sm">
          {EXAMINATION_TYPE_LABELS[row.type]}
        </Badge>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (row) => (
        <span className="text-muted-foreground">{formatDate(row.date)}</span>
      ),
    },
    {
      key: "venue",
      header: "Venue",
      render: (row) => (
        <span className="text-muted-foreground">{row.venue ?? "—"}</span>
      ),
    },
    {
      key: "maxMarks",
      header: "Marks",
      align: "right",
      render: (row) => (
        <span>
          {row.maxMarks}
          {row.passMark !== null && (
            <span className="text-muted-foreground"> (pass {row.passMark})</span>
          )}
        </span>
      ),
    },
    {
      key: "resultCount",
      header: "Results",
      align: "right",
      render: (row) =>
        row.resultCount === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : row.publishedCount < row.resultCount ? (
          // Called out rather than shown as a plain fraction: unreleased marks
          // are the thing a lecturer has to act on.
          <Badge variant="warning" size="sm">
            {row.publishedCount} / {row.resultCount} released
          </Badge>
        ) : (
          <span className="text-muted-foreground">
            {formatNumber(row.resultCount)} released
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={EXAM_STATUS_LABELS[row.status]}
          variant={EXAM_STATUS_VARIANTS[row.status]}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Papers" value={formatNumber(rows.length)} />
        <StatCard label="Scheduled" value={formatNumber(scheduled)} caption="Not yet sat" />
        <StatCard
          label="Awaiting Release"
          value={formatNumber(awaitingRelease)}
          caption={awaitingRelease > 0 ? "Marks entered, not published" : "All released"}
        />
      </div>

      <ListToolbar
        className="mt-6"
        search={<ListSearch
              unsupported={UNSUPPORTED_SEARCH} placeholder="Search exams…" />}
        filters={
          <ListFilter
            paramKey="status"
              unsupported={UNSUPPORTED_FILTER}
            label="Status"
            hideLabel
            allLabel="All statuses"
            options={EXAM_STATUS_VALUES.map((value) => ({
              value,
              label: EXAM_STATUS_LABELS[value],
            }))}
          />
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<ClipboardCheck />}
              title={q || status ? "Nothing matches" : "No exams scheduled"}
              description={
                q || status
                  ? "No examination matches these filters."
                  : "Papers for the courses you teach appear here once the examination office schedules them."
              }
            />
          }
        />
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Result entry and publication are handled by the examination office. Marks appear on a
        student&apos;s transcript only once released.
      </p>
    </>
  );
}

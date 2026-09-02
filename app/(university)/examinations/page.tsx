import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, CalendarPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listExaminations, type ExaminationRow } from "@/services/examinations";
import { semesterIndex } from "@/services/reference";
import { ExaminationType } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { EXAMINATION_TYPE_LABELS, EXAM_STATUS_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { ExamStatus } from "@/types";

export const metadata: Metadata = { title: "Examinations" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ type?: string; semesterId?: string; page?: string }>;

/**
 * The examination calendar — PRD 57's "Examinations" area of University
 * Administration, and PRD 17.2's "Examination calendar".
 *
 * WHO THIS IS FOR
 *   The Controller of Examination, alongside the university administrator.
 *   Until now /api/examinations admitted only UNIVERSITY_ADMIN, FACULTY and
 *   STUDENT, so the role named after examinations was refused by the
 *   examination calendar and had no screen for it either. The guards now name
 *   EXAMINATION_READ_ROLES / EXAMINATION_MANAGE_ROLES, which include the COE.
 *
 * WHY COURSE AND SEMESTER NAMES DO NOT COME FROM THE REFERENCE INDEXES
 *   Those scan /api/courses, which is COURSE_READ_ROLES — deliberately closed
 *   to the examination office, so every name resolved to "—" for exactly the
 *   caller this page exists for. GET /api/examinations joins the course and
 *   semester itself and listExaminations reads that join, so no course-registry
 *   permission is needed to render a course name.
 *
 * READ-ONLY, DELIBERATELY
 *   Scheduling a new examination means choosing a course and a semester, and
 *   the COE can read neither catalogue (both 403). Rather than widen the
 *   academic registry to the examination office on my own judgement, this
 *   screen reads the calendar and the gap is reported as a product decision.
 *   PATCH and POST remain open to UNIVERSITY_ADMIN and FACULTY exactly as
 *   before, and to the COE at the API once it can resolve a course.
 */
export default async function ExaminationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { type, semesterId, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  // Both filters are sent to the API and applied in its WHERE clause. Filtering
  // here instead would only narrow the page already fetched — hiding matches on
  // later pages and reporting a total for the unfiltered set.
  const [result, semesters] = await Promise.all([
    listExaminations({ page, limit: PAGE_SIZE, type, semesterId }),
    semesterIndex(),
  ]);

  // The semester filter's options. semesterIndex reads
  // /api/academic-years/[id]/semesters, which the examination office may now
  // read — that is the same minimum reference grant examination setup needed,
  // reused rather than widened further.
  const semesterFilterOptions = Array.from(semesters.values())
    .map((semester) => ({ value: semester.id, label: semester.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const header = (
    <PageHeader
      title="Examinations"
      subtitle="The examination calendar for this university."
      action={
        <Link
          href="/examinations/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <CalendarPlus className="h-4 w-4" />
          Schedule examination
        </Link>
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="examinations"
          message={result.error}
        />
      </>
    );
  }

  // Already filtered by the server, so these are the rows for this page of the
  // filtered set and the total below belongs to that same set.
  const rows = result.data.items;

  const scheduled = rows.filter((row) => row.status === "SCHEDULED").length;
  const completed = rows.filter((row) => row.status === "COMPLETED").length;

  const columns: TableColumn<ExaminationRow>[] = [
    {
      key: "title",
      header: "Examination",
      render: (row) => (
        <Link href={`/examinations/${row.id}`} className="block min-w-0 hover:underline">
          <p className="truncate font-medium text-heading">{row.title}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {row.courseCode} · {row.semesterName}
          </p>
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => EXAMINATION_TYPE_LABELS[row.type] ?? row.type,
    },
    {
      key: "date",
      header: "Date",
      render: (row) =>
        row.date ? (
          <span className="whitespace-nowrap">
            {formatDate(row.date)}
            {row.startTime ? ` · ${row.startTime}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">Not scheduled</span>
        ),
    },
    {
      key: "venue",
      header: "Venue",
      render: (row) => row.venue ?? <span className="text-muted-foreground">—</span>,
    },
    { key: "maxMarks", header: "Max marks", render: (row) => row.maxMarks },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={row.status === "COMPLETED" ? "success" : "neutral"}>
          {EXAM_STATUS_LABELS[row.status as ExamStatus] ?? row.status}
        </Badge>
      ),
    },
  ];

  return (
    <>
      {header}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Examinations"
          value={String(result.data.pagination.total)}
        />
        <StatCard label="Scheduled" value={String(scheduled)} />
        <StatCard label="Completed" value={String(completed)} />
      </div>

      <ListToolbar
        filters={
          <>
            <ListFilter
              paramKey="type"
              label="Type"
              hideLabel
              allLabel="All types"
              options={enumOptions(ExaminationType, EXAMINATION_TYPE_LABELS)}
            />
            <ListFilter
              paramKey="semesterId"
              label="Semester"
              hideLabel
              allLabel="All semesters"
              options={semesterFilterOptions}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title="No examinations"
              description={
                type
                  ? "No examination of this type has been scheduled."
                  : "Once examinations are scheduled they appear on this calendar."
              }
            />
          }
        />
      </Card>

      <Pagination
        currentPage={result.data.pagination.page}
        totalPages={result.data.pagination.totalPages}
        basePath="/examinations"
        searchParams={{
          ...(type ? { type } : {}),
          ...(semesterId ? { semesterId } : {}),
        }}
      />
    </>
  );
}

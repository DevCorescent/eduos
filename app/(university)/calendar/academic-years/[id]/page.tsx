import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getAcademicYear, listSemesters } from "@/services/calendar";
import { createSemesterAction, deleteSemesterAction } from "@/actions/calendar";
import { formatDate } from "@/utils/format";
import type { Semester } from "@/types";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getAcademicYear(id);
  return { title: result.success ? `${result.data.name} Semesters` : "Semesters" };
}

const FIELDS: FormField[] = [
  { kind: "text", name: "name", label: "Semester name", required: true, placeholder: "2026-27 Odd" },
  {
    kind: "number",
    name: "semesterNumber",
    label: "Semester number",
    required: true,
    min: 1,
    max: 12,
    helperText: "Position within the year — 1 for the first term.",
  },
  { kind: "date", name: "startDate", label: "Start date", required: true },
  { kind: "date", name: "endDate", label: "End date", required: true },
  { kind: "switch", name: "isCurrent", label: "Set as current semester" },
];

export default async function AcademicYearDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [yearResult, semestersResult] = await Promise.all([
    getAcademicYear(id),
    listSemesters(id, { page: 1, limit: 100 }),
  ]);

  if (!yearResult.success) {
    if (yearResult.code === "NOT_FOUND") notFound();
    throw new Error(yearResult.error);
  }

  const year = yearResult.data;

  const columns: TableColumn<Semester>[] = [
    {
      key: "semesterNumber",
      header: "#",
      align: "right",
      render: (semester) => (
        <span className="font-mono text-xs text-muted-foreground">{semester.semesterNumber}</span>
      ),
    },
    {
      key: "name",
      header: "Semester",
      render: (semester) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{semester.name}</span>
          {semester.isCurrent && <StatusBadge label="Current" variant="success" />}
        </div>
      ),
    },
    {
      key: "startDate",
      header: "Starts",
      render: (semester) => (
        <span className="text-muted-foreground">{formatDate(semester.startDate)}</span>
      ),
    },
    {
      key: "endDate",
      header: "Ends",
      render: (semester) => (
        <span className="text-muted-foreground">{formatDate(semester.endDate)}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (semester) => (
        <EntityRowActions
          entityLabel="Semester"
          recordName={semester.name}
          // No edit dialog: PATCH /api/semesters/[id] exists, but a semester's
          // number is part of a uniqueness constraint with its year, and its
          // dates anchor sections and examinations. Deleting and re-adding is
          // the safer affordance until those cascades are handled.
          onDelete={deleteSemesterAction.bind(null, semester.id)}
          deleteWarning={`"${semester.name}" will be permanently removed. Semesters with sections cannot be deleted.`}
        />
      ),
    },
  ];

  return (
    <>
      <Link
        href="/calendar/academic-years"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to academic years
      </Link>

      <PageHeader
        title={year.name}
        subtitle={`${formatDate(year.startDate)} — ${formatDate(year.endDate)}`}
        action={
          <EntityCreateButton
            entityLabel="Semester"
            fields={FIELDS}
            initialValues={{
              name: "",
              semesterNumber: 1,
              startDate: year.startDate.slice(0, 10),
              endDate: year.endDate.slice(0, 10),
              isCurrent: false,
            }}
            action={createSemesterAction.bind(null, year.id)}
          />
        }
      />

      <Card noPadding>
        {!semestersResult.success ? (
          <ErrorState
            title="Couldn't load semesters"
            description={semestersResult.error}
            className="border-0 bg-transparent"
          />
        ) : (
          <Table
            columns={columns}
            data={semestersResult.data.items}
            rowKey={(semester) => semester.id}
            emptyState={
              <EmptyState
                icon={<CalendarDays />}
                title="No semesters yet"
                description="Add the terms that make up this academic year."
              />
            }
          />
        )}
      </Card>
    </>
  );
}

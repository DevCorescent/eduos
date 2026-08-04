import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Rows3 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getBatch, listSections, listSemesters } from "@/services/calendar";
import { listProgrammes } from "@/services/setup";
import { createSectionAction, deleteSectionAction } from "@/actions/calendar";
import { formatDate, formatNumber } from "@/utils/format";
import type { Section } from "@/types";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getBatch(id);
  return { title: result.success ? `${result.data.name} Sections` : "Sections" };
}

export default async function BatchDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const batchResult = await getBatch(id);

  if (!batchResult.success) {
    if (batchResult.code === "NOT_FOUND") notFound();
    throw new Error(batchResult.error);
  }

  const batch = batchResult.data;

  // Semesters depend on the batch's academic year, so this fetch cannot be
  // issued alongside the one above — it needs the batch first.
  const [sectionsResult, semestersResult, programmesResult] = await Promise.all([
    listSections(batch.id, { page: 1, limit: 100 }),
    listSemesters(batch.academicYearId, { page: 1, limit: 100 }),
    listProgrammes({ page: 1, limit: 100 }),
  ]);

  const semesters = semestersResult.success ? semestersResult.data.items : [];
  const semesterNameById = new Map(semesters.map((s) => [s.id, s.name]));
  const currentSemester = semesters.find((s) => s.isCurrent);

  const programme = programmesResult.success
    ? programmesResult.data.items.find((p) => p.id === batch.programmeId)
    : undefined;

  const fields: FormField[] = [
    {
      kind: "select",
      name: "semesterId",
      label: "Semester",
      required: true,
      // Restricted to this batch's own academic year. A section is unique on
      // (batch, semester, name), so offering another year's semesters would
      // let a user build a combination the batch cannot belong to.
      options: semesters.map((s) => ({ value: s.id, label: s.name })),
      placeholder: "Select a semester",
    },
    {
      kind: "text",
      name: "name",
      label: "Section name",
      required: true,
      placeholder: "A",
      maxLength: 10,
      helperText: "Usually a single letter.",
    },
    { kind: "number", name: "maxStrength", label: "Maximum strength", min: 1, max: 500 },
  ];

  const columns: TableColumn<Section>[] = [
    {
      key: "name",
      header: "Section",
      render: (section) => <span className="font-medium text-foreground">{section.name}</span>,
    },
    {
      key: "semesterId",
      header: "Semester",
      render: (section) => (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {semesterNameById.get(section.semesterId) ?? "—"}
          </span>
          {section.semesterId === currentSemester?.id && (
            <StatusBadge label="Current" variant="success" />
          )}
        </div>
      ),
    },
    {
      key: "maxStrength",
      header: "Max strength",
      align: "right",
      render: (section) => (section.maxStrength ? formatNumber(section.maxStrength) : "—"),
    },
    {
      key: "createdAt",
      header: "Added",
      render: (section) => (
        <span className="text-muted-foreground">{formatDate(section.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (section) => (
        <EntityRowActions
          entityLabel="Section"
          recordName={`Section ${section.name}`}
          onDelete={deleteSectionAction.bind(null, section.id)}
          deleteWarning={`Section ${section.name} will be permanently removed, along with its timetable and attendance links.`}
        />
      ),
    },
  ];

  return (
    <>
      <Link
        href="/calendar/batches"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to batches
      </Link>

      <PageHeader
        title={batch.name}
        subtitle={programme ? `${programme.name} · ${batch.code}` : batch.code}
        action={
          // A section must belong to a semester, so with none defined there is
          // nothing valid to create. Hiding the button beats offering one that
          // can only fail.
          semesters.length > 0 ? (
            <EntityCreateButton
              entityLabel="Section"
              fields={fields}
              initialValues={{
                semesterId: currentSemester?.id ?? semesters[0]?.id ?? "",
                name: "",
                maxStrength: "",
              }}
              action={createSectionAction.bind(null, batch.id)}
            />
          ) : undefined
        }
      />

      {semesters.length === 0 && (
        <Alert variant="warning" title="No semesters in this academic year" className="mb-6">
          Sections belong to a semester. Add one to this batch&apos;s academic year first.
        </Alert>
      )}

      <Card noPadding>
        {!sectionsResult.success ? (
          <ErrorState
            title="Couldn't load sections"
            description={sectionsResult.error}
            className="border-0 bg-transparent"
          />
        ) : (
          <Table
            columns={columns}
            data={sectionsResult.data.items}
            rowKey={(section) => section.id}
            emptyState={
              <EmptyState
                icon={<Rows3 />}
                title="No sections yet"
                description="Split this batch into sections so timetables and attendance can be scheduled."
              />
            }
          />
        )}
      </Card>
    </>
  );
}

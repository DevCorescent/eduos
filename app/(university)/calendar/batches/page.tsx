import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listAcademicYears, listBatches } from "@/services/calendar";
import { listProgrammes } from "@/services/setup";
import { createBatchAction, deleteBatchAction, updateBatchAction } from "@/actions/calendar";
import { formatNumber } from "@/utils/format";
import type { Batch } from "@/types";

export const metadata: Metadata = { title: "Batches" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  programmeId?: string;
  academicYearId?: string;
  page?: string;
}>;

export default async function BatchesPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, programmeId, academicYearId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, programmesResult, yearsResult] = await Promise.all([
    listBatches({ page: currentPage, limit: PAGE_SIZE, q, programmeId, academicYearId }),
    listProgrammes({ page: 1, limit: 100 }),
    listAcademicYears({ page: 1, limit: 100 }),
  ]);

  const programmes = programmesResult.success ? programmesResult.data.items : [];
  const years = yearsResult.success ? yearsResult.data.items : [];

  const programmeNameById = new Map(programmes.map((p) => [p.id, p.name]));
  const yearNameById = new Map(years.map((y) => [y.id, y.name]));
  const currentYear = years.find((y) => y.isCurrent);

  const fields: FormField[] = [
    {
      kind: "select",
      name: "programmeId",
      label: "Programme",
      required: true,
      // Retired programmes are excluded: a batch is a new intake, and no new
      // intake should be opened against a programme that is closed.
      options: programmes
        .filter((p) => p.isActive)
        .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
      placeholder: "Select a programme",
    },
    {
      kind: "select",
      name: "academicYearId",
      label: "Academic year",
      required: true,
      options: years.map((y) => ({ value: y.id, label: y.name })),
      placeholder: "Select an academic year",
    },
    { kind: "text", name: "name", label: "Batch name", required: true, placeholder: "BTCSE 2026-27" },
    { kind: "text", name: "code", label: "Code", required: true, placeholder: "BTCSE-2026" },
    { kind: "number", name: "maxStrength", label: "Maximum strength", min: 1, max: 2000 },
  ];

  const emptyValues = {
    programmeId: programmeId ?? "",
    // Defaults to the current year — the overwhelmingly likely intent when
    // opening a new batch.
    academicYearId: academicYearId ?? currentYear?.id ?? "",
    name: "",
    code: "",
    maxStrength: "",
  };

  const header = (
    <PageHeader
      title="Batches"
      subtitle="Student intakes, one per programme per academic year."
      action={
        <EntityCreateButton
          entityLabel="Batch"
          fields={fields}
          initialValues={emptyValues}
          action={createBatchAction}
        />
      }
    />
  );

  /**
   * The same header with its create/manage controls withheld.
   *
   * Rendered when the list request itself failed. A 403 there means this role
   * has no access to the collection at all, so an "Invite user" button beside
   * the refusal would offer an action the backend will reject — the control
   * would be a claim the API does not honour.
   */
  const failureHeader = (
    <PageHeader title="Batches" subtitle="Student intakes, one per programme per academic year." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="batches"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<Batch>[] = [
    {
      key: "name",
      header: "Batch",
      render: (batch) => (
        <div className="min-w-0">
          <Link
            href={`/calendar/batches/${batch.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {batch.name}
          </Link>
          <p className="truncate font-mono text-xs text-muted-foreground">{batch.code}</p>
        </div>
      ),
    },
    {
      key: "programmeId",
      header: "Programme",
      render: (batch) => (
        <span className="text-muted-foreground">
          {programmeNameById.get(batch.programmeId) ?? "—"}
        </span>
      ),
    },
    {
      key: "academicYearId",
      header: "Academic year",
      render: (batch) => (
        <span className="text-muted-foreground">
          {yearNameById.get(batch.academicYearId) ?? "—"}
        </span>
      ),
    },
    {
      key: "maxStrength",
      header: "Max strength",
      align: "right",
      render: (batch) => (batch.maxStrength ? formatNumber(batch.maxStrength) : "—"),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (batch) => (
        <EntityRowActions
          entityLabel="Batch"
          recordName={batch.name}
          editFields={fields}
          editValues={{
            programmeId: batch.programmeId,
            academicYearId: batch.academicYearId,
            name: batch.name,
            code: batch.code,
            maxStrength: batch.maxStrength ?? "",
          }}
          onUpdate={updateBatchAction.bind(null, batch.id)}
          onDelete={deleteBatchAction.bind(null, batch.id)}
          deleteWarning={`"${batch.name}" will be permanently removed. Batches with sections cannot be deleted.`}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search batches…" />}
        filters={
          <>
            <ListFilter
              paramKey="programmeId"
              label="Programme"
              hideLabel
              allLabel="All programmes"
              options={programmes.map((p) => ({ value: p.id, label: p.code }))}
            />
            <ListFilter
              paramKey="academicYearId"
              label="Academic year"
              hideLabel
              allLabel="All years"
              options={years.map((y) => ({ value: y.id, label: y.name }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(batch) => batch.id}
          emptyState={
            <EmptyState
              icon={<CalendarDays />}
              title={
                q || programmeId || academicYearId ? "No matching batches" : "No batches yet"
              }
              description={
                q || programmeId || academicYearId
                  ? "No batch matches these filters."
                  : "A batch groups the students admitted to one programme in one year."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/calendar/batches"
            searchParams={{
              ...(q ? { q } : {}),
              ...(programmeId ? { programmeId } : {}),
              ...(academicYearId ? { academicYearId } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

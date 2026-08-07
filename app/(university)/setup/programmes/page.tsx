import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listDepartments, listProgrammes } from "@/services/setup";
import {
  createProgrammeAction,
  deleteProgrammeAction,
  updateProgrammeAction,
} from "@/actions/setup";
import { DURATION_UNIT_LABELS, PROGRAMME_TYPE_LABELS } from "@/constants/labels";
import {
  DURATION_UNIT_VALUES,
  PROGRAMME_TYPE_VALUES,
  type Programme,
} from "@/types";

export const metadata: Metadata = { title: "Programmes" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  departmentId?: string;
  type?: string;
  page?: string;
}>;

export default async function ProgrammesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, departmentId, type, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, departmentsResult] = await Promise.all([
    listProgrammes({ page: currentPage, limit: PAGE_SIZE, q, departmentId, type }),
    listDepartments({ page: 1, limit: 100 }),
  ]);

  const departments = departmentsResult.success ? departmentsResult.data.items : [];
  const departmentOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  const fields: FormField[] = [
    {
      kind: "select",
      name: "departmentId",
      label: "Department",
      required: true,
      options: departmentOptions,
      placeholder: "Select a department",
    },
    { kind: "text", name: "name", label: "Programme name", required: true, placeholder: "B.Tech Computer Science & Engineering" },
    { kind: "text", name: "code", label: "Code", required: true, placeholder: "BTCSE" },
    {
      kind: "select",
      name: "type",
      label: "Type",
      required: true,
      options: PROGRAMME_TYPE_VALUES.map((value) => ({
        value,
        label: PROGRAMME_TYPE_LABELS[value],
      })),
    },
    { kind: "number", name: "durationValue", label: "Duration", required: true, min: 1, max: 120 },
    {
      kind: "select",
      name: "durationUnit",
      label: "Duration unit",
      required: true,
      options: DURATION_UNIT_VALUES.map((value) => ({
        value,
        label: DURATION_UNIT_LABELS[value],
      })),
    },
    { kind: "number", name: "totalCredits", label: "Total credits", min: 0, max: 1000 },
    {
      kind: "textarea",
      name: "eligibility",
      label: "Eligibility",
      rows: 2,
      placeholder: "10+2 with Physics, Chemistry and Mathematics; minimum 60%",
    },
    {
      kind: "switch",
      name: "isActive",
      label: "Accepting intake",
      helperText: "Turn off to retire the programme without deleting its history.",
    },
  ];

  const emptyValues = {
    departmentId: departmentId ?? "",
    name: "",
    code: "",
    type: "UNDERGRADUATE",
    durationValue: 4,
    durationUnit: "YEARS",
    totalCredits: "",
    eligibility: "",
    isActive: true,
  };

  const header = (
    <PageHeader
      title="Programmes"
      subtitle="Degrees, diplomas and certificates this institution awards."
      action={
        <EntityCreateButton
          entityLabel="Programme"
          fields={fields}
          initialValues={emptyValues}
          action={createProgrammeAction}
          modalSize="lg"
        />
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load programmes" description={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<Programme>[] = [
    {
      key: "name",
      header: "Programme",
      render: (programme) => (
        <div className="min-w-0">
          <Link
            href={`/setup/programmes/${programme.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {programme.name}
          </Link>
          <p className="truncate font-mono text-xs text-muted-foreground">{programme.code}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (programme) => PROGRAMME_TYPE_LABELS[programme.type],
    },
    {
      key: "durationValue",
      header: "Duration",
      render: (programme) =>
        `${programme.durationValue} ${DURATION_UNIT_LABELS[programme.durationUnit].toLowerCase()}`,
    },
    {
      key: "totalCredits",
      header: "Credits",
      align: "right",
      render: (programme) => programme.totalCredits ?? "—",
    },
    {
      key: "departmentId",
      header: "Department",
      render: (programme) => (
        <span className="text-muted-foreground">
          {departmentNameById.get(programme.departmentId) ?? "—"}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (programme) => (
        <StatusBadge
          label={programme.isActive ? "Active" : "Retired"}
          variant={programme.isActive ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (programme) => (
        <EntityRowActions
          entityLabel="Programme"
          recordName={programme.name}
          editFields={fields}
          editValues={{
            departmentId: programme.departmentId,
            name: programme.name,
            code: programme.code,
            type: programme.type,
            durationValue: programme.durationValue,
            durationUnit: programme.durationUnit,
            totalCredits: programme.totalCredits ?? "",
            eligibility: programme.eligibility ?? "",
            isActive: programme.isActive,
          }}
          onUpdate={updateProgrammeAction.bind(null, programme.id)}
          onDelete={deleteProgrammeAction.bind(null, programme.id)}
          deleteWarning={`"${programme.name}" will be permanently removed. Programmes with specialisations cannot be deleted — retire it instead to keep its history.`}
          modalSize="lg"
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search programmes…" />}
        filters={
          <>
            <ListFilter
              paramKey="departmentId"
              label="Department"
              hideLabel
              allLabel="All departments"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
            <ListFilter
              paramKey="type"
              label="Type"
              hideLabel
              allLabel="All types"
              options={PROGRAMME_TYPE_VALUES.map((value) => ({
                value,
                label: PROGRAMME_TYPE_LABELS[value],
              }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={items}
          rowKey={(programme) => programme.id}
          emptyState={
            <EmptyState
              icon={<GraduationCap />}
              title={q || departmentId || type ? "No matching programmes" : "No programmes yet"}
              description={
                q || departmentId || type
                  ? "No programme matches these filters."
                  : "Add a programme to start enrolling students."
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
            basePath="/setup/programmes"
            searchParams={{
              ...(q ? { q } : {}),
              ...(departmentId ? { departmentId } : {}),
              ...(type ? { type } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

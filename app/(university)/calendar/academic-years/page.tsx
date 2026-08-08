import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listAcademicYears } from "@/services/calendar";
import {
  createAcademicYearAction,
  deleteAcademicYearAction,
  updateAcademicYearAction,
} from "@/actions/calendar";
import { formatDate } from "@/utils/format";
import type { AcademicYear } from "@/types";
import { SetCurrentYearButton } from "./SetCurrentYearButton";

export const metadata: Metadata = { title: "Academic Years" };

const FIELDS: FormField[] = [
  {
    kind: "text",
    name: "name",
    label: "Name",
    required: true,
    placeholder: "2026-27",
    helperText: "How staff refer to this year.",
  },
  { kind: "date", name: "startDate", label: "Start date", required: true },
  { kind: "date", name: "endDate", label: "End date", required: true },
  {
    kind: "switch",
    name: "isCurrent",
    label: "Set as current year",
    helperText: "Only one year can be current — setting this clears the others.",
  },
];

/** `<input type="date">` needs YYYY-MM-DD; the API sends a full ISO timestamp. */
function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export default async function AcademicYearsPage() {
  // Deliberately unpaginated: a university has a handful of academic years, and
  // paging three rows would add a control that never does anything.
  const result = await listAcademicYears({ page: 1, limit: 100 });

  const header = (
    <PageHeader
      title="Academic Years"
      subtitle="The years this institution runs, and which one is current."
      action={
        <EntityCreateButton
          entityLabel="Academic year"
          fields={FIELDS}
          initialValues={{ name: "", startDate: "", endDate: "", isCurrent: false }}
          action={createAcademicYearAction}
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
    <PageHeader title="Academic Years" subtitle="The years this institution runs, and which one is current." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="academic years"
          message={result.error}
        />
      </>
    );
  }

  const years = result.data.items;

  const columns: TableColumn<AcademicYear>[] = [
    {
      key: "name",
      header: "Year",
      render: (year) => (
        <div className="flex items-center gap-2">
          <Link
            href={`/calendar/academic-years/${year.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {year.name}
          </Link>
          {year.isCurrent && <StatusBadge label="Current" variant="success" />}
        </div>
      ),
    },
    {
      key: "startDate",
      header: "Starts",
      render: (year) => <span className="text-muted-foreground">{formatDate(year.startDate)}</span>,
    },
    {
      key: "endDate",
      header: "Ends",
      render: (year) => <span className="text-muted-foreground">{formatDate(year.endDate)}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (year) => (
        <div className="flex items-center justify-end gap-1">
          {/* Offered only where it would change something — a "Set as current"
              button on the current year is a no-op that looks like a control. */}
          {!year.isCurrent && <SetCurrentYearButton id={year.id} name={year.name} />}

          <EntityRowActions
            entityLabel="Academic year"
            recordName={year.name}
            editFields={FIELDS}
            editValues={{
              name: year.name,
              startDate: toDateInput(year.startDate),
              endDate: toDateInput(year.endDate),
              isCurrent: year.isCurrent,
            }}
            onUpdate={updateAcademicYearAction.bind(null, year.id)}
            onDelete={deleteAcademicYearAction.bind(null, year.id)}
            deleteWarning={`"${year.name}" will be permanently removed. Years with semesters or batches cannot be deleted.`}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      {header}

      <Card noPadding>
        <Table
          columns={columns}
          data={years}
          rowKey={(year) => year.id}
          emptyState={
            <EmptyState
              icon={<CalendarRange />}
              title="No academic years yet"
              description="Add an academic year before creating semesters and batches."
            />
          }
        />
      </Card>
    </>
  );
}

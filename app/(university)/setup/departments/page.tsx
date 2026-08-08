import type { Metadata } from "next";
import { Library } from "lucide-react";
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
import { listCampuses, listDepartments, listSchools } from "@/services/setup";
import {
  createDepartmentAction,
  deleteDepartmentAction,
  updateDepartmentAction,
} from "@/actions/setup";
import type { Department } from "@/types";

/**
 * The backend query schema for this collection accepts page and limit only —
 * every other key is dropped by Zod before the handler sees it. The controls
 * stay visible and disabled rather than being deleted, so the screen keeps its
 * shape for when the parameters land.
 */
const UNSUPPORTED_SEARCH =
  "Search will work once the backend adds a ?q parameter to this endpoint.";
const UNSUPPORTED_FILTER = "Filtering will work once the backend accepts this parameter.";

export const metadata: Metadata = { title: "Departments" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  campusId?: string;
  schoolId?: string;
  page?: string;
}>;

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, campusId, schoolId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, campusesResult, schoolsResult] = await Promise.all([
    listDepartments({ page: currentPage, limit: PAGE_SIZE, q, campusId, schoolId }),
    listCampuses({ page: 1, limit: 100 }),
    listSchools({ page: 1, limit: 100 }),
  ]);

  const campuses = campusesResult.success ? campusesResult.data.items : [];
  const schools = schoolsResult.success ? schoolsResult.data.items : [];

  const campusOptions = campuses.map((c) => ({ value: c.id, label: c.name }));
  const campusNameById = new Map(campuses.map((c) => [c.id, c.name]));
  const schoolNameById = new Map(schools.map((s) => [s.id, s.name]));

  // The school filter is narrowed to the selected campus. Offering every
  // school regardless would let a user pick a combination that returns nothing
  // and looks like missing data rather than an impossible filter.
  const schoolsForFilter = campusId ? schools.filter((s) => s.campusId === campusId) : schools;

  const fields: FormField[] = [
    {
      kind: "select",
      name: "campusId",
      label: "Campus",
      required: true,
      options: campusOptions,
      placeholder: "Select a campus",
    },
    {
      kind: "select",
      name: "schoolId",
      label: "School",
      // Optional because Department.schoolId is nullable — a standalone
      // administrative department belongs to a campus but to no school.
      options: [
        { value: "", label: "None — reports directly to the campus" },
        ...schools.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
      ],
      helperText: "Leave unset for a standalone department.",
    },
    { kind: "text", name: "name", label: "Department name", required: true, placeholder: "Computer Science & Engineering" },
    { kind: "text", name: "code", label: "Code", required: true, placeholder: "CSE" },
    { kind: "text", name: "hodName", label: "Head of department", placeholder: "Dr. Vikram Nair" },
    { kind: "email", name: "email", label: "Email", placeholder: "cse@university.edu" },
  ];

  const emptyValues = {
    campusId: campusId ?? "",
    schoolId: schoolId ?? "",
    name: "",
    code: "",
    hodName: "",
    email: "",
  };

  const header = (
    <PageHeader
      title="Departments"
      subtitle="Academic departments that own programmes and faculty."
      action={
        <EntityCreateButton
          entityLabel="Department"
          fields={fields}
          initialValues={emptyValues}
          action={createDepartmentAction}
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
    <PageHeader title="Departments" subtitle="Academic departments that own programmes and faculty." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="departments"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<Department>[] = [
    {
      key: "name",
      header: "Department",
      render: (department) => (
        <span className="font-medium text-foreground">{department.name}</span>
      ),
    },
    {
      key: "code",
      header: "Code",
      render: (department) => <span className="font-mono text-xs">{department.code}</span>,
    },
    {
      key: "campusId",
      header: "Campus",
      render: (department) => (
        <span className="text-muted-foreground">
          {campusNameById.get(department.campusId) ?? "—"}
        </span>
      ),
    },
    {
      key: "schoolId",
      header: "School",
      render: (department) => (
        <span className="text-muted-foreground">
          {department.schoolId ? (schoolNameById.get(department.schoolId) ?? "—") : "Standalone"}
        </span>
      ),
    },
    {
      key: "hodName",
      header: "HOD",
      render: (department) => (
        <span className="text-muted-foreground">{department.hodName ?? "—"}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (department) => (
        <EntityRowActions
          entityLabel="Department"
          recordName={department.name}
          editFields={fields}
          editValues={{
            campusId: department.campusId,
            schoolId: department.schoolId ?? "",
            name: department.name,
            code: department.code,
            hodName: department.hodName ?? "",
            email: department.email ?? "",
          }}
          onUpdate={updateDepartmentAction.bind(null, department.id)}
          onDelete={deleteDepartmentAction.bind(null, department.id)}
          deleteWarning={`"${department.name}" will be permanently removed. Departments with programmes cannot be deleted.`}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch
              unsupported={UNSUPPORTED_SEARCH} placeholder="Search departments…" />}
        filters={
          <>
            <ListFilter
              paramKey="campusId"
              unsupported={UNSUPPORTED_FILTER}
              label="Campus"
              hideLabel
              allLabel="All campuses"
              options={campusOptions}
            />
            <ListFilter
              paramKey="schoolId"
              unsupported={UNSUPPORTED_FILTER}
              label="School"
              hideLabel
              allLabel="All schools"
              options={schoolsForFilter.map((s) => ({ value: s.id, label: s.name }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[48rem]"
          columns={columns}
          data={items}
          rowKey={(department) => department.id}
          emptyState={
            <EmptyState
              icon={<Library />}
              title={q || campusId || schoolId ? "No matching departments" : "No departments yet"}
              description={
                q || campusId || schoolId
                  ? "No department matches these filters."
                  : "Departments own programmes, courses and faculty."
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
            basePath="/setup/departments"
            searchParams={{
              ...(q ? { q } : {}),
              ...(campusId ? { campusId } : {}),
              ...(schoolId ? { schoolId } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

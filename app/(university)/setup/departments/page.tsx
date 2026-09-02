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
import { listUsers } from "@/services/users";
import {
  createDepartmentAction,
  deleteDepartmentAction,
  updateDepartmentAction,
} from "@/actions/setup";
import type { Department } from "@/types";

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

  const [result, campusesResult, schoolsResult, usersResult] = await Promise.all([
    listDepartments({ page: currentPage, limit: PAGE_SIZE, q, campusId, schoolId }),
    listCampuses({ page: 1, limit: 100 }),
    listSchools({ page: 1, limit: 100 }),
    // The head-of-department picker. GET /api/users is already
    // requireRole("UNIVERSITY_ADMIN"), the same guard this page sits behind, so
    // no new permission is involved. 100 is the contract's ceiling.
    listUsers({ page: 1, limit: 100 }),
  ]);

  const campuses = campusesResult.success ? campusesResult.data.items : [];
  const schools = schoolsResult.success ? schoolsResult.data.items : [];

  const campusOptions = campuses.map((c) => ({ value: c.id, label: c.name }));

  // Only ACTIVE accounts are offered: assigning a deactivated user would create
  // a department whose head cannot sign in, which looks like a broken
  // permission rather than a disabled account.
  const users = usersResult.success
    ? usersResult.data.items.filter((user) => user.isActive)
    : [];

  const hodOptions = [
    { value: "", label: "No head assigned" },
    ...users
      .map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName} (${user.email})`.trim(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  const userNameById = new Map(
    users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()])
  );
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
    {
      kind: "select",
      name: "hodUserId",
      label: "Head of department",
      options: hodOptions,
      // hodUserId is the column lib/auth/departmentScope.ts resolves, so this
      // is the field that actually grants a DEPARTMENT_HOD sight of their
      // department. hodName below is display text and grants nothing.
      helperText:
        "The user who heads this department. This is what grants a Department HOD access to it. A user can head only one department.",
    },
    {
      kind: "text",
      name: "hodName",
      label: "Head of department (display name)",
      placeholder: "Dr. Vikram Nair",
      helperText: "Shown on printed material. Does not grant any access.",
    },
    { kind: "email", name: "email", label: "Email", placeholder: "cse@university.edu" },
  ];

  const emptyValues = {
    campusId: campusId ?? "",
    schoolId: schoolId ?? "",
    name: "",
    code: "",
    hodUserId: "",
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
      // The assigned USER is what matters — it is the column authorization
      // reads. hodName is shown underneath only when it adds something the
      // account does not already say, so a department whose head is assigned
      // reads as assigned at a glance.
      render: (department) => {
        const assigned = department.hodUserId
          ? userNameById.get(department.hodUserId)
          : null;

        if (department.hodUserId && !assigned) {
          return <span className="text-muted-foreground">Assigned</span>;
        }

        if (!assigned) {
          return (
            <span className="text-muted-foreground">
              {department.hodName ? `${department.hodName} (unassigned)` : "—"}
            </span>
          );
        }

        return (
          <div className="min-w-0">
            <p className="truncate text-heading">{assigned}</p>
            {department.hodName && department.hodName !== assigned && (
              <p className="truncate text-xs text-muted-foreground">
                {department.hodName}
              </p>
            )}
          </div>
        );
      },
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
            hodUserId: department.hodUserId ?? "",
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
        search={<ListSearch placeholder="Search departments…" />}
        filters={
          <>
            <ListFilter
              paramKey="campusId"
              label="Campus"
              hideLabel
              allLabel="All campuses"
              options={campusOptions}
            />
            {/* Options narrow to the chosen campus (schoolsForFilter above), so
                the two controls cannot be set to a contradictory pair. */}
            <ListFilter
              paramKey="schoolId"
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

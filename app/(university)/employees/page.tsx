import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listEmployees } from "@/services/faculty";
import { listDepartments } from "@/services/setup";
import { addEmployeeAction, updateEmployeeAction } from "@/actions/staff";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_VARIANTS,
  EMPLOYEE_TYPE_LABELS,
} from "@/constants/labels";
import {
  EMPLOYEE_STATUS_VALUES,
  EMPLOYEE_TYPE_VALUES,
  type EmployeeWithUser,
} from "@/types";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Employees" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  status?: string;
  type?: string;
  departmentId?: string;
  page?: string;
}>;

const DESIGNATIONS = [
  "Registrar",
  "Accounts Officer",
  "Librarian",
  "Lab Technician",
  "Admissions Counsellor",
  "IT Support Engineer",
  "Hostel Warden",
  "Transport Coordinator",
  "Office Assistant",
];

export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, type, departmentId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, departmentsResult] = await Promise.all([
    listEmployees({ page: currentPage, limit: PAGE_SIZE, q, status, type, departmentId }),
    listDepartments({ page: 1, limit: 100 }),
  ]);

  const departments = departmentsResult.success ? departmentsResult.data.items : [];
  const departmentOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  const addFields: FormField[] = [
    { kind: "text", name: "firstName", label: "First name", required: true },
    { kind: "text", name: "lastName", label: "Last name", required: true },
    { kind: "email", name: "email", label: "Email", required: true },
    {
      kind: "text",
      name: "password",
      label: "Temporary password",
      required: true,
      helperText: "At least 8 characters.",
    },
    { kind: "text", name: "phone", label: "Phone" },
    {
      kind: "text",
      name: "employeeId",
      label: "Employee ID",
      required: true,
      placeholder: "EMP/0025",
    },
    {
      kind: "select",
      name: "departmentId",
      label: "Department",
      options: departmentOptions,
      placeholder: "Select a department",
    },
    {
      kind: "select",
      name: "designation",
      label: "Designation",
      options: DESIGNATIONS.map((d) => ({ value: d, label: d })),
      placeholder: "Select a designation",
    },
    {
      kind: "select",
      name: "type",
      label: "Employment type",
      required: true,
      options: EMPLOYEE_TYPE_VALUES.map((value) => ({
        value,
        label: EMPLOYEE_TYPE_LABELS[value],
      })),
    },
    { kind: "date", name: "joinDate", label: "Join date", required: true },
  ];

  const editFields: FormField[] = [
    { kind: "text", name: "employeeId", label: "Employee ID", required: true },
    {
      kind: "select",
      name: "departmentId",
      label: "Department",
      options: departmentOptions,
      placeholder: "Select a department",
    },
    {
      kind: "select",
      name: "designation",
      label: "Designation",
      options: DESIGNATIONS.map((d) => ({ value: d, label: d })),
      placeholder: "Select a designation",
    },
    {
      kind: "select",
      name: "type",
      label: "Employment type",
      required: true,
      options: EMPLOYEE_TYPE_VALUES.map((value) => ({
        value,
        label: EMPLOYEE_TYPE_LABELS[value],
      })),
    },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: EMPLOYEE_STATUS_VALUES.map((value) => ({
        value,
        label: EMPLOYEE_STATUS_LABELS[value],
      })),
    },
  ];

  const header = (
    <PageHeader
      title="Employees"
      subtitle="Non-teaching staff across the university."
      action={
        <EntityCreateButton
          entityLabel="Employee"
          label="Add employee"
          fields={addFields}
          initialValues={{
            firstName: "",
            lastName: "",
            email: "",
            password: "",
            phone: "",
            employeeId: "",
            departmentId: departmentId ?? "",
            designation: "",
            type: "NON_TEACHING",
            joinDate: "",
          }}
          action={addEmployeeAction}
          modalSize="lg"
        />
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load employees" description={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(q || status || type || departmentId);

  const columns: TableColumn<EmployeeWithUser>[] = [
    {
      key: "fullName",
      header: "Name",
      render: (employee) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={employee.fullName} src={employee.user.avatarUrl ?? undefined} size="sm" />
          <div className="min-w-0">
            <span className="font-medium text-foreground">{employee.fullName}</span>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {employee.employeeId}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (employee) => employee.designation ?? "—",
    },
    {
      key: "departmentId",
      header: "Department",
      render: (employee) => (
        <span className="text-muted-foreground">
          {employee.departmentId
            ? (departmentNameById.get(employee.departmentId) ?? "—")
            : "—"}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (employee) => (
        <Badge variant="neutral" size="sm">
          {EMPLOYEE_TYPE_LABELS[employee.type]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (employee) => (
        <StatusBadge
          label={EMPLOYEE_STATUS_LABELS[employee.status]}
          variant={EMPLOYEE_STATUS_VARIANTS[employee.status]}
        />
      ),
    },
    {
      key: "joinDate",
      header: "Joined",
      render: (employee) => (
        <span className="text-muted-foreground">{formatDate(employee.joinDate)}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (employee) => (
        <EntityRowActions
          entityLabel="Employee"
          recordName={employee.fullName}
          editFields={editFields}
          editValues={{
            employeeId: employee.employeeId,
            departmentId: employee.departmentId ?? "",
            designation: employee.designation ?? "",
            type: employee.type,
            status: employee.status,
          }}
          onUpdate={updateEmployeeAction.bind(null, employee.id)}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search by name, ID or designation…" />}
        filters={
          <>
            <ListFilter
              paramKey="status"
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={EMPLOYEE_STATUS_VALUES.map((value) => ({
                value,
                label: EMPLOYEE_STATUS_LABELS[value],
              }))}
            />
            <ListFilter
              paramKey="type"
              label="Type"
              hideLabel
              allLabel="All types"
              options={EMPLOYEE_TYPE_VALUES.map((value) => ({
                value,
                label: EMPLOYEE_TYPE_LABELS[value],
              }))}
            />
            <ListFilter
              paramKey="departmentId"
              label="Department"
              hideLabel
              allLabel="All departments"
              options={departments.map((d) => ({ value: d.id, label: d.code }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(employee) => employee.id}
          emptyState={
            <EmptyState
              icon={<Users />}
              title={hasFilters ? "No matching employees" : "No employees yet"}
              description={
                hasFilters
                  ? "No employee matches these filters."
                  : "Add administrative and support staff here."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/employees"
            searchParams={{
              ...(q ? { q } : {}),
              ...(status ? { status } : {}),
              ...(type ? { type } : {}),
              ...(departmentId ? { departmentId } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} employees
          </p>
        </div>
      )}
    </>
  );
}

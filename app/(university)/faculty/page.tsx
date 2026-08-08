import type { Metadata } from "next";
import Link from "next/link";
import { UserCog } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listFaculty } from "@/services/faculty";
import { listDepartments } from "@/services/setup";
import { addFacultyAction, updateFacultyAction } from "@/actions/staff";
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_VARIANTS } from "@/constants/labels";
import { EMPLOYEE_STATUS_VALUES, type FacultyWithUser } from "@/types";
import { formatDate } from "@/utils/format";

/**
 * The backend query schema for this collection accepts page and limit only —
 * every other key is dropped by Zod before the handler sees it. The controls
 * stay visible and disabled rather than being deleted, so the screen keeps its
 * shape for when the parameters land.
 */
const UNSUPPORTED_SEARCH =
  "Search will work once the backend adds a ?q parameter to this endpoint.";
const UNSUPPORTED_FILTER = "Filtering will work once the backend accepts this parameter.";

export const metadata: Metadata = { title: "Faculty" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  status?: string;
  departmentId?: string;
  page?: string;
}>;

/** Common designations, offered as a datalist-style select rather than free text. */
const DESIGNATIONS = [
  "Professor",
  "Associate Professor",
  "Assistant Professor",
  "Lecturer",
  "Visiting Faculty",
  "Teaching Assistant",
];

export default async function FacultyPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, departmentId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, departmentsResult] = await Promise.all([
    listFaculty({ page: currentPage, limit: PAGE_SIZE, q, status, departmentId }),
    listDepartments({ page: 1, limit: 100 }),
  ]);

  const departments = departmentsResult.success ? departmentsResult.data.items : [];
  const departmentOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  // Adding faculty is two writes — a User then a FacultyMember — so the form
  // asks for the person and the employment record together.
  const addFields: FormField[] = [
    { kind: "text", name: "firstName", label: "First name", required: true, placeholder: "Meera" },
    { kind: "text", name: "lastName", label: "Last name", required: true, placeholder: "Iyer" },
    { kind: "email", name: "email", label: "Email", required: true, placeholder: "meera.iyer@university.edu" },
    {
      kind: "text",
      name: "password",
      label: "Temporary password",
      required: true,
      helperText: "At least 8 characters. They change it after signing in.",
    },
    { kind: "text", name: "phone", label: "Phone", placeholder: "+91 98765 43210" },
    {
      kind: "text",
      name: "employeeId",
      label: "Employee ID",
      required: true,
      placeholder: "FAC/0043",
      helperText: "Unique within this university.",
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
    { kind: "text", name: "qualification", label: "Qualification", placeholder: "Ph.D" },
    { kind: "text", name: "specialization", label: "Specialisation", placeholder: "Machine Learning" },
    { kind: "number", name: "experience", label: "Experience (years)", min: 0, max: 60 },
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
    { kind: "text", name: "qualification", label: "Qualification" },
    { kind: "text", name: "specialization", label: "Specialisation" },
    { kind: "number", name: "experience", label: "Experience (years)", min: 0, max: 60 },
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
      title="Faculty"
      subtitle="Teaching staff, their departments and their workload."
      action={
        <EntityCreateButton
          entityLabel="Faculty member"
          label="Add faculty"
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
            qualification: "",
            specialization: "",
            experience: "",
            joinDate: "",
          }}
          action={addFacultyAction}
          modalSize="lg"
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
    <PageHeader title="Faculty" subtitle="Teaching staff, their departments and their workload." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="faculty"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(q || status || departmentId);

  const columns: TableColumn<FacultyWithUser>[] = [
    {
      key: "fullName",
      header: "Name",
      render: (faculty) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={faculty.fullName} src={faculty.user.avatarUrl ?? undefined} size="sm" />
          <div className="min-w-0">
            <Link
              href={`/faculty/${faculty.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {faculty.fullName}
            </Link>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {faculty.employeeId}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "departmentId",
      header: "Department",
      render: (faculty) => (
        <span className="text-muted-foreground">
          {faculty.departmentId ? (departmentNameById.get(faculty.departmentId) ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (faculty) => faculty.designation ?? "—",
    },
    {
      key: "experience",
      header: "Experience",
      align: "right",
      render: (faculty) =>
        faculty.experience !== null ? `${faculty.experience} yr` : "—",
    },
    {
      key: "status",
      header: "Status",
      render: (faculty) => (
        <StatusBadge
          label={EMPLOYEE_STATUS_LABELS[faculty.status]}
          variant={EMPLOYEE_STATUS_VARIANTS[faculty.status]}
        />
      ),
    },
    {
      key: "joinDate",
      header: "Joined",
      render: (faculty) => (
        <span className="text-muted-foreground">{formatDate(faculty.joinDate)}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (faculty) => (
        <EntityRowActions
          entityLabel="Faculty member"
          recordName={faculty.fullName}
          editFields={editFields}
          editValues={{
            employeeId: faculty.employeeId,
            departmentId: faculty.departmentId ?? "",
            designation: faculty.designation ?? "",
            qualification: faculty.qualification ?? "",
            specialization: faculty.specialization ?? "",
            experience: faculty.experience ?? "",
            status: faculty.status,
          }}
          onUpdate={updateFacultyAction.bind(null, faculty.id)}
          // No delete: a faculty record anchors teaching assignments,
          // timetables and attendance. Leaving is a status change — TERMINATED
          // or RETIRED — which the edit dialog already does.
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch
              unsupported={UNSUPPORTED_SEARCH} placeholder="Search by name, ID or designation…" />}
        filters={
          <>
            <ListFilter
              paramKey="status"
              unsupported={UNSUPPORTED_FILTER}
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={EMPLOYEE_STATUS_VALUES.map((value) => ({
                value,
                label: EMPLOYEE_STATUS_LABELS[value],
              }))}
            />
            <ListFilter
              paramKey="departmentId"
              unsupported={UNSUPPORTED_FILTER}
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
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={items}
          rowKey={(faculty) => faculty.id}
          emptyState={
            <EmptyState
              icon={<UserCog />}
              title={hasFilters ? "No matching faculty" : "No faculty yet"}
              description={
                hasFilters
                  ? "No faculty member matches these filters."
                  : "Add teaching staff so courses can be assigned."
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
            basePath="/faculty"
            searchParams={{
              ...(q ? { q } : {}),
              ...(status ? { status } : {}),
              ...(departmentId ? { departmentId } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} faculty
          </p>
        </div>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton, EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listCourses } from "@/services/courses";
import { listDepartments } from "@/services/setup";
import {
  createCourseAction,
  deleteCourseAction,
  updateCourseAction,
} from "@/actions/academics";
import { COURSE_TYPE_LABELS } from "@/constants/labels";
import { COURSE_TYPE_VALUES, type Course } from "@/types";

export const metadata: Metadata = { title: "Courses" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  departmentId?: string;
  type?: string;
  page?: string;
}>;

export default async function CoursesPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, departmentId, type, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, departmentsResult] = await Promise.all([
    listCourses({ page: currentPage, limit: PAGE_SIZE, q, departmentId, type }),
    listDepartments({ page: 1, limit: 100 }),
  ]);

  const departments = departmentsResult.success ? departmentsResult.data.items : [];
  const departmentOptions = departments.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  const fields: FormField[] = [
    { kind: "text", name: "name", label: "Course name", required: true, placeholder: "Data Structures & Algorithms" },
    {
      kind: "text",
      name: "code",
      label: "Course code",
      required: true,
      placeholder: "CSE101",
      helperText: "Unique within this university. Stored in upper case.",
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
      name: "type",
      label: "Type",
      required: true,
      options: COURSE_TYPE_VALUES.map((value) => ({
        value,
        label: COURSE_TYPE_LABELS[value],
      })),
    },
    { kind: "number", name: "credits", label: "Credits", required: true, min: 0, max: 30 },
    { kind: "textarea", name: "description", label: "Description", rows: 2 },
    {
      kind: "switch",
      name: "isActive",
      label: "Offered",
      helperText: "Turn off to retire the course without losing its history.",
    },
  ];

  const header = (
    <PageHeader
      title="Courses"
      subtitle="The course catalogue this university teaches from."
      action={
        <EntityCreateButton
          entityLabel="Course"
          fields={fields}
          initialValues={{
            name: "",
            code: "",
            departmentId: departmentId ?? "",
            type: "CORE",
            credits: 3,
            description: "",
            isActive: true,
          }}
          action={createCourseAction}
          modalSize="lg"
        />
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load courses" description={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(q || departmentId || type);

  const columns: TableColumn<Course>[] = [
    {
      key: "name",
      header: "Course",
      render: (course) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{course.name}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">{course.code}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (course) => (
        <Badge variant="neutral" size="sm">
          {COURSE_TYPE_LABELS[course.type]}
        </Badge>
      ),
    },
    {
      key: "credits",
      header: "Credits",
      align: "right",
      render: (course) => course.credits,
    },
    {
      key: "departmentId",
      header: "Department",
      render: (course) => (
        <span className="text-muted-foreground">
          {course.departmentId ? (departmentNameById.get(course.departmentId) ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (course) => (
        <StatusBadge
          label={course.isActive ? "Offered" : "Retired"}
          variant={course.isActive ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (course) => (
        <EntityRowActions
          entityLabel="Course"
          recordName={course.name}
          editFields={fields}
          editValues={{
            name: course.name,
            code: course.code,
            departmentId: course.departmentId ?? "",
            type: course.type,
            credits: course.credits,
            description: course.description ?? "",
            isActive: course.isActive,
          }}
          onUpdate={updateCourseAction.bind(null, course.id)}
          onDelete={deleteCourseAction.bind(null, course.id)}
          deleteWarning={`"${course.name}" will be permanently removed. A course that is timetabled, assigned to faculty or in a curriculum cannot be deleted — retire it instead.`}
          modalSize="lg"
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search by name or code…" />}
        filters={
          <>
            <ListFilter
              paramKey="departmentId"
              label="Department"
              hideLabel
              allLabel="All departments"
              options={departments.map((d) => ({ value: d.id, label: d.code }))}
            />
            <ListFilter
              paramKey="type"
              label="Type"
              hideLabel
              allLabel="All types"
              options={COURSE_TYPE_VALUES.map((value) => ({
                value,
                label: COURSE_TYPE_LABELS[value],
              }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[48rem]"
          columns={columns}
          data={items}
          rowKey={(course) => course.id}
          emptyState={
            <EmptyState
              icon={<BookOpen />}
              title={hasFilters ? "No matching courses" : "No courses yet"}
              description={
                hasFilters
                  ? "No course matches these filters."
                  : "Add a course before building a curriculum or a timetable."
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
            basePath="/curriculum/courses"
            searchParams={{
              ...(q ? { q } : {}),
              ...(departmentId ? { departmentId } : {}),
              ...(type ? { type } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} courses
          </p>
        </div>
      )}
    </>
  );
}

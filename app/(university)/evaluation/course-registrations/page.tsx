import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listRegistrations } from "@/services/evaluation";
import { courseIndex, semesterIndex } from "@/services/reference";
import type { CourseRegistrationDTO } from "@/lib/dto/courseRegistration.dto";
import { RegistrationStatus, RegistrationType } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Course Registrations" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  semesterId?: string;
  status?: string;
  registrationType?: string;
  page?: string;
}>;

/**
 * Every course enrolment, with the regulation and credits each was taken under.
 *
 * `credits`, `evaluationSchemeId` and `attemptNumber` are SNAPSHOTS taken at
 * registration, not live lookups — a course whose credit value changes later
 * must not retroactively alter what a student earned. The columns are labelled
 * plainly rather than joined to current values for that reason.
 */
export default async function CourseRegistrationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { semesterId, status, registrationType, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, courses, semesters] = await Promise.all([
    listRegistrations({
      page: currentPage,
      limit: PAGE_SIZE,
      semesterId,
      status: status as CourseRegistrationDTO["status"] | undefined,
      registrationType: registrationType as
        | CourseRegistrationDTO["registrationType"]
        | undefined,
    }),
    courseIndex(),
    semesterIndex(),
  ]);

  const header = (
    <PageHeader
      title="Course Registrations"
      subtitle="Who is enrolled in what, and under which regulation."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load registrations" description={result.error} />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<CourseRegistrationDTO>[] = [
    {
      key: "studentId",
      header: "Student",
      render: (registration) => (
        // GET /api/course-registrations returns a studentId and no name, and no
        // endpoint resolves a cohort of them in one call. The id is shown as-is
        // rather than blank.
        <span className="font-mono text-xs text-foreground">{registration.studentId}</span>
      ),
    },
    {
      key: "course",
      header: "Course",
      render: (registration) => {
        const course = courses.get(registration.courseId);
        return (
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{course?.name ?? "—"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {course?.code ?? registration.courseId}
            </p>
          </div>
        );
      },
    },
    {
      key: "semester",
      header: "Semester",
      render: (registration) => (
        <span className="text-sm text-muted-foreground">
          {semesters.get(registration.semesterId)?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "credits",
      header: "Credits",
      align: "right",
      render: (registration) => (
        <span className={registration.countsForCredit ? "text-foreground" : "text-muted-foreground"}>
          {registration.credits}
          {!registration.countsForCredit && (
            <span className="ml-1 text-xs">(not counted)</span>
          )}
        </span>
      ),
    },
    {
      key: "attemptNumber",
      header: "Attempt",
      align: "right",
      render: (registration) => registration.attemptNumber,
    },
    {
      key: "status",
      header: "Status",
      render: (registration) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={registration.isActive ? "success" : "neutral"} size="sm">
            {registration.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {registration.registrationType}
          </span>
        </div>
      ),
    },
    {
      key: "statusChangedAt",
      header: "Changed",
      render: (registration) => formatDate(registration.statusChangedAt),
    },
  ];

  const semesterOptions = Array.from(semesters.values()).map((semester) => ({
    value: semester.id,
    label: semester.name,
  }));

  return (
    <>
      {header}

      <ListToolbar
        filters={
          <>
            <ListFilter
              paramKey="semesterId"
              label="Semester"
              hideLabel
              allLabel="All semesters"
              options={semesterOptions}
            />
            <ListFilter
              paramKey="status"
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={enumOptions(RegistrationStatus)}
            />
            <ListFilter
              paramKey="registrationType"
              label="Type"
              hideLabel
              allLabel="All types"
              options={enumOptions(RegistrationType)}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={items}
          rowKey={(registration) => registration.id}
          emptyState={
            <EmptyState
              icon={<ClipboardList />}
              title="No registrations"
              description={
                semesterId || status || registrationType
                  ? "No registration matches these filters."
                  : "No student has been registered for a course yet."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/evaluation/course-registrations"
            searchParams={{
              ...(semesterId ? { semesterId } : {}),
              ...(status ? { status } : {}),
              ...(registrationType ? { registrationType } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

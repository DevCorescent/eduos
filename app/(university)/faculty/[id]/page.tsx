import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { getFaculty, listFacultyAssignments } from "@/services/faculty";
import { listDepartments } from "@/services/setup";
import { listAcademicYears, listSemesters } from "@/services/calendar";
import { listCourses } from "@/services/courses";
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_VARIANTS } from "@/constants/labels";
import { FacultyProfileTabs } from "./FacultyProfileTabs";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const result = await getFaculty(id);
  return { title: result.success ? result.data.fullName : "Faculty" };
}

export default async function FacultyProfilePage({ params }: { params: Params }) {
  const { id } = await params;

  const facultyResult = await getFaculty(id);

  if (!facultyResult.success) {
    if (facultyResult.code === "NOT_FOUND") notFound();
    throw new Error(facultyResult.error);
  }

  const faculty = facultyResult.data;

  const [assignmentsResult, departmentsResult, coursesResult, yearsResult] =
    await Promise.all([
      listFacultyAssignments(id, { page: 1, limit: 100 }),
      listDepartments({ page: 1, limit: 100 }),
      listCourses({ page: 1, limit: 100 }),
      listAcademicYears({ page: 1, limit: 100 }),
    ]);

  const department = departmentsResult.success
    ? departmentsResult.data.items.find((d) => d.id === faculty.departmentId)
    : undefined;

  // Semesters hang off the current academic year, so this depends on the years
  // fetch above and cannot join the parallel batch.
  const currentYear = yearsResult.success
    ? yearsResult.data.items.find((y) => y.isCurrent)
    : undefined;
  const semestersResult = currentYear
    ? await listSemesters(currentYear.id, { page: 1, limit: 100 })
    : null;

  return (
    <>
      <Link
        href="/faculty"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to faculty
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={faculty.fullName} src={faculty.user.avatarUrl ?? undefined} size="lg" />
        <div className="min-w-0 flex-1">
          <PageHeader
            className="pb-0"
            title={faculty.fullName}
            subtitle={`${faculty.employeeId} · ${faculty.user.email}`}
            action={
              <StatusBadge
                label={EMPLOYEE_STATUS_LABELS[faculty.status]}
                variant={EMPLOYEE_STATUS_VARIANTS[faculty.status]}
                size="md"
              />
            }
          />
        </div>
      </div>

      <FacultyProfileTabs
        faculty={faculty}
        departmentName={department ? `${department.name} (${department.code})` : null}
        assignments={assignmentsResult.success ? assignmentsResult.data.items : []}
        assignmentsError={assignmentsResult.success ? null : assignmentsResult.error}
        courses={
          coursesResult.success
            ? coursesResult.data.items
                .filter((course) => course.isActive)
                .map((course) => ({
                  value: course.id,
                  label: `${course.code} — ${course.name}`,
                }))
            : []
        }
        semesters={
          semestersResult?.success
            ? semestersResult.data.items.map((semester) => ({
                value: semester.id,
                label: semester.name,
              }))
            : []
        }
      />
    </>
  );
}

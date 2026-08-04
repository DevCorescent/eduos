"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Undo2 } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { EntityCreateButton } from "@/components/shared/EntityCrud";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/providers/ToastProvider";
import { assignCourseAction, retireAssignmentAction } from "@/actions/staff";
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_VARIANTS } from "@/constants/labels";
import { formatDate, formatNumber } from "@/utils/format";
import type { FacultyAssignmentRow, FacultyWithUser } from "@/types";

interface Option {
  value: string;
  label: string;
}

export interface FacultyProfileTabsProps {
  faculty: FacultyWithUser;
  departmentName: string | null;
  assignments: FacultyAssignmentRow[];
  assignmentsError: string | null;
  courses: Option[];
  semesters: Option[];
}

export function FacultyProfileTabs({
  faculty,
  departmentName,
  assignments,
  assignmentsError,
  courses,
  semesters,
}: FacultyProfileTabsProps) {
  const [active, setActive] = useState("overview");

  const activeAssignments = assignments.filter((a) => a.isActive);

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "assignments", label: `Course Assignments (${activeAssignments.length})` },
  ];

  return (
    <>
      <Tabs tabs={tabs} value={active} onChange={setActive} className="mb-6" />

      {active === "overview" && (
        <OverviewPanel
          faculty={faculty}
          departmentName={departmentName}
          activeCount={activeAssignments.length}
          // Teaching load is the sum of credits on active assignments — the
          // figure workload balancing and appraisal are actually based on.
          creditLoad={activeAssignments.reduce((sum, a) => sum + a.courseCredits, 0)}
        />
      )}

      {active === "assignments" && (
        <AssignmentsPanel
          facultyId={faculty.id}
          assignments={assignments}
          error={assignmentsError}
          courses={courses}
          semesters={semesters}
        />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

function OverviewPanel({
  faculty,
  departmentName,
  activeCount,
  creditLoad,
}: {
  faculty: FacultyWithUser;
  departmentName: string | null;
  activeCount: number;
  creditLoad: number;
}) {
  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Courses Teaching" value={formatNumber(activeCount)} />
        <StatCard
          label="Credit Load"
          value={formatNumber(creditLoad)}
          caption="Across active assignments"
        />
        <StatCard
          label="Experience"
          value={faculty.experience !== null ? `${faculty.experience} yr` : "—"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card header={<h2 className="text-sm font-semibold text-heading">Employment</h2>}>
          <dl>
            <Field
              label="Employee ID"
              value={<span className="font-mono text-xs">{faculty.employeeId}</span>}
            />
            <Field
              label="Status"
              value={
                <StatusBadge
                  label={EMPLOYEE_STATUS_LABELS[faculty.status]}
                  variant={EMPLOYEE_STATUS_VARIANTS[faculty.status]}
                />
              }
            />
            <Field label="Department" value={departmentName} />
            <Field label="Designation" value={faculty.designation} />
            <Field label="Joined" value={formatDate(faculty.joinDate)} />
          </dl>
        </Card>

        <Card header={<h2 className="text-sm font-semibold text-heading">Academic</h2>}>
          <dl>
            <Field label="Qualification" value={faculty.qualification} />
            <Field label="Specialisation" value={faculty.specialization} />
            <Field
              label="Email"
              value={
                <a href={`mailto:${faculty.user.email}`} className="text-primary hover:underline">
                  {faculty.user.email}
                </a>
              }
            />
            <Field label="Record created" value={formatDate(faculty.createdAt)} />
          </dl>
        </Card>
      </div>
    </>
  );
}

function AssignmentsPanel({
  facultyId,
  assignments,
  error,
  courses,
  semesters,
}: {
  facultyId: string;
  assignments: FacultyAssignmentRow[];
  error: string | null;
  courses: Option[];
  semesters: Option[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleRetire(id: string, courseCode: string) {
    setPendingId(id);
    const result = await retireAssignmentAction(id);
    setPendingId(null);

    if (!result.success) {
      toast({ variant: "error", title: "Couldn't retire", description: result.error });
      return;
    }

    toast({ variant: "success", title: `${courseCode} retired` });
    router.refresh();
  }

  const fields: FormField[] = [
    {
      kind: "select",
      name: "courseId",
      label: "Course",
      required: true,
      options: courses,
      placeholder: "Select a course",
    },
    {
      kind: "select",
      name: "semesterId",
      label: "Semester",
      options: semesters,
      placeholder: "Select a semester",
      helperText: "Leave unset for an assignment that is not term-specific.",
    },
  ];

  if (error) {
    return (
      <Alert variant="error" title="Assignments unavailable">
        {error}
      </Alert>
    );
  }

  const columns: TableColumn<FacultyAssignmentRow>[] = [
    {
      key: "courseCode",
      header: "Course",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.courseName}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.courseCode}</p>
        </div>
      ),
    },
    {
      key: "courseCredits",
      header: "Credits",
      align: "right",
      render: (row) => row.courseCredits || "—",
    },
    {
      key: "sectionName",
      header: "Section",
      render: (row) => (
        <span className="text-muted-foreground">{row.sectionName ?? "All sections"}</span>
      ),
    },
    {
      key: "semesterName",
      header: "Semester",
      render: (row) => (
        <span className="text-muted-foreground">{row.semesterName ?? "Not term-specific"}</span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) =>
        row.isActive ? (
          <StatusBadge label="Teaching" variant="success" />
        ) : (
          <Badge variant="neutral" size="sm">
            Retired
          </Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (row) =>
        // Only an active assignment can be retired — offering the control on an
        // already-retired row would be a no-op that looks like an action.
        row.isActive ? (
          <button
            type="button"
            onClick={() => handleRetire(row.id, row.courseCode)}
            disabled={pendingId === row.id}
            aria-label={`Retire ${row.courseCode}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
        ) : null,
    },
  ];

  return (
    <Card
      noPadding
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-heading">Course assignments</h2>
          {courses.length > 0 && (
            <EntityCreateButton
              entityLabel="Assignment"
              label="Assign course"
              size="sm"
              fields={fields}
              initialValues={{ courseId: "", semesterId: semesters[0]?.value ?? "" }}
              // Bound to this lecturer on the server: assignments are created
              // through /api/faculty/[id]/assignments, so the parent is part of
              // the address rather than a form field.
              action={assignCourseAction.bind(null, facultyId)}
            />
          )}
        </div>
      }
    >
      <Table
        columns={columns}
        data={assignments}
        rowKey={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<BookOpen />}
            title="No courses assigned"
            description="Assign a course so this lecturer appears on timetables and can mark attendance."
          />
        }
      />
    </Card>
  );
}

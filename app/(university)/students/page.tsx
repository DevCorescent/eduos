import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityRowActions } from "@/components/shared/EntityCrud";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { FormField } from "@/components/shared/EntityFormModal";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listStudents } from "@/services/students";
import { listBatches } from "@/services/calendar";
import { listProgrammes } from "@/services/setup";
import { updateStudentAction } from "@/actions/students";
import { EnrolStudentWizard } from "./EnrolStudentWizard";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_VARIANTS } from "@/constants/labels";
import { STUDENT_STATUS_VALUES, type StudentWithUser } from "@/types";
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

export const metadata: Metadata = { title: "Students" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{
  q?: string;
  status?: string;
  programmeId?: string;
  batchId?: string;
  page?: string;
}>;

export default async function StudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, status, programmeId, batchId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [result, programmesResult, batchesResult] = await Promise.all([
    listStudents({ page: currentPage, limit: PAGE_SIZE, q, status, programmeId, batchId }),
    listProgrammes({ page: 1, limit: 100 }),
    listBatches({ page: 1, limit: 100 }),
  ]);

  const programmes = programmesResult.success ? programmesResult.data.items : [];
  const batches = batchesResult.success ? batchesResult.data.items : [];

  const programmeById = new Map(programmes.map((p) => [p.id, p]));
  const batchById = new Map(batches.map((b) => [b.id, b]));

  // Batches narrow to the selected programme: offering every batch would let a
  // user build a filter pair that can only ever return nothing.
  const batchesForFilter = programmeId
    ? batches.filter((b) => b.programmeId === programmeId)
    : batches;

  const editFields: FormField[] = [
    { kind: "text", name: "enrollmentNo", label: "Enrolment number", required: true },
    {
      kind: "select",
      name: "programmeId",
      label: "Programme",
      options: programmes.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
      placeholder: "Select a programme",
    },
    {
      kind: "select",
      name: "batchId",
      label: "Batch",
      options: batches.map((b) => ({ value: b.id, label: b.name })),
      placeholder: "Select a batch",
    },
    { kind: "number", name: "currentSemester", label: "Current semester", min: 1, max: 12 },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: STUDENT_STATUS_VALUES.map((value) => ({
        value,
        label: STUDENT_STATUS_LABELS[value],
      })),
    },
  ];

  const header = (
    <PageHeader
      title="Students"
      subtitle="The enrolment register for this university."
      action={
        // A three-step wizard rather than the generic create dialog: enrolment
        // spans a person and their academic placement, and performs two writes
        // (a User, then a Student). The reviewer sees what will be created
        // before either happens. Nothing is submitted until the final step.
        <EnrolStudentWizard
          programmes={programmes
            .filter((p) => p.isActive)
            .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          batches={batches.map((b) => ({ value: b.id, label: b.name }))}
          defaultProgrammeId={programmeId}
          defaultBatchId={batchId}
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
    <PageHeader title="Students" subtitle="The enrolment register for this university." />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(result)}
          subject="students"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;
  const hasFilters = Boolean(q || status || programmeId || batchId);

  const columns: TableColumn<StudentWithUser>[] = [
    {
      key: "fullName",
      header: "Student",
      render: (student) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={student.fullName} src={student.user.avatarUrl ?? undefined} size="sm" />
          <div className="min-w-0">
            <Link
              href={`/students/${student.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {student.fullName}
            </Link>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {student.enrollmentNo}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "programmeId",
      header: "Programme",
      render: (student) => (
        <span className="text-muted-foreground">
          {student.programmeId ? (programmeById.get(student.programmeId)?.code ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "batchId",
      header: "Batch",
      render: (student) => (
        <span className="text-muted-foreground">
          {student.batchId ? (batchById.get(student.batchId)?.name ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "currentSemester",
      header: "Sem",
      align: "right",
      render: (student) => student.currentSemester,
    },
    {
      key: "status",
      header: "Status",
      render: (student) => (
        <StatusBadge
          label={STUDENT_STATUS_LABELS[student.status]}
          variant={STUDENT_STATUS_VARIANTS[student.status]}
        />
      ),
    },
    {
      key: "admissionDate",
      header: "Admitted",
      render: (student) => (
        <span className="text-muted-foreground">{formatDate(student.admissionDate)}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (student) => (
        <EntityRowActions
          entityLabel="Student"
          recordName={student.fullName}
          editFields={editFields}
          editValues={{
            enrollmentNo: student.enrollmentNo,
            programmeId: student.programmeId ?? "",
            batchId: student.batchId ?? "",
            currentSemester: student.currentSemester,
            status: student.status,
          }}
          onUpdate={updateStudentAction.bind(null, student.id)}
          // No delete: a student record anchors attendance, results, fees and
          // certificates. Withdrawing or graduating them is the real operation,
          // and that is a status change — which the edit dialog already does.
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch
              unsupported={UNSUPPORTED_SEARCH} placeholder="Search by name or enrolment number…" />}
        filters={
          <>
            <ListFilter
              paramKey="status"
              unsupported={UNSUPPORTED_FILTER}
              label="Status"
              hideLabel
              allLabel="All statuses"
              options={STUDENT_STATUS_VALUES.map((value) => ({
                value,
                label: STUDENT_STATUS_LABELS[value],
              }))}
            />
            <ListFilter
              paramKey="programmeId"
              unsupported={UNSUPPORTED_FILTER}
              label="Programme"
              hideLabel
              allLabel="All programmes"
              options={programmes.map((p) => ({ value: p.id, label: p.code }))}
            />
            <ListFilter
              paramKey="batchId"
              unsupported={UNSUPPORTED_FILTER}
              label="Batch"
              hideLabel
              allLabel="All batches"
              options={batchesForFilter.map((b) => ({ value: b.id, label: b.name }))}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={items}
          rowKey={(student) => student.id}
          emptyState={
            <EmptyState
              icon={<GraduationCap />}
              title={hasFilters ? "No matching students" : "No students yet"}
              description={
                hasFilters
                  ? "No student matches these filters."
                  : "Enrol the first student to start the register."
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
            basePath="/students"
            searchParams={{
              ...(q ? { q } : {}),
              ...(status ? { status } : {}),
              ...(programmeId ? { programmeId } : {}),
              ...(batchId ? { batchId } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} students
          </p>
        </div>
      )}
    </>
  );
}

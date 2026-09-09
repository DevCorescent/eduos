import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { EntityCreateButton } from "@/components/shared/EntityCrud";
import {
  SCHEDULE_ASSESSMENT_DEFAULTS,
  scheduleAssessmentFields,
} from "@/components/shared/assessmentEventFields";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listAssessmentEvents, schedulableComponents } from "@/services/evaluation";
import { allSections, courseIndex, semesterIndex } from "@/services/reference";
import { getPortalSession } from "@/services/session";
import { scheduleAssessmentEventAction } from "@/actions/evaluation";
import { ASSESSMENT_EVENT_MANAGE_ROLES } from "@/lib/constants/assessmentEvent";
import { hasAnyRole } from "@/constants/roles";
import type { AssessmentEventDTO } from "@/lib/dto/assessmentEvent.dto";
import { AssessmentEventStatus } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Assessment Events" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ status?: string; semesterId?: string; page?: string }>;

/**
 * The assessment calendar: every scheduled sitting and its lifecycle.
 *
 * Course and semester names come from the shared reference indexes — the event
 * rows carry ids only. The indexes are request-scoped and shared, so listing
 * twenty events costs one catalogue read rather than twenty.
 *
 * `acceptsMarks` and `isPublished` are DERIVED by the backend and shown as
 * given. Re-deriving them from `status` here would be a second implementation
 * of the lifecycle rules, and the two would disagree the first time a status is
 * added.
 */
export default async function AssessmentEventsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, semesterId, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const session = await getPortalSession();

  // The write half of this screen, gated on the SAME constant the endpoint
  // applies — UNIVERSITY_ADMIN and CONTROLLER_OF_EXAMINATION. This portal also
  // admits DEPARTMENT_HOD and CAMPUS_ADMIN, who read the calendar and do not
  // write it, so a create control rendered unconditionally would be a button
  // that always answers 403. This is presentation, never the authorization:
  // POST /api/assessment-events applies the same set server-side.
  const canSchedule = hasAnyRole(session?.roles ?? [], ASSESSMENT_EVENT_MANAGE_ROLES);

  const [result, courses, semesters, components, sections] = await Promise.all([
    listAssessmentEvents({
      page: currentPage,
      limit: PAGE_SIZE,
      status: status as AssessmentEventDTO["status"] | undefined,
      semesterId,
    }),
    courseIndex(),
    semesterIndex(),
    // The option lists cost nothing for a caller who cannot use them, so they
    // are skipped rather than fetched and discarded.
    canSchedule ? schedulableComponents() : Promise.resolve([]),
    canSchedule ? allSections() : Promise.resolve([]),
  ]);

  const componentOptions = components.map((component) => ({
    value: component.id,
    label: `${component.schemeCode} · ${component.code} — ${component.name}`,
  }));

  const courseOptions = Array.from(courses.values())
    .map((course) => ({ value: course.id, label: `${course.code} — ${course.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const scheduleSemesterOptions = Array.from(semesters.values())
    .map((semester) => ({ value: semester.id, label: semester.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Empty for the examination office, whose role cannot enumerate batches — the
  // field is then omitted rather than shown as an unfillable select. See
  // components/shared/assessmentEventFields.ts.
  const sectionOptions = sections
    .map((section) => ({
      value: section.id,
      label: `${section.batchName} · ${section.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // A sitting names a component, a course and a semester, so all three lists
  // must have something in them. Withholding the control and saying why beats
  // opening a dialog whose selects are empty.
  const canOpenDialog =
    canSchedule &&
    componentOptions.length > 0 &&
    courseOptions.length > 0 &&
    scheduleSemesterOptions.length > 0;

  const header = (
    <PageHeader
      title="Assessment Events"
      subtitle="Scheduled sittings, their status, and the marks recorded against each."
      action={
        canOpenDialog ? (
          <EntityCreateButton
            entityLabel="Assessment"
            label="Schedule assessment"
            fields={scheduleAssessmentFields({
              components: componentOptions,
              courses: courseOptions,
              semesters: scheduleSemesterOptions,
              sections: sectionOptions,
            })}
            initialValues={{ ...SCHEDULE_ASSESSMENT_DEFAULTS }}
            action={scheduleAssessmentEventAction}
            modalSize="lg"
          />
        ) : undefined
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="assessment events"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  const semesterOptions = Array.from(semesters.values()).map((semester) => ({
    value: semester.id,
    label: semester.name,
  }));

  const columns: TableColumn<AssessmentEventDTO>[] = [
    {
      key: "title",
      header: "Sitting",
      render: (event) => (
        <Link
          href={`/evaluation/assessment-events/${event.id}`}
          className="min-w-0 hover:underline"
        >
          <p className="truncate font-medium text-foreground">{event.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            Attempt {event.sequenceNumber} · out of {event.maxMarks}
          </p>
        </Link>
      ),
    },
    {
      key: "course",
      header: "Course",
      render: (event) => {
        const course = courses.get(event.courseId);
        return (
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{course?.name ?? "—"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {course?.code ?? event.courseId}
            </p>
          </div>
        );
      },
    },
    {
      key: "semester",
      header: "Semester",
      render: (event) => (
        <span className="text-sm text-muted-foreground">
          {semesters.get(event.semesterId)?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "scheduledAt",
      header: "Scheduled",
      render: (event) =>
        event.scheduledAt ? (
          formatDate(event.scheduledAt)
        ) : (
          // Unscheduled is a state, not a missing value: the sitting exists and
          // its date has not been fixed.
          <span className="text-muted-foreground">Not scheduled</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (event) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            variant={
              event.isPublished ? "success" : event.acceptsMarks ? "info" : "neutral"
            }
            size="sm"
          >
            {event.status}
          </Badge>
          {event.acceptsMarks && (
            <span className="text-xs text-muted-foreground">accepting marks</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {header}

      {canSchedule && !canOpenDialog && (
        // The reason the Schedule assessment button is absent. Without this the
        // screen looks identical to one where the feature does not exist.
        <Alert variant="info" title="Nothing to schedule against" className="mb-6">
          {componentOptions.length === 0
            ? "A sitting is assessed against a component of an ACTIVE regulation, and no active evaluation scheme has one yet. Activate a scheme under Evaluation → Schemes first."
            : courseOptions.length === 0
              ? "No course exists in this university yet."
              : "No semester exists in this university yet."}
        </Alert>
      )}

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
              options={enumOptions(AssessmentEventStatus)}
            />
          </>
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(event) => event.id}
          emptyState={
            <EmptyState
              icon={<CalendarCheck />}
              title="No sittings"
              description={
                status || semesterId
                  ? "No assessment event matches these filters."
                  : "No assessment has been scheduled yet."
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
            basePath="/evaluation/assessment-events"
            searchParams={{
              ...(status ? { status } : {}),
              ...(semesterId ? { semesterId } : {}),
            }}
          />
        </div>
      )}
    </>
  );
}

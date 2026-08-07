import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listAssessmentEvents } from "@/services/evaluation";
import { courseIndex, semesterIndex } from "@/services/reference";
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

  const [result, courses, semesters] = await Promise.all([
    listAssessmentEvents({
      page: currentPage,
      limit: PAGE_SIZE,
      status: status as AssessmentEventDTO["status"] | undefined,
      semesterId,
    }),
    courseIndex(),
    semesterIndex(),
  ]);

  const header = (
    <PageHeader
      title="Assessment Events"
      subtitle="Scheduled sittings, their status, and the marks recorded against each."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load assessment events" description={result.error} />
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

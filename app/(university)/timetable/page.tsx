import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { EntityCreateButton } from "@/components/shared/EntityCrud";
import { TimetableRowActions } from "@/components/shared/TimetableRowActions";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import {
  SCHEDULE_CLASS_DEFAULTS,
  scheduleClassFields,
} from "@/components/shared/scheduleClassFields";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listTimetable } from "@/services/academics";
import { listAcademicYears, listBatches, listSections, listSemesters } from "@/services/calendar";
import { listCourses } from "@/services/courses";
import { listFaculty } from "@/services/faculty";
import {
  cancelClassAction,
  rescheduleClassAction,
  restoreClassAction,
  scheduleClassAction,
} from "@/actions/academics";
import {
  DAY_OF_WEEK_LABELS,
  DAY_OF_WEEK_SHORT,
  SESSION_TYPE_LABELS,
} from "@/constants/labels";
import { DAY_OF_WEEK_VALUES, SESSION_TYPE_VALUES } from "@/types";
import type { DayOfWeek, TimetableSlot } from "@/types";

export const metadata: Metadata = { title: "Timetable" };

/**
 * The teaching week the grid renders.
 *
 * Five days rather than seven, matching the fixture and every timetable this
 * project has carried. Saturday and Sunday slots are still SCHEDULABLE — the
 * day select offers all seven and the API accepts all seven — and they appear
 * in the list below the grid. Widening the grid to seven columns would give
 * every institution two permanently empty columns to fit on a phone.
 */
const GRID_DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

/**
 * How many slots one page of the schedule shows.
 *
 * Higher than the usual 20 because this list is read as a whole week: a section
 * with six periods a day fills thirty rows before a single filter is applied,
 * and paginating inside one week would split the thing being read.
 */
const PAGE_SIZE = 100;

type SearchParams = Promise<{
  semesterId?: string;
  batchId?: string;
  sectionId?: string;
  courseId?: string;
  facultyId?: string;
  day?: string;
  sessionType?: string;
}>;

/** The period rows of the grid. Derived from the slots on screen, not hardcoded. */
function periodsFrom(slots: TimetableSlot[]): string[] {
  return Array.from(new Set(slots.map((slot) => slot.startTime))).sort();
}

export default async function TimetablePage({ searchParams }: { searchParams: SearchParams }) {
  const { semesterId, batchId, sectionId, courseId, facultyId, day, sessionType } =
    await searchParams;

  // The reference data every control on this page is built from. Issued
  // together — none depends on another, and serialising four round trips
  // behind each other is the difference between a fast page and a slow one.
  const [yearsResult, batchesResult, coursesResult, facultyResult] = await Promise.all([
    listAcademicYears({ page: 1, limit: 100 }),
    listBatches({ page: 1, limit: 100 }),
    listCourses({ page: 1, limit: 100 }),
    listFaculty({ page: 1, limit: 100 }),
  ]);

  const years = yearsResult.success ? yearsResult.data.items : [];
  const batches = batchesResult.success ? batchesResult.data.items : [];
  const courses = coursesResult.success ? coursesResult.data.items : [];
  const faculty = facultyResult.success ? facultyResult.data.items : [];

  // Semesters hang off academic years and sections hang off batches, so neither
  // has a flat tenant-wide endpoint. The Schedule Class dialog needs both flat —
  // a lecturer's class is not confined to whichever batch the filter happens to
  // be showing — so they are gathered across their parents.
  //
  // Bounded by the number of years and batches a tenant has, which is small, and
  // all of them are issued in parallel rather than in sequence.
  const [semesterPages, sectionPages] = await Promise.all([
    Promise.all(years.map((year) => listSemesters(year.id, { page: 1, limit: 100 }))),
    Promise.all(batches.map((batch) => listSections(batch.id, { page: 1, limit: 100 }))),
  ]);

  const semesters = semesterPages.flatMap((page) => (page.success ? page.data.items : []));
  const sections = sectionPages.flatMap((page) => (page.success ? page.data.items : []));

  // Section names are only unique within a batch — @@unique([batchId,
  // semesterId, name]) — so "Section A" alone would be ambiguous across
  // batches. The batch name disambiguates it in both the filter and the form.
  const batchNameById = new Map(batches.map((batch) => [batch.id, batch.name]));
  const sectionLabel = (section: { id: string; name: string; batchId: string }) =>
    `${batchNameById.get(section.batchId) ?? "—"} · Section ${section.name}`;

  // The batch filter narrows the SECTION filter, which is why it exists as a
  // control at all — it is not sent to the API and the route accepts no such
  // parameter. A tenant with several batches would otherwise offer one flat
  // list of every section it has ever run.
  const sectionsForFilter = batchId
    ? sections.filter((section) => section.batchId === batchId)
    : sections;

  const result = await listTimetable({
    page: 1,
    limit: PAGE_SIZE,
    semesterId,
    // A section chosen under one batch and then narrowed by another is dropped
    // rather than sent, so the grid cannot show a section the filter row claims
    // is not selected.
    sectionId:
      sectionId && sectionsForFilter.some((section) => section.id === sectionId)
        ? sectionId
        : undefined,
    courseId,
    facultyId,
    day,
    sessionType,
  });

  const semesterOptions = semesters.map((semester) => ({
    value: semester.id,
    label: semester.name,
  }));
  const sectionOptions = sections.map((section) => ({
    value: section.id,
    label: sectionLabel(section),
  }));
  const courseOptions = courses.map((course) => ({
    value: course.id,
    label: `${course.code} — ${course.name}`,
  }));
  const facultyOptions = faculty.map((member) => ({
    value: member.id,
    label: `${member.fullName} (${member.employeeId})`,
  }));

  const formFields = scheduleClassFields({
    semesters: semesterOptions,
    sections: sectionOptions,
    courses: courseOptions,
    // An administrator schedules on anyone's behalf within their tenant, so the
    // picker is present here and absent on the faculty form.
    faculty: facultyOptions,
  });

  const header = (
    <PageHeader
      title="Timetable"
      subtitle="Class scheduling across the university."
      action={
        <EntityCreateButton
          entityLabel="Class"
          label="Schedule class"
          fields={formFields}
          initialValues={{ ...SCHEDULE_CLASS_DEFAULTS }}
          action={scheduleClassAction}
          modalSize="lg"
        />
      }
    />
  );

  /**
   * The same header with its scheduling control withheld.
   *
   * Rendered when the list request itself failed. A 403 there means this role
   * has no access to the schedule at all, so a "Schedule class" button beside
   * the refusal would offer an action the backend will reject — the control
   * would be a claim the API does not honour.
   */
  const failureHeader = (
    <PageHeader title="Timetable" subtitle="Class scheduling across the university." />
  );

  const toolbar = (
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
            paramKey="batchId"
            label="Batch"
            hideLabel
            allLabel="All batches"
            options={batches.map((batch) => ({ value: batch.id, label: batch.name }))}
          />
          <ListFilter
            paramKey="sectionId"
            label="Section"
            hideLabel
            allLabel="All sections"
            options={sectionsForFilter.map((section) => ({
              value: section.id,
              label: sectionLabel(section),
            }))}
          />
          <ListFilter
            paramKey="courseId"
            label="Course"
            hideLabel
            allLabel="All courses"
            options={courses.map((course) => ({ value: course.id, label: course.code }))}
          />
          <ListFilter
            paramKey="facultyId"
            label="Faculty"
            hideLabel
            allLabel="All faculty"
            options={facultyOptions}
          />
          <ListFilter
            paramKey="day"
            label="Day"
            hideLabel
            allLabel="All days"
            options={DAY_OF_WEEK_VALUES.map((value) => ({
              value,
              label: DAY_OF_WEEK_LABELS[value],
            }))}
          />
          <ListFilter
            paramKey="sessionType"
            label="Session type"
            hideLabel
            allLabel="All session types"
            options={SESSION_TYPE_VALUES.map((value) => ({
              value,
              label: SESSION_TYPE_LABELS[value],
            }))}
          />
        </>
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {failureHeader}
        {toolbar}
        <StateView
          state={resolveFailureState(result)}
          subject="the timetable"
          message={result.error}
        />
      </>
    );
  }

  const slots = result.data.items;
  const hasFilters = Boolean(
    semesterId || sectionId || courseId || facultyId || day || sessionType
  );

  // The GRID shows live classes only. A cancelled slot occupies no period, so
  // painting it into the week would claim a class is happening that is not —
  // and the row below carries the cancelled ones, where the badge says so and
  // the restore action is available.
  const activeSlots = slots.filter((slot) => slot.isActive);
  const periods = periodsFrom(activeSlots);

  // Keyed "DAY|HH:MM" so a cell is one lookup rather than a scan of every slot
  // per cell — a 5×6 grid would otherwise be thirty linear searches.
  //
  // An array per cell, not a single slot. Two classes CAN share a period once
  // they are for different sections, which is ordinary as soon as the section
  // filter is not set, and keying one slot per cell would silently hide the
  // rest.
  const byCell = new Map<string, TimetableSlot[]>();
  for (const slot of activeSlots) {
    const key = `${slot.day}|${slot.startTime}`;
    byCell.set(key, [...(byCell.get(key) ?? []), slot]);
  }

  /** The values an edit dialog opens on, for one existing slot. */
  const editValues = (slot: TimetableSlot) => ({
    semesterId: slot.semesterId,
    sectionId: slot.sectionId,
    courseId: slot.courseId,
    facultyId: slot.facultyId,
    day: slot.day,
    startTime: slot.startTime,
    endTime: slot.endTime,
    roomNo: slot.roomNo ?? "",
    sessionType: slot.sessionType,
  });

  const columns: TableColumn<TimetableSlot>[] = [
    {
      key: "course",
      header: "Course",
      render: (slot) => (
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-foreground">{slot.courseCode}</p>
          <p className="truncate text-xs text-muted-foreground">{slot.courseName}</p>
        </div>
      ),
    },
    {
      key: "sectionId",
      header: "Section",
      render: (slot) => (
        <span className="text-muted-foreground">{slot.sectionName ?? "—"}</span>
      ),
    },
    {
      key: "facultyName",
      header: "Faculty",
      render: (slot) => <span className="text-muted-foreground">{slot.facultyName}</span>,
    },
    {
      key: "day",
      header: "When",
      render: (slot) => (
        <span className="whitespace-nowrap">
          {DAY_OF_WEEK_SHORT[slot.day]}{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {slot.startTime}–{slot.endTime}
          </span>
        </span>
      ),
    },
    {
      key: "roomNo",
      header: "Room",
      render: (slot) => <span className="text-muted-foreground">{slot.roomNo ?? "—"}</span>,
    },
    {
      key: "sessionType",
      header: "Type",
      render: (slot) => (
        <Badge variant="neutral" size="sm">
          {SESSION_TYPE_LABELS[slot.sessionType]}
        </Badge>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (slot) => (
        <StatusBadge
          label={slot.isActive ? "Scheduled" : "Cancelled"}
          variant={slot.isActive ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (slot) => (
        // TimetableRowActions rather than EntityRowActions: cancelling a class
        // is not a delete. The row survives with isActive false, because
        // Attendance references Timetable and destroying the slot would orphan
        // every register already taken against it — and a cancelled class is
        // restored from the same control. See that component for the full note.
        <TimetableRowActions
          recordName={`${slot.courseCode} · ${DAY_OF_WEEK_SHORT[slot.day]} ${slot.startTime}`}
          fields={formFields}
          values={editValues(slot)}
          onReschedule={rescheduleClassAction.bind(null, slot.id)}
          isActive={slot.isActive}
          onCancel={cancelClassAction.bind(null, slot.id)}
          onRestore={restoreClassAction.bind(null, slot.id)}
        />
      ),
    },
  ];

  return (
    <>
      {header}
      {toolbar}

      {sections.length === 0 && (
        <Alert variant="warning" title="No sections yet" className="mb-4">
          A class is scheduled for a section. Create a batch and a section before
          scheduling.
        </Alert>
      )}

      {slots.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title={hasFilters ? "No matching classes" : "No classes scheduled"}
            description={
              hasFilters
                ? "No scheduled class matches these filters."
                : "Use Schedule class to put the first class on the timetable."
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {activeSlots.length > 0 && (
            <Card noPadding>
              {/* The grid scrolls horizontally inside its own container rather
                  than letting the page scroll sideways — a five-day week with
                  named courses cannot fit a phone otherwise. */}
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[52rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th
                        scope="col"
                        className="w-24 px-3 py-3 text-left font-medium text-muted-foreground"
                      >
                        Time
                      </th>
                      {GRID_DAYS.map((gridDay) => (
                        <th
                          key={gridDay}
                          scope="col"
                          className="px-3 py-3 text-left font-medium text-muted-foreground"
                        >
                          {DAY_OF_WEEK_SHORT[gridDay]}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {periods.map((start) => (
                      <tr key={start} className="border-b border-border last:border-0">
                        <th
                          scope="row"
                          className="whitespace-nowrap px-3 py-3 text-left align-top font-mono text-xs font-normal text-muted-foreground"
                        >
                          {start}
                        </th>

                        {GRID_DAYS.map((gridDay) => {
                          const cell = byCell.get(`${gridDay}|${start}`) ?? [];

                          return (
                            <td key={gridDay} className="px-2 py-2 align-top">
                              {cell.length > 0 ? (
                                <div className="flex flex-col gap-1.5">
                                  {cell.map((slot) => (
                                    <div
                                      key={slot.id}
                                      className="rounded-md border border-border bg-primary-bg/40 p-2"
                                    >
                                      <p className="font-mono text-xs font-medium text-primary-bg-foreground">
                                        {slot.courseCode}
                                      </p>
                                      <p className="mt-0.5 line-clamp-2 text-xs text-foreground">
                                        {slot.courseName}
                                      </p>
                                      <p className="mt-1 truncate text-xs text-muted-foreground">
                                        {slot.facultyName}
                                      </p>
                                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                        {slot.sectionName && <span>{slot.sectionName}</span>}
                                        {slot.roomNo && <span>{slot.roomNo}</span>}
                                        {slot.sessionType !== "LECTURE" && (
                                          <span className="rounded bg-muted px-1">
                                            {SESSION_TYPE_LABELS[slot.sessionType]}
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                // A free period is left visibly empty rather
                                // than blank, so the grid reads as a schedule
                                // with gaps rather than as missing data.
                                <div className="rounded-md border border-dashed border-border/60 p-2 text-center text-xs text-muted-foreground/60">
                                  Free
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* The grid shows the week; this shows every scheduled class as a row
              with its own actions — including the cancelled ones the grid
              cannot represent, and any weekend slot the five-day grid omits. */}
          <Card noPadding>
            <Table
              minWidthClassName="min-w-[60rem]"
              columns={columns}
              data={slots}
              rowKey={(slot) => slot.id}
              emptyState={
                <EmptyState
                  icon={<CalendarDays />}
                  title="No classes scheduled"
                  description="Use Schedule class to put the first class on the timetable."
                />
              }
            />
          </Card>

          <p className="text-xs text-muted-foreground">
            Showing {slots.length} scheduled {slots.length === 1 ? "class" : "classes"}
            {result.data.pagination.total > slots.length
              ? ` of ${result.data.pagination.total}. Narrow the filters to see the rest.`
              : "."}
          </p>
        </div>
      )}
    </>
  );
}

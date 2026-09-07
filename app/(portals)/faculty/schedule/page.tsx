import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EntityCreateButton } from "@/components/shared/EntityCrud";
import { TimetableRowActions } from "@/components/shared/TimetableRowActions";
import {
  SCHEDULE_MY_CLASS_DEFAULTS,
  encodeTeachingOption,
  scheduleMyClassFields,
} from "@/components/shared/scheduleClassFields";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable, getMyTeaching } from "@/services/academics";
import {
  cancelClassAction,
  rescheduleMyClassAction,
  restoreClassAction,
  scheduleMyClassAction,
} from "@/actions/academics";
import { DAY_OF_WEEK_SHORT, SESSION_TYPE_LABELS } from "@/constants/labels";
import { formatNumber } from "@/utils/format";
import type { DayOfWeek, TimetableSlot } from "@/types";

export const metadata: Metadata = { title: "My Schedule" };

/**
 * The teaching week the grid renders.
 *
 * Five days, matching the administrator's Timetable page. A weekend class is
 * still schedulable and still appears in the list below the grid — see that
 * page for why the grid itself stays at five columns.
 */
const GRID_DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

export default async function FacultySchedulePage() {
  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  // Both are the caller's own data and neither depends on the other.
  const [result, teachingResult] = await Promise.all([
    getFacultyTimetable(faculty.id),
    getMyTeaching(),
  ]);

  // A failure here is not fatal to the page — the schedule below still renders.
  // It only means the Schedule class dialog has nothing valid to offer, which
  // is handled by withholding the control rather than by blocking the screen.
  const teaching = teachingResult.success ? teachingResult.data : [];

  // Only the pairs that carry a semester. The scheduling API requires one and
  // an assignment may legitimately have none, so an option without it would be
  // a choice that always fails — see decodeTeachingOption.
  const teachingOptions = teaching
    .filter((option) => option.semesterId)
    .map((option) => ({
      value: encodeTeachingOption(option),
      label: `${option.courseCode} — ${option.courseName} · Section ${option.sectionName}`,
    }));

  const formFields = scheduleMyClassFields(teachingOptions);

  const canSchedule = teachingOptions.length > 0;

  const header = (
    <PageHeader
      title="My Schedule"
      subtitle="Your teaching week across every section you take."
      action={
        // Withheld when there is nothing valid to schedule. A button that opens
        // a dialog whose only select is empty is a control that cannot be used,
        // and the Alert below says why rather than leaving the user guessing.
        canSchedule ? (
          <EntityCreateButton
            entityLabel="Class"
            label="Schedule class"
            fields={formFields}
            initialValues={{ ...SCHEDULE_MY_CLASS_DEFAULTS }}
            // The lecturer's own FacultyMember id, bound on the server so it is
            // never a mutable value in the client payload. The API refuses a
            // mismatch regardless — it resolves the caller's id from the session
            // and compares — so this is convenience, not the authorization.
            action={scheduleMyClassAction.bind(null, faculty.id)}
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
        <ErrorState title="Schedule service is currently unavailable" description={result.error} />
      </>
    );
  }

  const slots = result.data;
  const activeSlots = slots.filter((slot) => slot.isActive);
  const periods = Array.from(new Set(activeSlots.map((slot) => slot.startTime))).sort();

  // Keyed lookup rather than a scan per cell — a 5×6 grid would otherwise be
  // thirty linear searches over the whole week. An array per cell, because a
  // lecturer can legitimately hold two slots at one time across two sections
  // and keying one would silently hide the clash rather than showing it.
  const byCell = new Map<string, TimetableSlot[]>();
  for (const slot of activeSlots) {
    const key = `${slot.day}|${slot.startTime}`;
    byCell.set(key, [...(byCell.get(key) ?? []), slot]);
  }

  const distinctCourses = new Set(activeSlots.map((slot) => slot.courseId)).size;
  const busiestDay = GRID_DAYS.reduce<{ day: DayOfWeek; count: number }>(
    (busiest, day) => {
      const count = activeSlots.filter((slot) => slot.day === day).length;
      return count > busiest.count ? { day, count } : busiest;
    },
    { day: "MONDAY", count: 0 }
  );

  /** The values an edit dialog opens on, for one of this lecturer's slots. */
  const editValues = (slot: TimetableSlot) => ({
    teaching: encodeTeachingOption(slot),
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
        // Every one of these slots is already this lecturer's own — the endpoint
        // that produced them is confined to the caller's own record — and the
        // API re-checks ownership on the merged pair for every write, so a
        // tampered request reaches a 403 rather than a colleague's class.
        <TimetableRowActions
          recordName={`${slot.courseCode} · ${DAY_OF_WEEK_SHORT[slot.day]} ${slot.startTime}`}
          fields={formFields}
          values={editValues(slot)}
          onReschedule={rescheduleMyClassAction.bind(null, slot.id)}
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

      {!canSchedule && (
        <Alert variant="info" title="No classes assigned to you yet" className="mb-4">
          You can schedule a class once a course and section are assigned to you.
          Ask an administrator to add the assignment.
        </Alert>
      )}

      {slots.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title="No classes scheduled"
            description={
              canSchedule
                ? "Use Schedule class to put your first class on the timetable."
                : "Once courses are assigned to you and timetabled, your week appears here."
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Classes a Week" value={formatNumber(activeSlots.length)} />
            <StatCard label="Courses" value={formatNumber(distinctCourses)} />
            <StatCard
              label="Busiest Day"
              value={DAY_OF_WEEK_SHORT[busiestDay.day]}
              caption={`${busiestDay.count} classes`}
            />
          </div>

          {activeSlots.length > 0 && (
            <Card className="mt-6" noPadding>
              {/* Scrolls inside its own container so the page never scrolls
                  sideways on a phone. */}
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
                      {GRID_DAYS.map((day) => (
                        <th
                          key={day}
                          scope="col"
                          className="px-3 py-3 text-left font-medium text-muted-foreground"
                        >
                          {DAY_OF_WEEK_SHORT[day]}
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

                        {GRID_DAYS.map((day) => {
                          const cell = byCell.get(`${day}|${start}`) ?? [];

                          return (
                            <td key={day} className="px-2 py-2 align-top">
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
                                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
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

          {/* The grid shows the week; this shows every class as a row with its
              own actions — including the cancelled ones the grid cannot
              represent, and any weekend slot the five-day grid omits. */}
          <Card className="mt-4" noPadding>
            <Table
              minWidthClassName="min-w-[44rem]"
              columns={columns}
              data={slots}
              rowKey={(slot) => slot.id}
              emptyState={
                <EmptyState
                  icon={<CalendarDays />}
                  title="No classes scheduled"
                  description="Use Schedule class to put your first class on the timetable."
                />
              }
            />
          </Card>
        </>
      )}
    </>
  );
}

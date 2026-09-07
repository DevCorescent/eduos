import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card } from "@/components/ui/Card";
import { getPortalSession } from "@/services/session";
import { getStudentTimetable } from "@/services/academics";
import { DAY_OF_WEEK_SHORT, SESSION_TYPE_LABELS } from "@/constants/labels";
import type { DayOfWeek, TimetableSlot } from "@/types";

export const metadata: Metadata = { title: "My Timetable" };

/**
 * The teaching week the grid renders.
 *
 * Five days, matching the administrator and faculty grids. A weekend class is
 * schedulable and appears in the day list below rather than being lost.
 */
const GRID_DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

/**
 * Student timetable.
 *
 * WHAT THIS PAGE USED TO BE
 *   A permanent "not available" state, and correctly so at the time: the only
 *   endpoint returning a section's schedule was
 *   GET /api/timetables/section/[sectionId], which is
 *   requireRole("UNIVERSITY_ADMIN") — so a signed-in student was answered 403
 *   for their own timetable and there was no request this page could make.
 *
 *   GET /api/student/timetable is that endpoint. It resolves the student from
 *   their session, reads the ACTIVE slots of the section they sit in, and takes
 *   no id of any kind — so this page cannot be pointed at anybody else.
 *
 * A CANCELLED CLASS NEVER APPEARS HERE. The endpoint filters them out, because
 * a cancelled class shown on a personal timetable is an instruction to attend
 * something that is not happening. The notification is what tells the student it
 * was cancelled; the timetable simply stops showing it.
 */
export default async function StudentTimetablePage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const result = await getStudentTimetable();

  const header = (
    <PageHeader title="My Timetable" subtitle="Your weekly class schedule." />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState
          title="Timetable is currently unavailable"
          description={result.error}
        />
      </>
    );
  }

  const slots = result.data;
  const periods = Array.from(new Set(slots.map((slot) => slot.startTime))).sort();

  // Keyed lookup rather than a scan per cell. An array per cell, because a
  // section can hold two entries at one period — a lab split across groups is
  // the ordinary case — and keying one would hide the other.
  const byCell = new Map<string, TimetableSlot[]>();
  for (const slot of slots) {
    const key = `${slot.day}|${slot.startTime}`;
    byCell.set(key, [...(byCell.get(key) ?? []), slot]);
  }

  // Weekend classes are real and the five-day grid has no column for them, so
  // they are listed underneath rather than dropped.
  const weekendSlots = slots.filter((slot) => !GRID_DAYS.includes(slot.day));

  if (slots.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title="No classes scheduled"
            // Deliberately not "your timetable is empty". A student with no
            // section has no timetable to be empty, and one whose section has
            // not been timetabled yet is waiting on an administrator — both
            // read the same from here, and both are resolved by asking.
            description="Nothing has been scheduled for your section yet. It will appear here as soon as it is."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      <Card noPadding>
        {/* Scrolls inside its own container so the page never scrolls sideways
            on a phone. */}
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
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  {slot.facultyName}
                                </p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
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
                          // A free period is left visibly empty rather than
                          // blank, so the grid reads as a schedule with gaps
                          // rather than as missing data.
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

      {weekendSlots.length > 0 && (
        <Card className="mt-4">
          <h2 className="text-sm font-medium text-foreground">Weekend classes</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {weekendSlots.map((slot) => (
              <li key={slot.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-foreground">
                  {DAY_OF_WEEK_SHORT[slot.day]}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {slot.startTime}–{slot.endTime}
                </span>
                <span className="font-mono text-xs text-foreground">{slot.courseCode}</span>
                <span className="text-xs text-muted-foreground">{slot.courseName}</span>
                {slot.roomNo && (
                  <span className="text-xs text-muted-foreground">{slot.roomNo}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

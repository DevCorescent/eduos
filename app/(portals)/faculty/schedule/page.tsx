import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable } from "@/services/academics";
import { DAY_OF_WEEK_SHORT, SESSION_TYPE_LABELS } from "@/constants/labels";
import { formatNumber } from "@/utils/format";
import type { DayOfWeek, TimetableSlot } from "@/types";

export const metadata: Metadata = { title: "My Schedule" };

const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

export default async function FacultySchedulePage() {
  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const result = await getFacultyTimetable(faculty.id);

  const header = (
    <PageHeader
      title="My Schedule"
      subtitle="Your teaching week across every section you take."
    />
  );

  // A FORBIDDEN here is not a failure that might clear — it is the permanent
  // shape of the API. GET /api/timetables/faculty/[id] is requireRole
  // ("UNIVERSITY_ADMIN"), verified against the running server, so a lecturer is
  // refused even for their OWN id. That is the fourth state, not the third:
  // rendering "Couldn't load your schedule" invited a retry that can never
  // succeed and implied a fault where there is none.
  if (!result.success && result.code === "FORBIDDEN") {
    return (
      <>
        {header}
        <Card noPadding>
          <UnavailableState
            title="Your schedule is not available yet"
            description="The timetable API is currently restricted to administrators, so there is no endpoint a lecturer can read their own schedule from. This page will fill in as soon as that access is opened up."
          />
        </Card>
      </>
    );
  }

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Schedule service is currently unavailable" description={result.error} />
      </>
    );
  }

  const slots = result.data;
  const periods = Array.from(new Set(slots.map((slot) => slot.startTime))).sort();

  // Keyed lookup rather than a scan per cell — a 5×6 grid would otherwise be
  // thirty linear searches over the whole week.
  const byCell = new Map<string, TimetableSlot>();
  for (const slot of slots) byCell.set(`${slot.day}|${slot.startTime}`, slot);

  const distinctCourses = new Set(slots.map((slot) => slot.courseId)).size;
  const busiestDay = DAYS.reduce<{ day: DayOfWeek; count: number }>(
    (busiest, day) => {
      const count = slots.filter((slot) => slot.day === day).length;
      return count > busiest.count ? { day, count } : busiest;
    },
    { day: "MONDAY", count: 0 }
  );

  if (slots.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title="No classes scheduled"
            description="Once courses are assigned to you and timetabled, your week appears here."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Classes a Week" value={formatNumber(slots.length)} />
        <StatCard label="Courses" value={formatNumber(distinctCourses)} />
        <StatCard
          label="Busiest Day"
          value={DAY_OF_WEEK_SHORT[busiestDay.day]}
          caption={`${busiestDay.count} classes`}
        />
      </div>

      <Card className="mt-6" noPadding>
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
                {DAYS.map((day) => (
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

                  {DAYS.map((day) => {
                    const slot = byCell.get(`${day}|${start}`);

                    return (
                      <td key={day} className="px-2 py-2 align-top">
                        {slot ? (
                          <div className="rounded-md border border-border bg-primary-bg/40 p-2">
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

      <p className="mt-4 text-xs text-muted-foreground">
        Read-only. Rescheduling is handled by the academic office through the university
        timetable.
      </p>
    </>
  );
}

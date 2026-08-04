import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { getSectionTimetable } from "@/services/academics";
import { listAcademicYears, listBatches, listSections } from "@/services/calendar";
import { DAY_OF_WEEK_SHORT, SESSION_TYPE_LABELS } from "@/constants/labels";
import type { DayOfWeek, TimetableSlot } from "@/types";

export const metadata: Metadata = { title: "Timetable" };

type SearchParams = Promise<{ sectionId?: string; batchId?: string }>;

/** Mirrors the fixture's teaching week. Saturday and Sunday are not taught. */
const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

/** The period grid. Derived from the slots on screen, not hardcoded. */
function periodsFrom(slots: TimetableSlot[]): string[] {
  const starts = new Set(slots.map((slot) => slot.startTime));
  return Array.from(starts).sort();
}

export default async function TimetablePage({ searchParams }: { searchParams: SearchParams }) {
  const { sectionId, batchId } = await searchParams;

  const [batchesResult, yearsResult] = await Promise.all([
    listBatches({ page: 1, limit: 100 }),
    listAcademicYears({ page: 1, limit: 100 }),
  ]);

  const batches = batchesResult.success ? batchesResult.data.items : [];
  const currentYear = yearsResult.success
    ? yearsResult.data.items.find((year) => year.isCurrent)
    : undefined;

  // Sections belong to a batch, so the section list can only be built once a
  // batch is chosen — which is why the batch selector comes first.
  //
  // The default is a *current-year* batch, not simply the first one. Sections
  // and timetables only exist for the current semester, so defaulting to the
  // oldest batch opened the page on an empty grid that looked like a bug.
  const defaultBatch =
    batches.find((batch) => batch.academicYearId === currentYear?.id) ?? batches[0];
  const selectedBatchId = batchId ?? defaultBatch?.id;
  const sectionsResult = selectedBatchId
    ? await listSections(selectedBatchId, { page: 1, limit: 100 })
    : null;
  const sections = sectionsResult?.success ? sectionsResult.data.items : [];

  const selectedSectionId = sectionId ?? sections[0]?.id;
  const timetableResult = selectedSectionId
    ? await getSectionTimetable(selectedSectionId)
    : null;

  const header = (
    <PageHeader
      title="Timetable"
      subtitle="The weekly class schedule for one section."
    />
  );

  const toolbar = (
    <ListToolbar
      filters={
        <>
          <ListFilter
            paramKey="batchId"
            label="Batch"
            hideLabel
            allLabel="Select a batch"
            options={batches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <ListFilter
            paramKey="sectionId"
            label="Section"
            hideLabel
            allLabel="Select a section"
            options={sections.map((s) => ({ value: s.id, label: `Section ${s.name}` }))}
          />
        </>
      }
    />
  );

  if (timetableResult && !timetableResult.success) {
    return (
      <>
        {header}
        {toolbar}
        <ErrorState title="Couldn't load the timetable" description={timetableResult.error} />
      </>
    );
  }

  const slots = timetableResult?.success ? timetableResult.data : [];
  const periods = periodsFrom(slots);

  // Keyed by "DAY|HH:MM" so a cell is one map lookup rather than a scan of
  // every slot per cell — a 5×6 grid would otherwise be 30 linear searches.
  const byCell = new Map<string, TimetableSlot>();
  for (const slot of slots) {
    byCell.set(`${slot.day}|${slot.startTime}`, slot);
  }

  return (
    <>
      {header}
      {toolbar}

      {sections.length === 0 && (
        <Alert variant="warning" title="No sections in this batch" className="mb-4">
          A timetable belongs to a section. Add one to this batch first.
        </Alert>
      )}

      {slots.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title="No classes scheduled"
            description="This section has no timetable for the current semester yet."
          />
        </Card>
      ) : (
        <Card noPadding>
          {/* The grid scrolls horizontally inside its own container rather than
              letting the page scroll sideways — a five-day week with named
              courses cannot fit a phone otherwise. */}
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
      )}
    </>
  );
}

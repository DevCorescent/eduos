import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Card } from "@/components/ui/Card";
import { childTimetable } from "@/services/parentPortal";
import { resolveChildContext, NoChildren } from "../childContext";
import { ParentPageHeader } from "../ParentPage";

export const metadata: Metadata = { title: "Timetable" };
type SearchParams = Promise<{ child?: string }>;

/** Monday first, matching how a week is read. */
const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/** PRD §32 "Timetable" — the child's section timetable, grouped by day. */
export default async function ParentTimetablePage({ searchParams }: { searchParams: SearchParams }) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);
  if (context.kind === "failed") return context.node;
  if (context.kind === "empty") return <NoChildren />;

  const result = await childTimetable(context.selected.studentId);

  return (
    <>
      <ParentPageHeader
        title="Timetable"
        subtitle="Weekly schedule"
        childList={context.children}
        selected={context.selected}
      />

      {!result.success ? (
        <StateView state={resolveFailureState(result)} subject="timetable" message={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="No timetable"
          // Names the actual reason rather than implying an error: a student
          // with no section genuinely has no timetable to show.
          description="No timetable is published for this child's section yet."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {DAY_ORDER.map((day) => {
            const slots = result.data.filter((s) => s.day === day);
            if (slots.length === 0) return null;

            return (
              <Card key={day}>
                <h2 className="text-sm font-semibold text-heading">
                  {day.charAt(0) + day.slice(1).toLowerCase()}
                </h2>
                <ul className="mt-2 divide-y divide-border">
                  {slots.map((slot) => (
                    <li key={slot.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                      <span className="font-mono text-sm text-foreground">
                        {slot.startTime}–{slot.endTime}
                      </span>
                      <span className="text-sm text-foreground">
                        <span className="font-mono text-xs text-muted-foreground">
                          {slot.course.code}
                        </span>{" "}
                        {slot.course.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {slot.faculty.user.firstName} {slot.faculty.user.lastName}
                        {slot.roomNo ? ` · Room ${slot.roomNo}` : ""} · {slot.sessionType}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

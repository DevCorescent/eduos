import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable, getSectionRoster } from "@/services/academics";
import {
  getMarksSheet,
  listAssessmentEvents,
  listRegistrations,
} from "@/services/evaluation";
import { resolveFailureState } from "@/lib/ui-state";
import { MarksEntryForm, type MarksEntryRow } from "./MarksEntryForm";

export const metadata: Metadata = { title: "Evaluation" };

type SearchParams = Promise<{ class?: string; event?: string }>;

/**
 * Marks entry for a sitting this lecturer conducts.
 *
 * WHY THIS SCREEN EXISTS
 *   POST /api/results/internal has admitted FACULTY, and confined them to the
 *   sittings they conduct, since Phase C6. Until now nothing could reach it:
 *   the university-side sitting page states that "uploads are made through the
 *   internal or external marks endpoints". Recording a mark was an API-only
 *   capability, which is to say not a capability a lecturer had.
 *
 * THE THREE-WAY JOIN, AND WHY IT IS NEEDED
 *   A marks sheet is keyed by courseRegistrationId and carries no name, while a
 *   roster is keyed by studentId and carries no registration. Neither alone can
 *   render a usable grid, so this page joins:
 *
 *     registrations  (registrationId ↔ studentId)   — who is enrolled
 *     roster         (studentId → name, enrolment)  — who they are
 *     marks sheet    (registrationId → mark)        — what is already recorded
 *
 *   All three endpoints already admit FACULTY; no new API was added.
 *
 * AUTHORIZATION IS SERVER-SIDE, EVERYWHERE
 *   The class picker is built from the caller's own timetable, the roster call
 *   re-proves the (section, course) relationship, and the upload itself is
 *   confined to the conductor by MarkUploadAuthority. Nothing on this page is
 *   trusted to decide any of that.
 */
export default async function FacultyEvaluationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { class: selectedKey, event: selectedEventId } = await searchParams;

  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const timetableResult = await getFacultyTimetable(faculty.id);

  const header = (
    <PageHeader
      title="Evaluation"
      subtitle="Record internal assessment marks for a sitting you conduct."
    />
  );

  if (!timetableResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(timetableResult)}
          subject="your classes"
          message={timetableResult.error}
        />
      </>
    );
  }

  const classes = Array.from(
    new Map(
      timetableResult.data.map((slot) => [
        `${slot.sectionId}|${slot.courseId}`,
        {
          value: `${slot.sectionId}|${slot.courseId}`,
          label: `${slot.courseCode} — ${slot.courseName}`,
          sectionId: slot.sectionId,
          courseId: slot.courseId,
          semesterId: slot.semesterId,
        },
      ])
    ).values()
  );

  if (classes.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No classes assigned"
          description="Once courses are allocated to you and timetabled, their sittings appear here."
        />
      </>
    );
  }

  const selected = classes.find((entry) => entry.value === selectedKey) ?? classes[0];

  const eventsResult = await listAssessmentEvents({
    courseId: selected.courseId,
    sectionId: selected.sectionId,
    semesterId: selected.semesterId,
    limit: 100,
  });

  const classFilter = (
    <ListFilter
      paramKey="class"
      label="Class"
      hideLabel
      allLabel="Select a class"
      options={classes.map((entry) => ({ value: entry.value, label: entry.label }))}
    />
  );

  if (!eventsResult.success) {
    return (
      <>
        {header}
        <ListToolbar filters={classFilter} />
        <StateView
          state={resolveFailureState(eventsResult)}
          subject="sittings"
          message={eventsResult.error}
        />
      </>
    );
  }

  const events = eventsResult.data.items;

  if (events.length === 0) {
    return (
      <>
        {header}
        <ListToolbar filters={classFilter} />
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No sittings scheduled"
          description="The examination office schedules sittings against the evaluation scheme. Once one exists for this class, its marks grid appears here."
        />
      </>
    );
  }

  const event = events.find((item) => item.id === selectedEventId) ?? events[0];

  const toolbar = (
    <ListToolbar
      filters={
        <>
          {classFilter}
          <ListFilter
            paramKey="event"
            label="Sitting"
            hideLabel
            allLabel="Select a sitting"
            options={events.map((item) => ({ value: item.id, label: item.title }))}
          />
        </>
      }
    />
  );

  const [registrationsResult, rosterResult, sheetResult] = await Promise.all([
    // 100 is the ceiling listCourseRegistrationsQuerySchema allows; asking for
    // more is a 400, not a bigger page. A cohort beyond that needs paging here,
    // which is noted in the report rather than half-built.
    listRegistrations({
      courseId: selected.courseId,
      sectionId: selected.sectionId,
      semesterId: selected.semesterId,
      limit: 100,
    }),
    getSectionRoster(selected.sectionId, selected.courseId),
    getMarksSheet(event.id),
  ]);

  // Each failure is reported as itself. Collapsing any of them into an empty
  // grid would tell the lecturer their class has no students, which would be
  // false and would invite them to re-enter marks that already exist.
  for (const [result, subject] of [
    [registrationsResult, "enrolments"],
    [rosterResult, "students"],
    [sheetResult, "the marks sheet"],
  ] as const) {
    if (!result.success) {
      return (
        <>
          {header}
          {toolbar}
          <StateView
            state={resolveFailureState(result)}
            subject={subject}
            message={result.error}
          />
        </>
      );
    }
  }

  // Narrowed by the loop above; re-read for TypeScript.
  if (!registrationsResult.success || !rosterResult.success || !sheetResult.success) {
    return null;
  }

  const nameByStudent = new Map(
    rosterResult.data.map((student) => [
      student.studentId,
      {
        name: `${student.firstName} ${student.lastName}`.trim(),
        enrollmentNo: student.enrollmentNo,
      },
    ])
  );

  const markByRegistration = new Map(
    sheetResult.data.entries.map((entry) => [entry.courseRegistrationId, entry])
  );

  const rows: MarksEntryRow[] = registrationsResult.data.items
    // A withdrawn or cancelled enrolment is not sat, so it is not marked.
    .filter((registration) => registration.isActive)
    .map((registration) => {
      const person = nameByStudent.get(registration.studentId);
      const existing = markByRegistration.get(registration.id);

      return {
        courseRegistrationId: registration.id,
        enrollmentNo: person?.enrollmentNo ?? "—",
        name: person?.name ?? "Unknown student",
        marksObtained: existing?.marksObtained ?? "",
        absent: existing?.status === "ABSENT",
      };
    })
    .sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo));

  return (
    <>
      {header}
      {toolbar}

      <Card
        className="mb-4"
        header={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-heading">{event.title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected.label} · out of {event.maxMarks}
              </p>
            </div>
            <Badge variant={event.acceptsMarks ? "success" : "neutral"}>
              {event.status}
            </Badge>
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          {sheetResult.data.recordedCount} recorded ·{" "}
          {sheetResult.data.absentCount} absent · {rows.length} enrolled
        </p>
      </Card>

      <MarksEntryForm
        assessmentEventId={event.id}
        maxMarks={Number(event.maxMarks)}
        rows={rows}
        acceptsMarks={event.acceptsMarks}
      />
    </>
  );
}

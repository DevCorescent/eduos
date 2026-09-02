import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getCurrentFaculty } from "@/services/portal";
import { getFacultyTimetable, getSectionRoster } from "@/services/academics";
import { resolveFailureState } from "@/lib/ui-state";

export const metadata: Metadata = { title: "My Students" };

type SearchParams = Promise<{ class?: string }>;

/**
 * The students in a class this lecturer teaches.
 *
 * NOT THE INSTITUTIONAL STUDENT LIST.
 *   /api/students is the registry and is closed to FACULTY. This page reads
 *   /api/sections/[id]/roster instead, which is class-scoped and proves the
 *   caller teaches the exact (section, course) pair — against Timetable or
 *   FacultyCourseAssignment — before returning a single name.
 *
 *   That is why BOTH ids travel on the request: the courseId is not a filter,
 *   it is half of the thing being authorised. A lecturer who edits the query
 *   string to a colleague's section is refused by the API, not by this page.
 *
 * THE PICKER IS DERIVED FROM THE CALLER'S OWN TIMETABLE, so it can only ever
 * offer classes they teach — but the enforcement is still server-side, because
 * a client can always choose not to use the picker.
 */
export default async function FacultyStudentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { class: selectedKey } = await searchParams;

  const faculty = await getCurrentFaculty();
  if (!faculty) redirect("/login");

  const timetableResult = await getFacultyTimetable(faculty.id);

  const header = (
    <PageHeader
      title="My Students"
      subtitle="The register for a class you teach."
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
        },
      ])
    ).values()
  );

  if (classes.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No classes assigned"
          description="Once courses are allocated to you and timetabled, their students appear here."
        />
      </>
    );
  }

  const selected = classes.find((entry) => entry.value === selectedKey) ?? classes[0];

  const rosterResult = await getSectionRoster(selected.sectionId, selected.courseId);

  const toolbar = (
    <ListToolbar
      filters={
        <ListFilter
          paramKey="class"
          label="Class"
          hideLabel
          allLabel="Select a class"
          options={classes.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
        />
      }
    />
  );

  // A roster failure gets its own treatment rather than collapsing into an
  // empty class: "this class has no students" and "you may not read this
  // class" are different facts and must not look identical.
  if (!rosterResult.success) {
    return (
      <>
        {header}
        {toolbar}
        <StateView
          state={resolveFailureState(rosterResult)}
          subject="students"
          message={rosterResult.error}
        />
      </>
    );
  }

  const students = rosterResult.data;

  return (
    <>
      {header}
      {toolbar}

      {students.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No students enrolled"
          description="Nobody is currently registered for this class."
        />
      ) : (
        <Card
          header={
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-heading">{selected.label}</h2>
              <span className="text-xs text-muted-foreground">
                {students.length} student{students.length === 1 ? "" : "s"}
              </span>
            </div>
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-heading">
                    Enrolment
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-heading">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-heading">Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.studentId} className="border-b border-border">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {student.enrollmentNo}
                    </td>
                    <td className="px-4 py-2.5 text-heading">
                      {student.firstName} {student.lastName}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={student.status === "ACTIVE" ? "success" : "neutral"}
                      >
                        {student.status}
                      </Badge>
                    </td>
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

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Library } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getPortalSession } from "@/services/session";
import { getMyElectiveStatus, listStudentOfferings } from "@/services/electives";
import { ElectivePreferenceForm } from "./ElectivePreferenceForm";

export const metadata: Metadata = { title: "Open Electives" };

type SearchParams = Promise<{ semesterId?: string }>;

/**
 * The student's open-elective choices.
 *
 * The semester picker is built from the OFFERINGS rather than from a calendar
 * endpoint, deliberately: GET /api/academic-years is requireRole
 * ("UNIVERSITY_ADMIN"), so a student cannot enumerate semesters. Every offering
 * carries its own `semesterId` and `semesterName`, which is the only source a
 * student is permitted — and it is the right one, because a semester with no
 * offerings is not a semester they can choose in.
 */
export default async function StudentElectivesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const { semesterId } = await searchParams;

  const offeringsResult = await listStudentOfferings({ limit: 100, semesterId });

  const header = (
    <PageHeader
      title="Open Electives"
      subtitle="Rank the electives you would like to take. Seats are allocated by preference."
    />
  );

  if (!offeringsResult.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(offeringsResult)}
          subject="electives"
          message={offeringsResult.error}
        />
      </>
    );
  }

  const offerings = offeringsResult.data.items;

  const semesterOptions = Array.from(
    new Map(offerings.map((offering) => [offering.semesterId, offering.semesterName])).entries()
  ).map(([value, label]) => ({ value, label }));

  // Choices belong to a semester, so nothing can be shown about them until one
  // is settled on. Falling back to the first offering's semester keeps the page
  // useful on arrival rather than opening on an empty prompt.
  const activeSemesterId = semesterId ?? offerings[0]?.semesterId;

  const statusResult = activeSemesterId
    ? await getMyElectiveStatus(activeSemesterId)
    : null;

  if (offerings.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<Library />}
            title="No electives on offer"
            description="Nothing has been opened for selection yet. Check back once your department publishes its offerings."
          />
        </Card>
      </>
    );
  }

  const status = statusResult?.success ? statusResult.data : null;
  const forSemester = offerings.filter(
    (offering) => offering.semesterId === activeSemesterId
  );

  return (
    <>
      {header}

      {semesterOptions.length > 1 && (
        <ListToolbar
          filters={
            <ListFilter
              paramKey="semesterId"
              label="Semester"
              hideLabel
              allLabel="All semesters"
              options={semesterOptions}
            />
          }
        />
      )}

      {statusResult && !statusResult.success && (
        <Alert variant="warning" className="mb-4">
          Your current choices could not be loaded: {statusResult.error}
        </Alert>
      )}

      {status?.isAllocated && (
        <Alert variant="success" className="mb-4">
          Allocation is complete for this semester. Your result is shown against each
          elective below.
        </Alert>
      )}

      {status && !status.isEditable && !status.isAllocated && (
        <Alert variant="info" className="mb-4">
          Selection has closed for this semester. Your choices are shown but can no longer
          be changed.
        </Alert>
      )}

      <AllocationSummary
        allocations={status?.allocations ?? []}
        offerings={forSemester}
      />

      <ElectivePreferenceForm
        semesterId={activeSemesterId ?? ""}
        offerings={forSemester}
        // An empty list is the honest default when the status read failed: it
        // shows nothing selected rather than a set of choices we did not
        // actually confirm are on record.
        existing={status?.preferences ?? []}
        isEditable={status?.isEditable ?? false}
      />
    </>
  );
}

/**
 * What a completed allocation run decided.
 *
 * Refusals are listed alongside awards. A report that shows only the seat a
 * student won leaves the student who won none with a blank screen and no
 * explanation, which is the case this panel most needs to serve.
 */
function AllocationSummary({
  allocations,
  offerings,
}: {
  allocations: Array<{ offeringId: string; outcome: string; preferenceRank: number }>;
  offerings: Array<{ id: string; course: { code: string; name: string } }>;
}) {
  if (allocations.length === 0) return null;

  const nameFor = new Map(offerings.map((offering) => [offering.id, offering.course]));

  return (
    <Card
      header={<h2 className="text-sm font-semibold text-heading">Allocation result</h2>}
      noPadding
      className="mb-6"
    >
      <ul className="divide-y divide-border">
        {allocations.map((allocation) => {
          const course = nameFor.get(allocation.offeringId);
          const allocated = allocation.outcome === "ALLOCATED";

          return (
            <li
              key={allocation.offeringId}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {course ? `${course.code} — ${course.name}` : allocation.offeringId}
                </p>
                <p className="text-xs text-muted-foreground">
                  Your choice #{allocation.preferenceRank}
                </p>
              </div>
              <Badge variant={allocated ? "success" : "neutral"} size="sm">
                {allocated ? "Allocated" : "Not allocated"}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

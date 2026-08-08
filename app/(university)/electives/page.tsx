import type { Metadata } from "next";
import { Library } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listOfferings } from "@/services/electives";
import type { OpenElectiveOfferingDto } from "@/lib/dto/openElective.dto";
import { OpenElectiveStatus } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatNumber } from "@/utils/format";
import { OfferingActions } from "./OfferingActions";

export const metadata: Metadata = { title: "Open Electives" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ semesterId?: string; status?: string; page?: string }>;

/**
 * Every open-elective offering, and the two operations that settle one.
 *
 * The seat figures are the point of the screen: `seatsRemaining` and `isFull`
 * are computed by the backend service, so nothing here re-derives them from
 * totalSeats — two implementations of the same subtraction is how a full
 * offering ends up looking open on one screen and closed on another.
 */
export default async function OpenElectivesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { semesterId, status, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const result = await listOfferings({
    page: currentPage,
    limit: PAGE_SIZE,
    semesterId,
    status: status as OpenElectiveOfferingDto["status"] | undefined,
  });

  const header = (
    <PageHeader
      title="Open Electives"
      subtitle="Offerings students may choose across departments, and their allocation."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="offerings"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  // Derived from the page in hand, so the strip describes what is on screen
  // rather than claiming a total the endpoint never returned.
  const totalSeats = items.reduce((sum, offering) => sum + offering.totalSeats, 0);
  const seatsLeft = items.reduce((sum, offering) => sum + offering.seatsRemaining, 0);
  const openCount = items.filter((offering) => offering.acceptsPreferences).length;

  // Semesters are not enumerable from any endpoint a filter could call, so the
  // options come from the offerings themselves — every one carries its own
  // semester name.
  const semesterOptions = Array.from(
    new Map(items.map((offering) => [offering.semesterId, offering.semesterName])).entries()
  ).map(([value, label]) => ({ value, label }));

  const columns: TableColumn<OpenElectiveOfferingDto>[] = [
    {
      key: "course",
      header: "Course",
      render: (offering) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{offering.course.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {offering.course.code} · {offering.course.credits} credits
          </p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Offered by",
      render: (offering) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">
            {offering.offeringDepartmentName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{offering.semesterName}</p>
        </div>
      ),
    },
    {
      key: "scheme",
      header: "Regulation",
      render: (offering) => (
        <span className="text-xs text-muted-foreground">
          {offering.evaluationSchemeCode} v{offering.evaluationSchemeVersion}
        </span>
      ),
    },
    {
      key: "seats",
      header: "Seats",
      align: "right",
      render: (offering) => (
        <div>
          <span
            className={
              offering.isFull
                ? "font-semibold text-danger"
                : "font-semibold text-foreground"
            }
          >
            {formatNumber(offering.seatsRemaining)}
          </span>
          <span className="text-muted-foreground"> / {formatNumber(offering.totalSeats)}</span>
        </div>
      ),
    },
    {
      key: "eligibility",
      header: "Eligibility",
      render: (offering) =>
        // No rules means UNRESTRICTED. Absence of rules is not absence of
        // access, so this says "open to all" rather than showing nothing.
        offering.eligibility.length === 0 ? (
          <span className="text-xs text-muted-foreground">Open to all</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {offering.eligibility.length} rule
            {offering.eligibility.length === 1 ? "" : "s"}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (offering) => (
        <Badge
          variant={
            offering.status === "OPEN"
              ? "success"
              : offering.status === "LOCKED"
                ? "warning"
                : "neutral"
          }
          size="sm"
        >
          {offering.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (offering) => (
        <OfferingActions
          offeringId={offering.id}
          status={offering.status}
          courseName={offering.course.name}
        />
      ),
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Offerings on this page" value={formatNumber(items.length)} />
        <StatCard
          label="Seats remaining"
          value={formatNumber(seatsLeft)}
          caption={`of ${formatNumber(totalSeats)} offered`}
        />
        <StatCard label="Still accepting choices" value={formatNumber(openCount)} />
      </div>

      <div className="mt-6">
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
                options={enumOptions(OpenElectiveStatus)}
              />
            </>
          }
        />
      </div>

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns}
          data={items}
          rowKey={(offering) => offering.id}
          emptyState={
            <EmptyState
              icon={<Library />}
              title="No offerings"
              description={
                semesterId || status
                  ? "No offering matches these filters."
                  : "No open elective has been offered yet."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/electives"
            // Filters travel with the page links, so paging never silently
            // drops the filter the user is looking through.
            searchParams={{
              ...(semesterId ? { semesterId } : {}),
              ...(status ? { status } : {}),
            }}
          />
          <p className="text-xs text-muted-foreground">
            Showing {items.length} of {pagination.total} offerings
          </p>
        </div>
      )}
    </>
  );
}

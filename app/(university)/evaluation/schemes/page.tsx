import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveUiState, type UiState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listSchemes } from "@/services/evaluation";
import type { EvaluationSchemeDTO } from "@/lib/dto/evaluationScheme.dto";
import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { enumOptions } from "@/constants/enumOptions";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Evaluation Schemes" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ status?: string; page?: string }>;

/** DRAFT is editable, ACTIVE is in force, ARCHIVED is history. */
function statusVariant(status: EvaluationSchemeDTO["status"]) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "DRAFT") return "warning" as const;
  return "neutral" as const;
}

/**
 * Every evaluation regulation, current and historic.
 *
 * Schemes are VERSIONED rather than edited in place — an active regulation is
 * superseded by a new revision, and `supersededById` records which. The version
 * is therefore shown next to the code on every row: two rows sharing a code are
 * the same regulation at different points in time, not a duplicate.
 */
export default async function EvaluationSchemesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const result = await listSchemes({
    page: currentPage,
    limit: PAGE_SIZE,
    status: status as EvaluationSchemeDTO["status"] | undefined,
  });

  const header = (
    <PageHeader
      title="Evaluation Schemes"
      subtitle="The regulations results are computed against."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveUiState(result) as Exclude<UiState, "success" | "loading">}
          subject="evaluation schemes"
          message={result.error}
        />
      </>
    );
  }

  const { items, pagination } = result.data;

  const columns: TableColumn<EvaluationSchemeDTO>[] = [
    {
      key: "code",
      header: "Scheme",
      render: (scheme) => (
        <Link href={`/evaluation/schemes/${scheme.id}`} className="min-w-0 hover:underline">
          <p className="truncate font-medium text-foreground">{scheme.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {scheme.code} · v{scheme.version}
          </p>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (scheme) => (
        <Badge variant={statusVariant(scheme.status)} size="sm">
          {scheme.status}
        </Badge>
      ),
    },
    {
      key: "attemptPolicy",
      header: "Attempt policy",
      render: (scheme) => (
        <span className="text-sm text-muted-foreground">{scheme.attemptPolicy}</span>
      ),
    },
    {
      key: "rounding",
      header: "Rounding",
      render: (scheme) => (
        <span className="text-xs text-muted-foreground">
          Marks {scheme.marksRounding} ({scheme.marksPrecision}) · GPA {scheme.gpaRounding} (
          {scheme.gpaPrecision})
        </span>
      ),
    },
    {
      key: "activatedAt",
      header: "In force since",
      render: (scheme) =>
        scheme.activatedAt ? (
          formatDate(scheme.activatedAt)
        ) : (
          // A draft has never been in force. "—" would read as a missing date
          // rather than as a regulation that has not been authorised.
          <span className="text-muted-foreground">Not activated</span>
        ),
    },
  ];

  return (
    <>
      {header}

      <ListToolbar
        filters={
          <ListFilter
            paramKey="status"
            label="Status"
            hideLabel
            allLabel="All statuses"
            options={enumOptions(EvaluationSchemeStatus)}
          />
        }
      />

      <Card noPadding>
        <Table
          columns={columns}
          data={items}
          rowKey={(scheme) => scheme.id}
          emptyState={
            <EmptyState
              icon={<SlidersHorizontal />}
              title="No schemes"
              description={
                status
                  ? `No scheme is currently ${status.toLowerCase()}.`
                  : "No evaluation regulation has been created yet."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath="/evaluation/schemes"
            searchParams={status ? { status } : {}}
          />
        </div>
      )}
    </>
  );
}

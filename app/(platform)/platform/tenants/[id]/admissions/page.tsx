import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListFilter } from "@/components/shared/ListFilter";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { unwrapResource } from "@/lib/require-resource";
import { getTenant } from "@/services/tenants";
import { listApplications, type Application } from "@/services/admissions";
import { ADMISSION_STAGE_LABELS, ADMISSION_STAGES } from "@/lib/validations/admission";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Admissions" };

const PAGE_SIZE = 20;
type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ page?: string; stage?: string; q?: string }>;

/**
 * PRD §8.2 — the admissions register for one university.
 *
 * Search and the stage filter are both REAL: the API validates `q` and `stage`
 * and applies them to the query and its count. No disabled control is rendered.
 */
export default async function AdmissionsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { page, stage, q } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);

  const [tenantResult, result] = await Promise.all([
    getTenant(id),
    listApplications(id, { page: currentPage, limit: PAGE_SIZE, stage, q }),
  ]);

  const tenant = unwrapResource(tenantResult, "tenant");

  const header = (
    <PageHeader
      title="Admissions"
      subtitle={`Applications to ${tenant.name}.`}
      action={
        <Link href={`/platform/tenants/${id}/admissions/new`} className={buttonStyles({})}>
          New application
        </Link>
      }
    />
  );

  if (!result.success) {
    return (
      <>
        <PageHeader title="Admissions" subtitle={`Applications to ${tenant.name}.`} />
        <StateView
          state={resolveFailureState(result)}
          subject="applications"
          message={result.error}
        />
      </>
    );
  }

  const { applications, pagination } = result.data;
  const hasFilters = Boolean(q || stage);

  return (
    <>
      {header}

      <ListToolbar
        search={<ListSearch placeholder="Search name, email or number…" />}
        filters={
          <ListFilter
            paramKey="stage"
            label="Stage"
            hideLabel
            allLabel="All stages"
            options={ADMISSION_STAGES.map((value) => ({
              value,
              label: ADMISSION_STAGE_LABELS[value],
            }))}
          />
        }
      />

      <Card noPadding>
        <Table
          minWidthClassName="min-w-[56rem]"
          columns={columns(id)}
          data={applications}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<ClipboardList />}
              title={hasFilters ? "No matching applications" : "No applications"}
              description={
                hasFilters
                  ? "Nothing matches these filters."
                  : "Create the first application for this university."
              }
            />
          }
        />
      </Card>

      {pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            basePath={`/platform/tenants/${id}/admissions`}
            searchParams={{ ...(q ? { q } : {}), ...(stage ? { stage } : {}) }}
          />
        </div>
      )}
    </>
  );
}

function columns(tenantId: string): TableColumn<Application>[] {
  return [
    {
      key: "applicant",
      header: "Applicant",
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/platform/tenants/${tenantId}/admissions/${row.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {row.firstName} {row.lastName}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: "numbers",
      header: "Numbers",
      render: (row) => (
        <div className="min-w-0 font-mono text-xs text-muted-foreground">
          <p>{row.applicationNo}</p>
          <p>{row.applicantNo}</p>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      render: (row) => (
        <Badge variant={row.convertedAt ? "success" : "info"} withDot={false}>
          {ADMISSION_STAGE_LABELS[row.stage]}
        </Badge>
      ),
    },
    {
      key: "preferences",
      header: "Preferences",
      render: (row) =>
        row.preferences.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {row.preferences.map((p) => p.programme.code).join(", ")}
          </span>
        ),
    },
    {
      key: "converted",
      header: "Student",
      render: (row) =>
        row.studentId ? (
          <Badge variant="success" size="sm" withDot={false}>
            Converted
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => <span className="text-muted-foreground">{formatDate(row.createdAt)}</span>,
    },
  ];
}

import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { resolveFailureState } from "@/lib/ui-state";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { childResults, type ChildResult } from "@/services/parentPortal";
import { formatDate } from "@/utils/format";
import { resolveChildContext, NoChildren } from "../childContext";
import { ParentPageHeader } from "../ParentPage";

export const metadata: Metadata = { title: "Results" };
type SearchParams = Promise<{ child?: string }>;

/**
 * PRD §32 "Examination results" / "Academic progress", §18 "Parent-accessible
 * report cards".
 *
 * PUBLISHED results only — enforced server-side. The note below says so plainly,
 * because a parent seeing fewer results than they expect should understand why
 * rather than assume the portal is broken.
 */
export default async function ParentResultsPage({ searchParams }: { searchParams: SearchParams }) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);
  if (context.kind === "failed") return context.node;
  if (context.kind === "empty") return <NoChildren />;

  const result = await childResults(context.selected.studentId);

  return (
    <>
      <ParentPageHeader
        title="Results"
        subtitle="Published examination results"
        childList={context.children}
        selected={context.selected}
      />

      {!result.success ? (
        <StateView state={resolveFailureState(result)} subject="results" message={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={<GraduationCap />}
          title="No published results"
          description="Results appear here once the university publishes them."
        />
      ) : (
        <>
          <Alert variant="info" className="mb-4">
            Only results the university has published are shown. Provisional marks are not
            visible here.
          </Alert>
          <Card noPadding>
            <Table
              minWidthClassName="min-w-[44rem]"
              columns={columns}
              data={result.data}
              rowKey={(row) => row.id}
            />
          </Card>
        </>
      )}
    </>
  );
}

const columns: TableColumn<ChildResult>[] = [
  {
    key: "examination",
    header: "Examination",
    render: (r) => (
      <div className="min-w-0">
        <p className="text-sm text-foreground">{r.examination.title}</p>
        <p className="text-xs text-muted-foreground">
          {r.examination.course
            ? `${r.examination.course.code} · ${r.examination.course.name}`
            : r.examination.type}
        </p>
      </div>
    ),
  },
  {
    key: "date",
    header: "Date",
    render: (r) => (
      <span className="text-muted-foreground">
        {r.examination.date ? formatDate(r.examination.date) : "—"}
      </span>
    ),
  },
  {
    key: "marks",
    header: "Marks",
    align: "right",
    // Rendered as stored. No percentage is computed here — the evaluation
    // engine owns that arithmetic and a second implementation would drift.
    render: (r) =>
      r.isAbsent ? (
        <span className="text-muted-foreground">Absent</span>
      ) : (
        <span>
          {r.marksObtained ?? "—"}
          <span className="text-muted-foreground"> / {r.examination.maxMarks}</span>
        </span>
      ),
  },
  { key: "grade", header: "Grade", render: (r) => r.grade ?? "—" },
  {
    key: "outcome",
    header: "Outcome",
    render: (r) =>
      r.isPassed === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <StatusBadge
          label={r.isPassed ? "Passed" : "Not passed"}
          variant={r.isPassed ? "success" : "danger"}
        />
      ),
  },
];

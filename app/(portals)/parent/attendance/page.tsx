import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { resolveFailureState } from "@/lib/ui-state";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { childAttendance, type ChildAttendanceRecord } from "@/services/parentPortal";
import { formatDate } from "@/utils/format";
import { resolveChildContext, NoChildren } from "../childContext";
import { ParentPageHeader } from "../ParentPage";

export const metadata: Metadata = { title: "Attendance" };
type SearchParams = Promise<{ child?: string }>;

/** PRD §32 "Student attendance" — the selected child's own records. */
export default async function ParentAttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);
  if (context.kind === "failed") return context.node;
  if (context.kind === "empty") return <NoChildren />;

  const result = await childAttendance(context.selected.studentId);

  return (
    <>
      <ParentPageHeader
        title="Attendance"
        subtitle="Recent attendance"
        childList={context.children}
        selected={context.selected}
      />

      {!result.success ? (
        <StateView state={resolveFailureState(result)} subject="attendance" message={result.error} />
      ) : result.data.records.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="No attendance recorded"
          description="Nothing has been marked for this child yet."
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Records shown" value={String(result.data.summary.returned)} />
            <StatCard label="Present (shown)" value={String(result.data.summary.presentInReturned)} />
            <StatCard label="Total on record" value={String(result.data.summary.total)} />
          </div>
          <Card noPadding>
            <Table
              minWidthClassName="min-w-[40rem]"
              columns={columns}
              data={result.data.records}
              rowKey={(row) => row.id}
            />
          </Card>
        </>
      )}
    </>
  );
}

const columns: TableColumn<ChildAttendanceRecord>[] = [
  { key: "date", header: "Date", render: (r) => formatDate(r.date) },
  {
    key: "course",
    header: "Course",
    render: (r) =>
      r.course ? (
        <span>
          <span className="font-mono text-xs text-muted-foreground">{r.course.code}</span>{" "}
          {r.course.name}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { key: "sessionType", header: "Session", render: (r) => r.sessionType },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <StatusBadge
        label={r.status}
        variant={r.status === "PRESENT" ? "success" : r.status === "ABSENT" ? "danger" : "warning"}
      />
    ),
  },
];

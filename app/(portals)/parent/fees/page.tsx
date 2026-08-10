import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { resolveFailureState } from "@/lib/ui-state";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { childFees, type ChildFees } from "@/services/parentPortal";
import { formatCurrency, formatDate } from "@/utils/format";
import { resolveChildContext, NoChildren } from "../childContext";
import { ParentPageHeader } from "../ParentPage";

export const metadata: Metadata = { title: "Fees" };
type SearchParams = Promise<{ child?: string }>;

type Demand = ChildFees["demands"][number];
type PaymentRow = ChildFees["payments"][number];

/**
 * PRD §32 "Fee status" — READ ONLY.
 *
 * §32 also names "Online payments", and this screen deliberately offers none:
 * the PRD defines no gateway, provider or reconciliation behaviour anywhere, so
 * a "Pay now" button would be a control with nothing behind it. Recorded as a
 * PRD gap rather than mocked.
 */
export default async function ParentFeesPage({ searchParams }: { searchParams: SearchParams }) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);
  if (context.kind === "failed") return context.node;
  if (context.kind === "empty") return <NoChildren />;

  const result = await childFees(context.selected.studentId);

  return (
    <>
      <ParentPageHeader
        title="Fees"
        subtitle="Demands and payments"
        childList={context.children}
        selected={context.selected}
      />

      {!result.success ? (
        <StateView state={resolveFailureState(result)} subject="fees" message={result.error} />
      ) : result.data.demands.length === 0 && result.data.payments.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No fee records"
          description="No fee demand has been raised for this child yet."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Alert variant="info">
            Fee information is shown for reference. Payments are made through your
            university&rsquo;s existing process — this portal does not take payments.
          </Alert>

          <Card noPadding>
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-heading">Demands</h2>
            </div>
            <Table
              minWidthClassName="min-w-[42rem]"
              columns={demandColumns}
              data={result.data.demands}
              rowKey={(row) => row.id}
              emptyState={<EmptyState icon={<Receipt />} title="No demands" description="Nothing raised yet." />}
            />
          </Card>

          <Card noPadding>
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-heading">Payments</h2>
            </div>
            <Table
              minWidthClassName="min-w-[36rem]"
              columns={paymentColumns}
              data={result.data.payments}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState icon={<Receipt />} title="No payments" description="No payment recorded yet." />
              }
            />
          </Card>
        </div>
      )}
    </>
  );
}

const demandColumns: TableColumn<Demand>[] = [
  {
    key: "what",
    header: "Fee",
    render: (d) => (
      <div className="min-w-0">
        <p className="text-sm text-foreground">{d.feeStructure?.name ?? "Fee demand"}</p>
        <p className="text-xs text-muted-foreground">{d.semester?.name ?? "—"}</p>
      </div>
    ),
  },
  { key: "dueDate", header: "Due", render: (d) => formatDate(d.dueDate) },
  { key: "totalAmount", header: "Total", align: "right", render: (d) => formatCurrency(d.totalAmount) },
  { key: "paidAmount", header: "Paid", align: "right", render: (d) => formatCurrency(d.paidAmount) },
  {
    key: "status",
    header: "Status",
    render: (d) => (
      <StatusBadge
        label={d.status}
        variant={d.status === "PAID" ? "success" : d.status === "OVERDUE" ? "danger" : "warning"}
      />
    ),
  },
];

const paymentColumns: TableColumn<PaymentRow>[] = [
  { key: "receiptNo", header: "Receipt", render: (p) => <span className="font-mono text-xs">{p.receiptNo}</span> },
  { key: "paidAt", header: "Paid on", render: (p) => (p.paidAt ? formatDate(p.paidAt) : "—") },
  { key: "method", header: "Method", render: (p) => p.method },
  { key: "amount", header: "Amount", align: "right", render: (p) => formatCurrency(p.amount) },
  {
    key: "status",
    header: "Status",
    render: (p) => (
      <StatusBadge label={p.status} variant={p.status === "SUCCESS" ? "success" : "warning"} />
    ),
  },
];

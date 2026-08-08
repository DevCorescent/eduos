import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentStudent } from "@/services/portal";
import { listStudentFeeDemands, listStudentPayments } from "@/services/finance";
import {
  FEE_STATUS_LABELS,
  FEE_STATUS_VARIANTS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_VARIANTS,
} from "@/constants/labels";
import { formatCurrency, formatDate } from "@/utils/format";
import { cn } from "@/lib/utils";
import type { FeeDemand, Payment } from "@/types";

export const metadata: Metadata = { title: "My Fees" };

export default async function StudentFeesPage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const [demandsResult, paymentsResult] = await Promise.all([
    listStudentFeeDemands(student.id),
    listStudentPayments(student.id),
  ]);

  const header = <PageHeader title="My Fees" subtitle="What you owe, and what you have paid." />;

  if (!demandsResult.success) {
    return (
      <>
        {header}
        <ErrorState title="Fee service is currently unavailable" description={demandsResult.error} />
      </>
    );
  }

  const demands = demandsResult.data;
  const payments = paymentsResult.success ? paymentsResult.data : [];

  const billed = demands.reduce((sum, d) => sum + Number(d.totalAmount), 0);
  const paid = demands.reduce((sum, d) => sum + Number(d.paidAmount), 0);
  const waived = demands.reduce((sum, d) => sum + Number(d.waivedAmount), 0);
  const outstanding = billed - paid - waived;

  const overdue = demands.filter((d) => d.status === "OVERDUE");

  const demandColumns: TableColumn<FeeDemand>[] = [
    {
      key: "totalAmount",
      header: "Billed",
      align: "right",
      render: (row) => formatCurrency(row.totalAmount),
    },
    {
      key: "paidAmount",
      header: "Paid",
      align: "right",
      render: (row) => (
        <span className="text-success">{formatCurrency(row.paidAmount)}</span>
      ),
    },
    {
      key: "waivedAmount",
      header: "Waived",
      align: "right",
      render: (row) =>
        Number(row.waivedAmount) > 0 ? (
          <span className="text-info">{formatCurrency(row.waivedAmount)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) => {
        const owed =
          Number(row.totalAmount) - Number(row.paidAmount) - Number(row.waivedAmount);
        return owed > 0 ? (
          <span className="font-semibold text-danger">{formatCurrency(owed)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={FEE_STATUS_LABELS[row.status]}
          variant={FEE_STATUS_VARIANTS[row.status]}
        />
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => {
        const isOverdue = row.status === "OVERDUE";
        return (
          <span className={cn(isOverdue ? "font-medium text-danger" : "text-muted-foreground")}>
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
  ];

  const paymentColumns: TableColumn<Payment>[] = [
    {
      key: "receiptNo",
      header: "Receipt",
      render: (row) => (
        <span className="font-mono text-xs font-medium text-foreground">{row.receiptNo}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => formatCurrency(row.amount),
    },
    {
      key: "method",
      header: "Method",
      render: (row) => (
        <Badge variant="neutral" size="sm">
          {PAYMENT_METHOD_LABELS[row.method]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={PAYMENT_STATUS_LABELS[row.status]}
          variant={PAYMENT_STATUS_VARIANTS[row.status]}
        />
      ),
    },
    {
      key: "paidAt",
      header: "Paid on",
      // paidAt is nullable — an initiated payment has no settlement time yet,
      // which is a normal in-flight state rather than missing data.
      render: (row) => (
        <span className="text-muted-foreground">
          {row.paidAt ? formatDate(row.paidAt) : "Processing"}
        </span>
      ),
    },
  ];

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Billed" value={formatCurrency(billed)} />
        <StatCard label="Paid" value={formatCurrency(paid)} />
        <StatCard
          label="Outstanding"
          value={outstanding > 0 ? formatCurrency(outstanding) : "Clear"}
          caption={outstanding > 0 ? "Payable now" : "Nothing owed"}
        />
        <StatCard
          label="Waived"
          value={waived > 0 ? formatCurrency(waived) : "—"}
          caption={waived > 0 ? "Concession granted" : undefined}
        />
      </div>

      {overdue.length > 0 && (
        <Alert variant="error" title="You have an overdue payment" className="mt-6">
          {overdue.length} demand{overdue.length === 1 ? " is" : "s are"} past the due date.
          Settle it with the accounts office — unpaid dues can block examination entry and
          certificate issue.
        </Alert>
      )}

      <Card
        className="mt-6"
        noPadding
        header={<h2 className="text-sm font-semibold text-heading">Fee demands</h2>}
      >
        <Table
          minWidthClassName="min-w-[64rem]"
          columns={demandColumns}
          data={demands}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Receipt />}
              title="No fee demands"
              description="Nothing has been billed to you yet."
            />
          }
        />
      </Card>

      <Card
        className="mt-6"
        noPadding
        header={<h2 className="text-sm font-semibold text-heading">Payment history</h2>}
      >
        <Table
          minWidthClassName="min-w-[64rem]"
          columns={paymentColumns}
          data={payments}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Receipt />}
              title="No payments yet"
              description="Receipts appear here once a payment is recorded."
            />
          }
        />
      </Card>
    </>
  );
}

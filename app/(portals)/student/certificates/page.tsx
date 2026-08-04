import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getCurrentStudent } from "@/services/portal";
import { listStudentCertificates } from "@/services/finance";
import { CERTIFICATE_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { CertificateRow } from "@/types";

export const metadata: Metadata = { title: "My Certificates" };

export default async function StudentCertificatesPage() {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const result = await listStudentCertificates(student.id);

  const header = (
    <PageHeader
      title="My Certificates"
      subtitle="Documents issued to you, each with a link anyone can use to verify it."
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <ErrorState title="Couldn't load your certificates" description={result.error} />
      </>
    );
  }

  const certificates = result.data;

  const columns: TableColumn<CertificateRow>[] = [
    {
      key: "templateName",
      header: "Certificate",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-foreground">{row.templateName}</span>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.certificateNo}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => CERTIFICATE_TYPE_LABELS[row.type],
    },
    {
      key: "issuedAt",
      header: "Issued",
      render: (row) => (
        <span className="text-muted-foreground">{formatDate(row.issuedAt)}</span>
      ),
    },
    {
      key: "expiresAt",
      header: "Valid until",
      render: (row) => (
        <span className="text-muted-foreground">
          {row.expiresAt ? formatDate(row.expiresAt) : "No expiry"}
        </span>
      ),
    },
    {
      key: "isRevoked",
      header: "Status",
      render: (row) => (
        <StatusBadge
          label={row.isRevoked ? "Revoked" : "Valid"}
          variant={row.isRevoked ? "danger" : "success"}
        />
      ),
    },
    {
      key: "verify",
      header: <span className="sr-only">Verify</span>,
      align: "right",
      render: (row) => (
        <Link
          href={`/verify/${row.certificateNo}`}
          // New tab: this is the public page a student sends to an employer,
          // and they should not lose their portal to open it.
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Verification link
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <>
      {header}

      <Card noPadding>
        <Table
          columns={columns}
          data={certificates}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Award />}
              title="No certificates yet"
              description="Certificates issued to you by the university will appear here, ready to share."
            />
          }
        />
      </Card>

      {certificates.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Share a verification link with an employer to let them confirm the document
          without needing an account. The link shows your name and what was awarded — your
          enrolment number is partially masked.
        </p>
      )}
    </>
  );
}

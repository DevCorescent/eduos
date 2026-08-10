import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { getPortalSession } from "@/services/session";
import { getMyProfile } from "@/services/studentProfile";
import { CERTIFICATE_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { CertificateDto } from "@/lib/dto/studentProfile.dto";

export const metadata: Metadata = { title: "My Certificates" };

/**
 * The student's own certificates.
 *
 * Sourced from GET /api/student/profile and NOT from
 * /api/students/[id]/certificates: that route is requireRole
 * ("UNIVERSITY_ADMIN") and answers a student with 403. The profile endpoint
 * returns the same certificates to the person they belong to, which is the only
 * path a portal may take.
 *
 * Revoked certificates are listed rather than filtered out. A student needs to
 * know that a document they may already have sent somewhere no longer stands.
 */
export default async function StudentCertificatesPage() {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const result = await getMyProfile();

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
        <StateView
          state={resolveFailureState(result)}
          subject="certificates"
          message={result.error}
        />
      </>
    );
  }

  const certificates = result.data.certificates;

  const columns: TableColumn<CertificateDto>[] = [
    {
      key: "type",
      header: "Certificate",
      render: (row) => (
        <div className="min-w-0">
          {/* The profile endpoint returns no template name — the type is what
              identifies a certificate to the person holding it. */}
          <span className="font-medium text-foreground">
            {CERTIFICATE_TYPE_LABELS[row.type]}
          </span>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.certificateNo}
          </p>
        </div>
      ),
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
          // Three states, not two: an expired certificate is neither revoked
          // nor currently valid, and `isActive` is the API's own answer.
          label={row.isRevoked ? "Revoked" : row.isActive ? "Valid" : "Expired"}
          variant={row.isRevoked ? "danger" : row.isActive ? "success" : "neutral"}
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

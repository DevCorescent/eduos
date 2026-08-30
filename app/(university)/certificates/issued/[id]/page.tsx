import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";
import { getPortalSession } from "@/services/session";
import { issuedCertificateDocument } from "@/lib/services/certificateDocument";
import { formatDate } from "@/utils/format";
import { CertificateViewer } from "./CertificateViewer";

export const metadata: Metadata = { title: "Certificate" };

/**
 * One issued certificate, as the holder's document.
 *
 * The tenant comes from the session, and the lookup is scoped by it, so a
 * certificate id belonging to another university resolves to nothing — the
 * same answer as one that does not exist.
 */
export default async function IssuedCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const certificate = await issuedCertificateDocument(session.tenantId, id);

  const header = (
    <PageHeader
      title={certificate ? certificate.certificateNo : "Certificate"}
      subtitle={certificate ? `Issued to ${certificate.studentName}` : undefined}
      breadcrumb={
        <Link
          href="/certificates/templates"
          className={buttonStyles({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Certificates
        </Link>
      }
    />
  );

  if (!certificate) {
    return (
      <>
        {header}
        <StateView state="notFound" subject="this certificate" />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="flex flex-col gap-4">
        {certificate.isRevoked && (
          <Alert variant="error">
            This certificate has been revoked. It is shown here as a record; it should not be
            presented as valid.
          </Alert>
        )}

        {!certificate.fromSnapshot && (
          <Alert variant="warning">
            {/* Stated rather than hidden: this document is being rendered from
                the live template because it was issued before designs were
                frozen, so a later edit may have changed how it looks. */}
            This certificate was issued before template versions were recorded, so it is rendered
            from the current template rather than from the design it was issued with.
          </Alert>
        )}

        <Card>
          <dl className="grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Certificate ID</dt>
              <dd className="mt-0.5 font-mono text-sm text-foreground">
                {certificate.certificateNo}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Issued</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {formatDate(certificate.issuedAt.toISOString())}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Template</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {certificate.templateName}
                {certificate.templateVersion !== null && (
                  <span className="text-muted-foreground"> · v{certificate.templateVersion}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">
                <StatusBadge
                  label={certificate.isRevoked ? "Revoked" : "Valid"}
                  variant={certificate.isRevoked ? "danger" : "success"}
                  size="sm"
                />
              </dd>
            </div>
          </dl>
        </Card>

        <CertificateViewer document={certificate.document} />
      </div>
    </>
  );
}

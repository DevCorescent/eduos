import type { Metadata } from "next";
import Link from "next/link";
import { Award, FileCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { ListSearch } from "@/components/shared/ListSearch";
import { ListToolbar } from "@/components/shared/ListToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { TemplateRowActions } from "./TemplateRowActions";
import { Card } from "@/components/ui/Card";
import { Table, type TableColumn } from "@/components/ui/Table";
import { listCertificateTemplates, listCertificates } from "@/services/finance";
import { CERTIFICATE_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";
import type { CertificateRow, CertificateTemplate } from "@/types";
import { RevokeCertificateButton } from "./RevokeCertificateButton";

export const metadata: Metadata = { title: "Certificates" };

type SearchParams = Promise<{ q?: string }>;

export default async function CertificateTemplatesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q } = await searchParams;

  const [templatesResult, issuedResult] = await Promise.all([
    listCertificateTemplates({ page: 1, limit: 100 }),
    listCertificates({ page: 1, limit: 20, q }),
  ]);

  const header = (
    <PageHeader
      title="Certificates"
      subtitle="Templates the university issues from, and the documents issued so far."
      action={
        <div className="flex flex-wrap gap-2">
          <Link
            href="/certificates/templates/new"
            className={buttonStyles({ variant: "secondary" })}
          >
            Create template
          </Link>
          <Link href="/certificates/issue" className={buttonStyles()}>
            Issue certificate
          </Link>
        </div>
      }
    />
  );

  /**
   * The same header with its create/manage controls withheld.
   *
   * Rendered when the list request itself failed. A 403 there means this role
   * has no access to the collection at all, so an "Invite user" button beside
   * the refusal would offer an action the backend will reject — the control
   * would be a claim the API does not honour.
   */
  const failureHeader = (
    <PageHeader title="Certificates" subtitle="Templates the university issues from, and the documents issued so far." />
  );

  if (!templatesResult.success) {
    return (
      <>
        {failureHeader}
        <StateView
          state={resolveFailureState(templatesResult)}
          subject="certificate templates"
          message={templatesResult.error}
        />
      </>
    );
  }

  const templateColumns: TableColumn<CertificateTemplate>[] = [
    {
      key: "name",
      header: "Template",
      render: (template) => (
        <span className="font-medium text-foreground">{template.name}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (template) => (
        <Badge variant="neutral" size="sm">
          {CERTIFICATE_TYPE_LABELS[template.type]}
        </Badge>
      ),
    },
    {
      key: "variables",
      header: "Placeholders",
      align: "right",
      render: (template) => (
        <span className="text-muted-foreground">
          {template.variables ? Object.keys(template.variables).length : 0}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (template) => (
        <StatusBadge
          label={template.isActive ? "Active" : "Draft"}
          variant={template.isActive ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "updatedAt",
      header: "Last updated",
      render: (template) => (
        <span className="text-muted-foreground">{formatDate(template.updatedAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (template) => <TemplateRowActions template={template} />,
    },
  ];

  const issuedColumns: TableColumn<CertificateRow>[] = [
    {
      key: "certificateNo",
      header: "Certificate",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-mono text-xs font-medium text-foreground">
            {row.certificateNo}
          </span>
          <p className="truncate text-xs text-muted-foreground">{row.templateName}</p>
        </div>
      ),
    },
    {
      key: "studentName",
      header: "Issued to",
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/students/${row.studentId}`}
            className="font-medium text-foreground hover:underline"
          >
            {row.studentName}
          </Link>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.enrollmentNo}
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
      key: "view",
      header: <span className="sr-only">View</span>,
      render: (row) => (
        // The document itself, rendered from the design it was ISSUED with.
        // Separate from Verify below, which is the public check an employer
        // performs against the certificate number.
        <Link
          href={`/certificates/issued/${row.id}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          View
        </Link>
      ),
    },
    {
      key: "verify",
      header: <span className="sr-only">Verify</span>,
      render: (row) => (
        <Link
          href={`/verify/${row.certificateNo}`}
          // Opens the public page in a new tab: it is what an employer sees,
          // and staff check it without losing their place in the console.
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary hover:underline"
        >
          Verify
        </Link>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (row) =>
        row.isRevoked ? null : (
          <RevokeCertificateButton
            id={row.id}
            certificateNo={row.certificateNo}
            studentName={row.studentName}
          />
        ),
    },
  ];

  return (
    <>
      {header}

      <Card
        noPadding
        header={<h2 className="text-sm font-semibold text-heading">Templates</h2>}
      >
        <Table
          minWidthClassName="min-w-[64rem]"
          columns={templateColumns}
          data={templatesResult.data.items}
          rowKey={(template) => template.id}
          emptyState={
            <EmptyState
              icon={<Award />}
              title="No templates"
              description="Add a template before issuing certificates."
            />
          }
        />
      </Card>

      <div className="mt-8">
        <ListToolbar
          search={<ListSearch placeholder="Search issued certificates…" />}
        />

        <Card
          noPadding
          header={
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-heading">Recently issued</h2>
              {issuedResult.success && (
                <span className="text-xs text-muted-foreground">
                  {issuedResult.data.pagination.total} total
                </span>
              )}
            </div>
          }
        >
          {!issuedResult.success ? (
            <ErrorState
              title="Couldn't load certificates"
              description={issuedResult.error}
              className="border-0 bg-transparent"
            />
          ) : (
            <Table
              minWidthClassName="min-w-[64rem]"
              columns={issuedColumns}
              data={issuedResult.data.items}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState
                  icon={<FileCheck />}
                  title={q ? "No matching certificates" : "None issued yet"}
                  description={
                    q
                      ? "No certificate matches that search."
                      : "Issued certificates appear here with a public verification link."
                  }
                />
              }
            />
          )}
        </Card>
      </div>
    </>
  );
}

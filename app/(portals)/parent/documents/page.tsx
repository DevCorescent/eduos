import type { Metadata } from "next";
import { Award, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";
import { childDocuments } from "@/services/parentPortal";
import { formatDate } from "@/utils/format";
import { resolveChildContext, NoChildren } from "../childContext";
import { ParentPageHeader } from "../ParentPage";

export const metadata: Metadata = { title: "Documents" };
type SearchParams = Promise<{ child?: string }>;

/**
 * PRD §32 "Download documents".
 *
 * Two lists, not one: a document is something the student supplied, a
 * certificate is something the institution issued. Revoked certificates are
 * excluded server-side.
 *
 * A download link is rendered ONLY when a URL exists — a certificate whose PDF
 * has not been generated shows as unavailable rather than as a dead button.
 */
export default async function ParentDocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { child } = await searchParams;
  const context = await resolveChildContext(child);
  if (context.kind === "failed") return context.node;
  if (context.kind === "empty") return <NoChildren />;

  const result = await childDocuments(context.selected.studentId);

  return (
    <>
      <ParentPageHeader
        title="Documents"
        subtitle="Documents and certificates"
        childList={context.children}
        selected={context.selected}
      />

      {!result.success ? (
        <StateView state={resolveFailureState(result)} subject="documents" message={result.error} />
      ) : result.data.documents.length === 0 && result.data.certificates.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="No documents"
          description="Nothing has been uploaded or issued for this child yet."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="text-sm font-semibold text-heading">Certificates</h2>
            {result.data.certificates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None issued yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {result.data.certificates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{c.type}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.certificateNo}</p>
                      <p className="text-xs text-muted-foreground">Issued {formatDate(c.issuedAt)}</p>
                    </div>
                    {c.pdfUrl ? (
                      <a
                        href={c.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonStyles({ variant: "secondary", size: "sm" })}
                      >
                        <Award className="size-4" aria-hidden="true" />
                        <span className="ml-1.5">Download</span>
                      </a>
                    ) : (
                      <Badge variant="neutral" size="sm" withDot={false}>
                        Not yet available
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-heading">Submitted documents</h2>
            {result.data.documents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None on record.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {result.data.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{d.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.type}
                        {d.isVerified && d.verifiedAt ? ` · verified ${formatDate(d.verifiedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.isVerified ? (
                        <Badge variant="success" size="sm" withDot={false}>
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm" withDot={false}>
                          Pending
                        </Badge>
                      )}
                      <a
                        href={d.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonStyles({ variant: "secondary", size: "sm" })}
                      >
                        Open
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

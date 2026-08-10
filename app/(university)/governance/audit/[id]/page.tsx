import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getAuditLog } from "@/services/audit";
import { unwrapResource } from "@/lib/require-resource";
import { formatDateTime } from "@/utils/format";

export const metadata: Metadata = { title: "Audit Entry" };

/**
 * One audit entry, in full.
 *
 * THIS IS THE ONLY SCREEN THAT SHOWS THE SNAPSHOTS
 *   `before` and `after` may name a student, an amount, an email. The list
 *   deliberately does not return them, so they are transferred only when a
 *   reader opens one entry — a single, authorised, deliberate read.
 *
 * THE SNAPSHOTS ARE RENDERED AS JSON, ON PURPOSE
 *   Every module writes its own snapshot shape, and there are eleven of them
 *   from earlier phases alone. A "friendly" renderer would have to guess at
 *   each, and would quietly omit any key it did not recognise — which on an
 *   evidence screen means hiding the one field that mattered. The raw document
 *   is shown instead, already stripped of credential-shaped values by the audit
 *   service before it was ever stored.
 *
 * READ-ONLY BY CONSTRUCTION
 *   No edit control, no delete control, no endpoint behind either.
 */
export default async function AuditEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = unwrapResource(await getAuditLog(id), "audit entry");

  return (
    <>
      <PageHeader
        title={entry.action.replace(/_/g, " ")}
        subtitle={`${entry.resource} · ${formatDateTime(entry.createdAt)}`}
        action={
          <Link
            href="/governance/audit"
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            Back to trail
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          header={<h2 className="text-sm font-semibold text-heading">Event</h2>}
          className="lg:col-span-1"
        >
          <dl className="flex flex-col gap-3 text-sm">
            <Field label="Result">
              <Badge variant={entry.status === "SUCCESS" ? "success" : "danger"} size="sm">
                {entry.status === "SUCCESS" ? "Succeeded" : "Refused"}
              </Badge>
            </Field>
            <Field label="Action">{entry.action}</Field>
            <Field label="Resource">{entry.resource}</Field>
            <Field label="Subject">{entry.resourceId ?? "—"}</Field>
            <Field label="Actor">
              {entry.userId ?? (
                <span className="text-muted-foreground">Unauthenticated</span>
              )}
            </Field>
            <Field label="When">{formatDateTime(entry.createdAt)}</Field>
            {/* Recorded as what the request CLAIMED. Both headers are
                client-supplied and trivially forged, and no authorization
                decision anywhere reads them. */}
            <Field label="IP address">{entry.ipAddress ?? "—"}</Field>
            <Field label="User agent">
              <span className="break-words text-xs">{entry.userAgent ?? "—"}</span>
            </Field>
            {entry.correlationId && (
              <Field label="Correlation">
                <Link
                  href={`/governance/audit?correlationId=${entry.correlationId}`}
                  className="font-mono text-xs hover:underline"
                  title="Other entries produced by the same request"
                >
                  {entry.correlationId}
                </Link>
              </Field>
            )}
          </dl>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Snapshot
            title="Before"
            value={entry.before}
            emptyNote="Nothing preceded this — the record did not exist."
          />
          <Snapshot
            title="After"
            value={entry.after}
            emptyNote="No snapshot was recorded for this event."
          />
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A stored snapshot.
 *
 * `null` and "absent" are distinguished: a creation legitimately has no before
 * state, and saying so is different from showing an empty box that could mean
 * the field failed to load.
 */
function Snapshot({
  title,
  value,
  emptyNote,
}: {
  title: string;
  value: unknown;
  emptyNote: string;
}) {
  return (
    <Card header={<h2 className="text-sm font-semibold text-heading">{title}</h2>}>
      {value === null || value === undefined ? (
        <p className="text-sm text-muted-foreground">{emptyNote}</p>
      ) : (
        // Wide documents scroll inside their own box rather than pushing the
        // page sideways.
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5 text-foreground">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </Card>
  );
}

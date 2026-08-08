import type { Metadata } from "next";
import { BadgeCheck, CircleSlash, FileQuestion } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { verifyCertificate } from "@/services/finance";
import { CERTIFICATE_TYPE_LABELS } from "@/constants/labels";
import { formatDate } from "@/utils/format";

type Params = Promise<{ certNo: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { certNo } = await params;
  return {
    title: `Verify ${decodeURIComponent(certNo)}`,
    // Verification pages carry a named individual, so they are kept out of
    // search results even though the page itself is public.
    robots: { index: false, follow: false },
  };
}

/**
 * Public certificate verification.
 *
 * Reached by scanning the QR code on a certificate or by following the printed
 * URL. No sign-in — an employer checking a candidate's degree has no account
 * here, and requiring one would make the whole feature pointless.
 *
 * A certificate that does not exist is a *result*, not an error: it renders a
 * clear "no such certificate" rather than a 404, because the commonest cause is
 * a mistyped number and the reader needs to be told that, not shown a broken
 * page.
 */
export default async function VerifyCertificatePage({ params }: { params: Params }) {
  const { certNo } = await params;
  const certificateNo = decodeURIComponent(certNo);

  const result = await verifyCertificate(certificateNo);

  if (!result.success) {
    return (
      <StateView
          state={resolveFailureState(result)}
          subject="certificate verification"
          message={result.error}
        />
    );
  }

  const verification = result.data;

  if (!verification.found) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileQuestion className="size-8" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-heading">No such certificate</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No certificate was found with the number{" "}
          <span className="font-mono text-foreground">{verification.certificateNo}</span>.
          Check the number against the printed document — it is case-insensitive but must
          otherwise match exactly.
        </p>
      </div>
    );
  }

  const isValid = verification.isValid;

  return (
    <div className="mx-auto max-w-xl">
      <div className="text-center">
        <div
          className={
            isValid
              ? "mx-auto flex size-16 items-center justify-center rounded-full bg-success-bg text-success"
              : "mx-auto flex size-16 items-center justify-center rounded-full bg-danger-bg text-danger"
          }
        >
          {isValid ? (
            <BadgeCheck className="size-8" aria-hidden="true" />
          ) : (
            <CircleSlash className="size-8" aria-hidden="true" />
          )}
        </div>

        <h1 className="mt-6 text-2xl font-semibold text-heading">
          {isValid ? "Certificate verified" : "Certificate not valid"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isValid
            ? "This certificate was issued by the institution and remains valid."
            : verification.isRevoked
              ? "This certificate was issued but has since been revoked by the institution."
              : "This certificate has passed its validity period."}
        </p>
      </div>

      {verification.isRevoked && (
        <Alert variant="error" title="Revoked" className="mt-6">
          Revoked on {formatDate(verification.revokedAt)}. It should not be accepted as
          evidence of the award.
        </Alert>
      )}

      <Card className="mt-8">
        <dl className="flex flex-col">
          <Field label="Certificate number" value={
            <span className="font-mono text-xs">{verification.certificateNo}</span>
          } />
          <Field label="Issued to" value={verification.studentName} />
          {/* Masked deliberately: publishing full enrolment numbers would let
              anyone holding one certificate number harvest student identifiers. */}
          <Field label="Enrolment number" value={verification.maskedEnrollmentNo} />
          <Field
            label="Certificate type"
            value={
              verification.type ? CERTIFICATE_TYPE_LABELS[verification.type] : null
            }
          />
          <Field label="Document" value={verification.templateName} />
          <Field label="Issued on" value={formatDate(verification.issuedAt)} />
          {verification.expiresAt && (
            <Field label="Valid until" value={formatDate(verification.expiresAt)} />
          )}
        </dl>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Details are shown in summary only. For a full transcript, contact the issuing
        institution directly.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

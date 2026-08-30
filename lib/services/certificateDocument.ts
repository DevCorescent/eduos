// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Document assembly
// LAYER  : Service (data access)
// PURPOSE: Assemble one issued certificate into its finished document, from the
//          real records it was issued against.
//
// RENDERED FROM THE SNAPSHOT, NOT FROM THE TEMPLATE
//   A certificate is rendered from Certificate.templateSnapshot — the markup
//   frozen at issuance. Editing the template afterwards therefore cannot change
//   a document somebody already holds. Certificates issued before that column
//   existed fall back to their template row, which is the best that can be done
//   for them and is stated on screen rather than hidden.
//
// NO DATA IS INVENTED
//   Every value comes from a record: the student, their programme and
//   department, the tenant, and the certificate itself. A field the database
//   does not hold is left as its placeholder rather than filled with a
//   plausible-looking guess — a certificate is a claim about a person, and a
//   guessed claim is a false one.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { renderCertificateDocument, type CertificateValues } from "@/lib/domain/certificate/render";
import { formatDate } from "@/utils/format";

export interface IssuedCertificateDocument {
  readonly certificateNo: string;
  readonly issuedAt: Date;
  readonly isRevoked: boolean;
  readonly studentName: string;
  readonly templateName: string;
  /** Version the document was issued under, when known. */
  readonly templateVersion: number | null;
  /** True when rendered from the frozen snapshot rather than the live template. */
  readonly fromSnapshot: boolean;
  /** A complete, self-contained A4 HTML document. */
  readonly document: string;
}

/**
 * One issued certificate, ready to display or print.
 *
 * INPUT   : the tenant from requireTenant, and the certificate id.
 * RETURNS : the assembled document, or null when the certificate is not this
 *           tenant's — the same answer as one that does not exist, so an id
 *           from another university reveals nothing.
 */
export async function issuedCertificateDocument(
  tenantId: string,
  certificateId: string
): Promise<IssuedCertificateDocument | null> {
  const certificate = await prisma.certificate.findFirst({
    where: { id: certificateId, tenantId },
    select: {
      certificateNo: true,
      issuedAt: true,
      isRevoked: true,
      data: true,
      templateSnapshot: true,
      template: { select: { name: true, htmlTemplate: true, cssStyles: true, version: true } },
      student: {
        select: {
          enrollmentNo: true,
          currentSemester: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          // Student has no `programme` relation — only programmeId — so the
          // programme is read separately below rather than joined here.
          programmeId: true,
          section: { select: { name: true } },
        },
      },
    },
  });

  if (!certificate) return null;

  // Read separately because Student carries programmeId without a relation.
  // Null when the student has no programme recorded, which leaves the
  // placeholder visible rather than inventing a qualification.
  const programme = certificate.student.programmeId
    ? await prisma.programme.findFirst({
        where: { id: certificate.student.programmeId, tenantId },
        select: { name: true },
      })
    : null;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, address: true, website: true },
  });

  const snapshot = certificate.templateSnapshot as
    | { version?: number; html?: string; css?: string | null }
    | null;

  const fromSnapshot = typeof snapshot?.html === "string";

  const design = fromSnapshot
    ? { html: snapshot.html as string, css: snapshot.css ?? null }
    : { html: certificate.template.htmlTemplate, css: certificate.template.cssStyles };

  const student = certificate.student;
  const fullName = [student.user.firstName, student.user.lastName].filter(Boolean).join(" ");

  // Values supplied at issuance win: they are what the issuer recorded on this
  // document. Everything else is read live from the related records.
  const issued = (certificate.data ?? {}) as Record<string, unknown>;
  const fromIssue = Object.fromEntries(
    Object.entries(issued)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => [k, String(v)])
  );

  const values: CertificateValues = {
    studentName: fullName,
    enrollmentNo: student.enrollmentNo,
    studentEmail: student.user.email,
    programName: programme?.name ?? "",
    certificateId: certificate.certificateNo,
    issueDate: formatDate(certificate.issuedAt.toISOString()),
    universityName: tenant?.name ?? "",
    universityWebsite: tenant?.website ?? "",
    ...fromIssue,
  };

  return {
    certificateNo: certificate.certificateNo,
    issuedAt: certificate.issuedAt,
    isRevoked: certificate.isRevoked,
    studentName: fullName,
    templateName: certificate.template.name,
    templateVersion: snapshot?.version ?? certificate.template.version ?? null,
    fromSnapshot,
    document: renderCertificateDocument(design, values),
  };
}

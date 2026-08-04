// ============================================================================
// MODULE : Mock Data — Payments & Certificates
// PURPOSE: Payment receipts against fee demands, and the certificate templates
//          and issued documents the verification page reads.
//
//          No backend route serves either (backend Phases 11-12).
//
//          Payments are derived from the demands rather than generated
//          independently: a receipt that does not correspond to money actually
//          recorded against a demand would make the ledger and the receipt list
//          contradict each other, which is the one thing a finance screen must
//          never do.
// ============================================================================

import type { Certificate, CertificateTemplate, Payment } from "@/types";
import { daysAgo, seededInt, seededPick } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import { MOCK_FEE_DEMANDS } from "./finance";
import { MOCK_STUDENTS } from "./people";

const CREATED = daysAgo(200);

// --- Payments ---------------------------------------------------------------

/**
 * One receipt per demand that has money against it.
 *
 * PENDING demands produce no payment — that is what pending means. The amount
 * is exactly the demand's paidAmount, so the two always reconcile.
 */
export const MOCK_PAYMENTS: Payment[] = MOCK_FEE_DEMANDS.filter(
  (demand) => Number(demand.paidAmount) > 0
).map((demand, i): Payment => {
  const seed = `payment-${demand.id}`;
  const paidAt = daysAgo(seededInt(10, 150, `${seed}-date`));

  return {
    id: mockId("pay", i + 1, 4),
    tenantId: MOCK_TENANT_ID,
    studentId: demand.studentId,
    feeDemandId: demand.id,
    // Globally unique — a receipt number is a legal document reference.
    receiptNo: `RCPT/2026/${String(i + 1).padStart(5, "0")}`,
    amount: demand.paidAmount,
    method: seededPick(
      ["ONLINE", "ONLINE", "ONLINE", "UPI", "UPI", "NEFT", "CASH", "CHEQUE"] as const,
      `${seed}-method`
    ),
    status: "SUCCESS",
    transactionId: `TXN${seededInt(100000000, 999999999, `${seed}-txn`)}`,
    gatewayRef: `pay_${seededInt(1000000, 9999999, `${seed}-gw`)}`,
    gatewayMeta: null,
    paidAt,
    remarks: null,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
});

export const PAYMENTS_BY_STUDENT = new Map<string, Payment[]>();
for (const payment of MOCK_PAYMENTS) {
  const existing = PAYMENTS_BY_STUDENT.get(payment.studentId);
  if (existing) existing.push(payment);
  else PAYMENTS_BY_STUDENT.set(payment.studentId, [payment]);
}

// --- Certificate templates --------------------------------------------------

/**
 * The markup a template holds.
 *
 * Placeholders use {{token}} — the convention the product spec names, and what
 * the issue flow substitutes at generation time. Structure and styling are
 * separate columns so a template can be restyled without touching its layout.
 */
function templateHtml(title: string, body: string): string {
  return `<div class="certificate">
  <header>
    <img class="logo" src="{{universityLogo}}" alt="" />
    <h1>{{universityName}}</h1>
  </header>

  <h2 class="title">${title}</h2>

  <p class="body">${body}</p>

  <footer>
    <div class="signature">
      <span>{{signatoryName}}</span>
      <small>{{signatoryDesignation}}</small>
    </div>
    <div class="meta">
      <span>Certificate No: {{certificateNo}}</span>
      <span>Issued: {{issueDate}}</span>
    </div>
    <img class="qr" src="{{qrCode}}" alt="Verification QR code" />
  </footer>
</div>`;
}

const BASE_CSS = `.certificate { padding: 48px; font-family: Georgia, serif; color: #0f172a; }
.certificate header { text-align: center; margin-bottom: 32px; }
.certificate .logo { height: 64px; }
.certificate .title { text-align: center; letter-spacing: 0.08em; text-transform: uppercase; }
.certificate .body { line-height: 2; text-align: justify; margin: 32px 0; }
.certificate footer { display: flex; justify-content: space-between; align-items: flex-end; }
.certificate .qr { height: 80px; }`;

export const MOCK_CERTIFICATE_TEMPLATES: CertificateTemplate[] = [
  {
    name: "Bonafide Certificate",
    type: "BONAFIDE" as const,
    body: "This is to certify that {{studentName}}, bearing enrolment number {{enrollmentNo}}, is a bonafide student of this institution, enrolled in {{programmeName}} during the academic year {{academicYear}}.",
  },
  {
    name: "Course Completion Certificate",
    type: "COMPLETION" as const,
    body: "This is to certify that {{studentName}} ({{enrollmentNo}}) has successfully completed {{programmeName}} with a final grade of {{grade}}.",
  },
  {
    name: "Character Certificate",
    type: "CONDUCT" as const,
    body: "This is to certify that {{studentName}} ({{enrollmentNo}}) bore a good moral character throughout their association with this institution.",
  },
  {
    name: "Provisional Degree Certificate",
    type: "PROVISIONAL" as const,
    body: "This is to certify that {{studentName}} ({{enrollmentNo}}) has fulfilled all requirements for the award of {{programmeName}}, pending formal conferral at the next convocation.",
  },
  {
    name: "Transfer Certificate",
    type: "MIGRATION" as const,
    body: "This is to certify that {{studentName}} ({{enrollmentNo}}) has no dues outstanding and is hereby permitted to seek admission elsewhere.",
  },
].map((seed, i) => ({
  id: mockId("ctpl", i + 1),
  tenantId: MOCK_TENANT_ID,
  name: seed.name,
  type: seed.type,
  htmlTemplate: templateHtml(seed.name, seed.body),
  cssStyles: BASE_CSS,
  variables: {
    studentName: "Student's full name",
    enrollmentNo: "Enrolment number",
    programmeName: "Programme name",
    academicYear: "Current academic year",
    certificateNo: "Generated certificate number",
    issueDate: "Date of issue",
  },
  isActive: true,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

export const TEMPLATE_BY_ID = new Map(
  MOCK_CERTIFICATE_TEMPLATES.map((template) => [template.id, template])
);

// --- Issued certificates ----------------------------------------------------

/**
 * Certificates issued to a slice of the register.
 *
 * A couple are revoked on purpose: revocation is the state the public
 * verification page most needs to render correctly, and it is unreachable if
 * every issued certificate is valid.
 */
export const MOCK_CERTIFICATES: Certificate[] = MOCK_STUDENTS.filter(
  (student) => seededInt(0, 9, `${student.id}-hascert`) > 6
).map((student, i): Certificate => {
  const seed = `cert-${student.id}`;
  const template = seededPick(MOCK_CERTIFICATE_TEMPLATES, `${seed}-template`);
  const issuedAt = daysAgo(seededInt(15, 400, `${seed}-issued`));
  const isRevoked = seededInt(0, 29, `${seed}-revoked`) === 0;

  return {
    id: mockId("cert", i + 1, 4),
    tenantId: MOCK_TENANT_ID,
    templateId: template.id,
    studentId: student.id,
    // The format the product spec names: CERT-<TYPE>-<YEAR>-<serial>.
    certificateNo: `CERT-${template.type}-2026-${String(i + 1).padStart(5, "0")}`,
    type: template.type,
    // Snapshotted at issue time, so editing the student record later cannot
    // rewrite an already-issued document.
    data: {
      studentName: student.enrollmentNo,
      enrollmentNo: student.enrollmentNo,
      issuedFor: template.name,
    },
    issuedAt,
    // Only a bonafide certificate expires — it attests to current enrolment,
    // which a degree certificate does not.
    expiresAt: template.type === "BONAFIDE" ? daysAgo(seededInt(-180, -30, `${seed}-exp`)) : null,
    pdfUrl: `https://cdn.eduos.dev/certificates/${student.id}-${template.type}.pdf`,
    qrCode: `https://verify.eduos.dev/c/CERT-${template.type}-2026-${String(i + 1).padStart(5, "0")}`,
    isRevoked,
    revokedAt: isRevoked ? daysAgo(seededInt(5, 14, `${seed}-revdate`)) : null,
    revokedBy: isRevoked ? "usr_emp_001" : null,
    createdAt: issuedAt,
  };
});

export const CERTIFICATE_BY_NUMBER = new Map(
  MOCK_CERTIFICATES.map((certificate) => [certificate.certificateNo, certificate])
);

// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Validation
// FLOW   : Validates the certificate route params and the issuance request body
//          before either reaches the database.
// ACCESS : Not defined. The README's Phase 12 table names the routes but states
//          no role for them, and no approved decision assigns one, so none is
//          assumed here. Access control is performed by requireRole and the
//          routes regardless — this module never inspects a caller.
// BACKEND: No database access — Zod schema definitions only. No uniqueness
//          check, no tenant check and no foreign-key existence check is
//          performed here; each belongs to the route. No certificate number is
//          generated, nothing is rendered and no certificate is issued or
//          revoked by this module.
// PURPOSE: Keep certificate request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { CertificateType } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "./pagination";

/**
 * Body schema for POST /api/certificates/issue.
 *
 * Mirrors the writable scalar columns of the Certificate model, in column order,
 * narrowed to the fields the approved Phase 12 resolution admits at issuance.
 *
 * templateId, studentId, certificateNo and type are required — all four columns
 * are NOT NULL and none carries a default. data, expiresAt, pdfUrl and qrCode are
 * optional because every one of those columns is nullable.
 *
 * The three id-bearing strings are validated as opaque non-empty keys and nothing
 * more. No format is asserted: templateId and studentId are cuids, but asserting
 * a shape would turn an unrecognised-but-well-formed id into a 400 where 404 is
 * the accurate answer. Neither is resolved here — this module performs no
 * database access, so template existence, student existence and tenant ownership
 * are all the route's to establish. Certificate.templateId and
 * Certificate.studentId both carry real foreign keys, unlike most id columns in
 * this project, but a foreign key proves a row exists somewhere rather than that
 * it belongs to the caller's tenant.
 *
 * certificateNo is required and client-supplied, per the approved resolution. It
 * is trimmed and must be non-empty, and that is the whole rule: the column is a
 * plain TEXT with no format constraint, so no pattern is asserted, and no
 * certificate number is generated here or anywhere in this module. Its @unique
 * constraint is not enforced here either — this module cannot see other rows, so
 * a collision is the database's to raise and the route's to map.
 *
 * type is validated directly against the Prisma enum, so the accepted values
 * cannot drift from the database. All nine members are permitted. The column has
 * no default, so unlike CertificateTemplate.type it is required rather than
 * optional. It is deliberately not compared against the chosen template's own
 * type: the schema declares no such link, and the comparison would require
 * reading the template.
 *
 * data is a Json? column with no declared structure. It is accepted as an object
 * with unconstrained keys and values, which is the project's settled treatment of
 * a Json column — the same z.record(z.string(), z.unknown()) used for
 * Campus.address, three StudentPersonal columns, two Tenant columns,
 * UserRole.scope and CertificateTemplate.variables. Nothing checks that a key
 * here corresponds to a variable the template declares, or to a placeholder its
 * markup uses; the schema declares no such link and the README states none.
 *
 * expiresAt is coerced through z.coerce.date(), the project-wide convention for
 * every DateTime column. It is optional and free-standing: no ordering rule
 * against issuedAt is applied, because the schema declares none and the approved
 * resolution states explicitly that the two are not to be compared.
 *
 * pdfUrl and qrCode are plain nullable TEXT columns. Both are trimmed and must be
 * non-empty when supplied, and neither is validated further — pdfUrl is not
 * checked to be a URL and qrCode is not checked to be any encoding, because the
 * schema declares neither. Nothing is rendered and no PDF or QR payload is
 * produced by this module.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId,
 *   createdAt    — server-managed. The tenant is derived from the validated
 *                  request context by requireTenant, never accepted from the
 *                  client, so a certificate cannot be issued against another
 *                  tenant.
 *   issuedAt     — not accepted from the client per the approved resolution. The
 *                  column's @default(now()) is authoritative, so issuance is
 *                  always stamped by the database and cannot be back-dated.
 *   isRevoked,
 *   revokedAt,
 *   revokedBy    — revocation fields, forbidden at issuance. A certificate cannot
 *                  be issued already revoked, and none of the three can be set
 *                  through this endpoint. They are written only by
 *                  POST /api/certificates/[id]/revoke, which derives all three
 *                  itself: isRevoked true, revokedAt the server clock, revokedBy
 *                  the authenticated user id. That endpoint takes no request body
 *                  at all, which is why this module exports no revoke schema —
 *                  the same reasoning that leaves
 *                  POST /api/assignments/[id]/publish without one.
 *
 * All eight are forbidden by omission rather than by an explicit reject rule. A
 * body supplying any of them has it stripped and never reaches the database,
 * which is the project-wide behaviour of a plain z.object(): no schema in this
 * project uses .strict(), and server-managed columns are excluded the same way in
 * every other validation module. The effect is what matters — none of these
 * columns is writable through issuance — and it is achieved without introducing a
 * rejection behaviour that exists nowhere else in the project.
 */
export const issueCertificateSchema = z.object({
  templateId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  /**
   * Optional since WP-1: omitted, the identifier engine issues it from the
   * institution's configured sequence (PRD §9). Supplied, the value is used
   * as given, which is what keeps legacy imports and institutions without a
   * configured sequence working exactly as before.
   */
  certificateNo: z.string().trim().min(1).optional(),
  type: z.enum(CertificateType),
  data: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.coerce.date().optional(),
  pdfUrl: z.string().trim().min(1).optional(),
  qrCode: z.string().trim().min(1).optional(),
});

export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

/**
 * Route param schema for /api/certificates/[id], used by the revoke endpoint.
 *
 * Certificate.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed id
 * into a 400 when 404 is the accurate answer. Only an empty or whitespace-only
 * segment is rejected outright. Keyed on id because that is the segment name.
 *
 * This is the only input POST /api/certificates/[id]/revoke has. That endpoint
 * carries no request body, so no revoke schema is declared here and none is
 * exported — a body schema would be dead code, exactly as it would be for
 * POST /api/assignments/[id]/publish.
 */
export const certificateIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type CertificateIdParam = z.infer<typeof certificateIdParamSchema>;

/**
 * Route param schema for /api/certificates/verify/[certNo].
 *
 * Keyed on certNo because that is the segment name the README gives the public
 * verification route.
 *
 * Certificate.certificateNo is a plain TEXT column carrying only a @unique
 * constraint — no length bound, no pattern, no generation rule. It is therefore
 * validated exactly as the column represents it: a trimmed, non-empty, free-form
 * string. No format is asserted, for the same reason no format is asserted on the
 * issuance side and for one more: this route is public, so an unrecognised number
 * must produce the same not-found answer as a merely unfamiliar one rather than a
 * 400 that would confirm which shapes exist.
 */
export const certificateNumberParamSchema = z.object({
  certNo: z.string().trim().min(1),
});

export type CertificateNumberParam = z.infer<typeof certificateNumberParamSchema>;

// GET /api/students/[id]/certificates declares no query schema of its own: it
// pages on the shared contract, and paginationQuerySchema is consumed directly
// by the route exactly as the timetable, attendance, assignment, examination,
// finance and certificate-template routes consume it.

/**
 * Query schema for GET /api/certificates — the tenant-wide collection.
 *
 * WHY THIS ONE DOES DECLARE q WHEN THE PER-STUDENT ROUTE DOES NOT
 *   The per-student route is already narrowed to one person, so there is
 *   nothing to search within it. The tenant-wide collection is not, and the
 *   screen that reads it (certificates/templates) renders a search box and
 *   sends ?q. Accepting the parameter and ignoring it would be worse than
 *   rejecting it: the box would appear to work and would silently return every
 *   certificate in the university for any search term.
 *
 *   The search is on certificateNo alone. That is the only free-text column
 *   Certificate carries — the student's name lives on User, two relations away,
 *   and searching it would mean a join this projection deliberately does not
 *   take. Narrow and true beats broad and surprising.
 */
export const listCertificatesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
});

export type ListCertificatesQuery = z.infer<typeof listCertificatesQuerySchema>;

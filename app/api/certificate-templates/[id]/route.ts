// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Template Detail
// FLOW   : Guard → tenant → params/body → tenant-scoped lookup → read the
//          template / apply one scoped update → response.
// ACCESS : GET   — UNIVERSITY_ADMIN
//          PATCH — UNIVERSITY_ADMIN
//          FACULTY, STUDENT and PARENT have no access to certificate templates.
// BACKEND: Prisma
// PURPOSE: Read and edit one certificate template belonging to the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  certificateTemplateIdParamSchema,
  updateCertificateTemplateSchema,
} from "@/lib/validations/certificate-template";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update. */
const RECORD_NOT_FOUND = "P2025";

/**
 * Columns returned for a certificate template. Declared once so both handlers
 * answer with the same shape, and identical to CERTIFICATE_TEMPLATE_SELECT in
 * the collection route so a template looks the same wherever it is read.
 *
 * No relation is expanded. The certificates relation is deliberately not nested:
 * unlike Curriculum.subjects or FeeStructure.components — which the detail routes
 * do nest, because a curriculum is its subjects and the README describes a fee
 * structure as "structure + components" — a certificate is a document *issued
 * from* a template rather than a part of it. The README describes this endpoint
 * as "Manage template" and gives issued certificates their own endpoints, so
 * nesting them here would both answer a different question and hang an unbounded,
 * ever-growing array off a single template.
 *
 * The tenant relation is not expanded either; tenantId is reported as the id,
 * as everywhere else in the project.
 */
const CERTIFICATE_TEMPLATE_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  htmlTemplate: true,
  cssStyles: true,
  variables: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// CertificateTemplate holds no BigInt and no Decimal column, so the shared
// serialize() helper is not applied here. variables is Json and serialises as
// itself; the DateTime columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN only, matching the collection route. A caller
//              holding FACULTY, STUDENT or PARENT receives the guard's 403.
// VALIDATION : certificateTemplateIdParamSchema — the [id] segment must be
//              non-empty once trimmed. No format assertion is applied: the id is
//              an opaque key, and asserting a shape would turn an
//              unrecognised-but-well-formed id into a 400 where 404 is the
//              accurate answer.
// FLOW       : Authorise → resolve tenant → read the template filtered by BOTH
//              id and tenantId.
//
//              findFirst rather than findUnique, so the tenant predicate is part
//              of the lookup itself rather than a check applied afterwards. A
//              template owned by another tenant is therefore not found, not
//              found-then-refused — the response is byte-identical to the one an
//              id that exists nowhere produces, so neither existence nor
//              ownership is ever disclosed. Both cases return the same body and
//              the same status, and no branch distinguishes them.
// RESPONSE   : { success: true, data: <CertificateTemplate> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              This handler performs no writes of any kind.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = certificateTemplateIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const certificateTemplate = await prisma.certificateTemplate.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: CERTIFICATE_TEMPLATE_SELECT,
    });

    if (!certificateTemplate) {
      return NextResponse.json(fail("Certificate template not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(certificateTemplate));
  } catch (err) {
    console.error("[GET /api/certificate-templates/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN only — the same single role that reads it.
// VALIDATION : certificateTemplateIdParamSchema for the [id] segment,
//              updateCertificateTemplateSchema for the body. Every writable
//              column is optional but at least one must be present, so an empty
//              body is a 400 rather than a silent no-op that would still advance
//              updatedAt. A body of nothing but unknown keys strips to empty and
//              is rejected by the same rule.
//
//              The update schema is derived from the create schema, so name and
//              htmlTemplate are still trimmed and still rejected when blank, type
//              is still checked against the Prisma CertificateType enum, isActive
//              is still a strict boolean and variables is still an object. id,
//              tenantId, createdAt and updatedAt are absent from the create
//              schema, so .partial() cannot introduce them and no body can reach
//              them — a template can never be re-identified, re-tenanted or
//              back-dated through this endpoint, and it cannot be moved between
//              tenants.
//
//              The template body is stored exactly as sent. htmlTemplate is not
//              parsed, not validated as markup, not escaped and not sanitised;
//              cssStyles is not parsed; placeholders are not resolved and are not
//              checked against variables in either direction. Each column is a
//              plain String or an unstructured Json in the schema, which asserts
//              nothing further, so asserting anything here would invent a rule.
// FLOW       : Authorise → resolve tenant → validate params → validate body →
//              confirm the template belongs to this tenant (404 otherwise) →
//              apply one update scoped by id AND tenantId.
//
//              The lookup and the update are both tenant-scoped, so the write
//              cannot reach another tenant's row even if an id were guessed, and
//              the 404 is byte-identical for an unknown id and a cross-tenant
//              one — exactly as in GET.
//
//              PARTIAL SEMANTICS. Only the keys the body supplied are written.
//              Zod's .partial() leaves an omitted key absent from the parsed
//              object rather than present-and-undefined, so the spread below
//              cannot mention a column the caller did not name, and every omitted
//              column keeps its stored value untouched. There is consequently no
//              way to clear a nullable column back to NULL through this endpoint,
//              and no database default is re-applied by an update — a default
//              belongs to insertion, and this statement inserts nothing.
//
//              updatedAt is not written here and is not writable at all: the
//              column is @updatedAt, so Prisma advances it on every successful
//              update. createdAt is likewise never touched.
//
//              No duplicate check is performed and no uniqueness is enforced.
//              CertificateTemplate declares no unique constraint of any kind —
//              no @unique column, no @@unique combination, only
//              @@index([tenantId]) — so renaming a template onto an existing
//              name, or retyping it to match another, is permitted exactly as the
//              database permits it, and a tenant may still hold any number of
//              simultaneously active templates of the same type. There is
//              nothing here resembling the code re-check in PATCH
//              /api/campuses/[id], because there is no constraint to re-check.
//
//              No lifecycle and no versioning is inferred. The model carries no
//              version column, no publishedAt, no status enum and no
//              supersededBy, so an edit replaces the template's content in place:
//              no prior version is retained, no history row is written, no
//              snapshot is taken, and no state transition is validated or
//              refused. Nothing here is illegal to change, so there is no
//              counterpart to the 409 ILLEGAL_STATE_TRANSITION used by the
//              assignment routes. Editing an inactive template is permitted, and
//              toggling isActive is an ordinary column update rather than a
//              transition.
//
//              Exactly one row is written, identified by id and tenantId. No
//              other template is touched, no Certificate row is read or written,
//              nothing is issued, numbered, rendered or revoked, and no sibling,
//              parent or child row is modified.
// RESPONSE   : { success: true, data: <CertificateTemplate>,
//                message: "Certificate template updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable, exactly as in
//              POST /api/certificate-templates and POST /api/fee-structures: the
//              model declares no unique constraint, so Prisma cannot raise P2002
//              here. It is mapped only from a real Prisma conflict, never from an
//              application rule, so a genuine constraint violation would surface
//              as a conflict rather than a 500 if the schema ever gains one.
//
//              P2025 is reachable and mapped: the template can be deleted between
//              the lookup and the update, and that race must report the same 404
//              the lookup itself would have.
//
//              No foreign-key branch is handled, and none is reachable. The only
//              foreign key is tenantId, which this endpoint cannot change.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = certificateTemplateIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = updateCertificateTemplateSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const certificateTemplateId = parsedParams.data.id;

    // Scoped by tenantId, so an unknown id and one owned by another tenant are
    // indistinguishable from here on.
    const existing = await prisma.certificateTemplate.findFirst({
      where: { id: certificateTemplateId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Certificate template not found", "NOT_FOUND"), { status: 404 });
    }

    const { variables, ...scalars } = parsedBody.data;

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own. The scalars spread carries only the keys the body
    // actually supplied, so every omitted column keeps its stored value. The JSON
    // column is cast at this boundary because Zod infers an unknown-valued
    // record, which Prisma's InputJsonValue does not accept directly.
    const certificateTemplate = await prisma.certificateTemplate.update({
      where: { id: certificateTemplateId, tenantId: tenant.id },
      data: {
        ...scalars,
        variables: variables as Prisma.InputJsonValue | undefined,
      },
      select: CERTIFICATE_TEMPLATE_SELECT,
    });

    return NextResponse.json(ok(certificateTemplate, "Certificate template updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — CertificateTemplate declares no unique
      // constraint — but mapped so a real constraint violation would never
      // surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Certificate template already exists", "CONFLICT"), {
          status: 409,
        });
      }
      // The template was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Certificate template not found", "NOT_FOUND"), {
          status: 404,
        });
      }
    }

    console.error("[PATCH /api/certificate-templates/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

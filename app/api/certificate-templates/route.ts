// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Template Collection
// FLOW   : Guard → tenant → query/body → list one tenant-scoped page / create
//          one template under the resolved tenant → response.
// ACCESS : GET  — UNIVERSITY_ADMIN
//          POST — UNIVERSITY_ADMIN
//          FACULTY, STUDENT and PARENT have no access to certificate templates.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's certificate templates and create new
//          ones.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createCertificateTemplateSchema } from "@/lib/validations/certificate-template";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a certificate template. Declared once so both handlers
 * answer with the same shape.
 *
 * Every scalar the model declares, and nothing else. No relation is expanded,
 * matching every other collection route in the project: the certificates
 * relation is a template's issued output rather than part of the template, and
 * expanding it would hang an unbounded child array off every row. The tenant
 * relation is not expanded either — tenantId is reported as the id, exactly as
 * FEE_STRUCTURE_SELECT and ASSIGNMENT_SELECT report theirs.
 *
 * No column is withheld. tenantId is included because every other collection
 * select in the project includes it, and htmlTemplate, cssStyles and variables
 * are included because they are the substance of a template — a list that
 * omitted them would describe templates without showing what any of them
 * contains. Nothing here is an internal field: all ten are declared columns of
 * the model, and the model declares no soft-delete flag, no ownership column and
 * no audit column to leak.
 *
 * htmlTemplate and cssStyles are unbounded text, so a page of large templates is
 * a large response. That is a property of the model rather than a decision taken
 * here, and no column-size or page-weight rule exists to apply — the shared
 * ?limit cap of 100 is the only bound. Recorded as technical debt rather than
 * resolved by inventing a projection this endpoint is not documented to have.
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
// itself — returned exactly as stored, byte for byte, with no reshaping; the
// DateTime columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN only. A single requireRole call decides access.
//              No two-tier logic is needed and none is invented: no other role is
//              permitted, so there is no second scope to define. A caller holding
//              FACULTY, STUDENT or PARENT receives the guard's 403 — the same 403
//              any unpermitted role receives.
//
//              CertificateTemplate carries no publication concept and no
//              visibility column, so nothing narrows the admin's scope either.
//              isActive is a stored flag, not a permission: an inactive template
//              is listed alongside an active one, because nothing in the schema
//              or the README says a template is hidden when it is inactive, and
//              filtering on it would answer a different question than the one
//              asked.
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the timetable,
//              attendance, assignment, examination and fee-structure routes;
//              lib/validations/certificate-template.ts declares no query alias
//              and says so explicitly.
//
//              No filter parameter is read, because the README documents none.
//              Its Phase 12 table describes this endpoint as "List / create HTML
//              templates" and names filters for no Phase 12 endpoint at all,
//              where it does name them for two Phase 11 ones. A supplied ?type,
//              ?isActive or ?name is therefore ignored rather than honoured or
//              rejected, which is what a plain z.object() does with an unknown
//              key — the project-wide behaviour, since no schema here uses
//              .strict(). Only ?page and ?limit change the result.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              certificate templates alongside the total in a single
//              transaction. Both queries are filtered by the tenant id that
//              requireTenant proved equal to the caller's own, so no cross-tenant
//              row is reachable, and the same where object backs both so the
//              total can never describe a wider set than the page.
//
//              Unlike FeeDemand and FeeStructure, CertificateTemplate.tenantId
//              carries a real foreign key — the model declares a tenant relation
//              — so the column is guaranteed to name an existing tenant. That
//              guarantee is about referential integrity only; the predicate here
//              is still what confines the read to one tenant.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              matching every other collection route in the project. It is
//              required for correctness rather than presentation: offset
//              pagination over an unordered result can repeat or skip rows across
//              pages, and templates created in the same batch can share a
//              createdAt timestamp, leaving createdAt alone non-deterministic.
//              The model declares no ordering column of its own to prefer.
// RESPONSE   : { success: true, data: { certificateTemplates, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsed = paginationQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
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

    const { page, limit } = parsed.data;
    const where = { tenantId: tenant.id };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [certificateTemplates, total] = await prisma.$transaction([
      prisma.certificateTemplate.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: CERTIFICATE_TEMPLATE_SELECT,
      }),
      prisma.certificateTemplate.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        certificateTemplates,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/certificate-templates]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN only — the same single role that reads them.
// VALIDATION : createCertificateTemplateSchema — name and htmlTemplate required,
//              both trimmed and non-empty; type, cssStyles, variables and
//              isActive optional. type is validated against the Prisma
//              CertificateType enum, so all nine members are accepted and nothing
//              else is. id, tenantId, createdAt and updatedAt are absent from the
//              schema and so are stripped from any body that supplies them, as is
//              every unknown key.
//
//              The template body is stored exactly as sent. htmlTemplate is not
//              parsed, not validated as markup, not escaped and not sanitised;
//              cssStyles is not parsed; placeholders are not resolved and are not
//              checked against variables in either direction. Each column is a
//              plain String or an unstructured Json in the schema, which asserts
//              nothing further, so asserting anything here would invent a rule —
//              and rewriting the content would mean storing something other than
//              what the caller asked to store. What a rendered certificate needs
//              is the renderer's obligation, and this route renders nothing.
// FLOW       : Authorise → resolve tenant → parse body → create one template
//              under the resolved tenant.
//
//              No reference lookup is performed, because there is no reference to
//              look up: the model declares exactly one foreign key, tenantId, and
//              its value comes from requireTenant rather than from the body. The
//              body cannot name a tenant at all — tenantId is not in the create
//              schema — so a template cannot be created under another tenant.
//
//              No duplicate check is performed and no uniqueness is enforced.
//              CertificateTemplate declares no unique constraint of any kind: no
//              @unique column, no @@unique combination, only @@index([tenantId]).
//              Two templates may therefore share a name, share a type, or share
//              both, exactly as the database permits — and a tenant may hold any
//              number of simultaneously active templates of the same type,
//              because nothing in the schema or the README limits that. No
//              only-one-active rule is applied, and none is inferred.
//
//              No lifecycle of any kind is inferred. The model carries no version
//              column, no publishedAt, no status enum and no supersededBy, so
//              creating a template neither supersedes an existing one nor records
//              that a previous version existed, and no other row is touched. This
//              handler writes exactly one row and modifies nothing else.
//
//              Nothing is issued, numbered, rendered or revoked here. A template
//              is the document's form; producing a document from it is a separate
//              endpoint in the README's Phase 12 table, and no Certificate row is
//              read or written by this route.
//
//              DEFAULTS. type and isActive are the only columns with database
//              defaults, and both are left to the database when the body omits
//              them. Zod's .optional() leaves an omitted key absent from the
//              parsed object rather than present-and-undefined, so the spread
//              below cannot introduce either key, and DEFAULT CUSTOM and DEFAULT
//              true apply untouched. Supplying isActive: false is honoured
//              exactly, since false is a value rather than an absence. variables
//              is nullable with no default, so an omitted key stores NULL; the
//              cast below names undefined only to satisfy the write-boundary
//              type, and Prisma drops an undefined key before building the
//              statement, so the emitted insert is identical to one that never
//              mentioned the column.
// RESPONSE   : { success: true, data: <CertificateTemplate>,
//                message: "Certificate template created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable, exactly as in
//              POST /api/fee-structures: the model declares no unique constraint,
//              so Prisma cannot raise P2002 here. It is mapped only from a real
//              Prisma conflict, never from an application rule, so a genuine
//              constraint violation would surface as a conflict rather than a 500
//              if the schema ever gains one. It enforces nothing today.
//
//              No foreign-key branch is handled. The only foreign key is
//              tenantId, and requireTenant has already resolved that tenant from
//              the request host, so the referenced row was read moments earlier.
//              This is the same treatment POST /api/campuses gives the identical
//              situation.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createCertificateTemplateSchema.safeParse(body);
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

    const { variables, ...scalars } = parsed.data;

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body. The
    // scalars spread carries only the keys the body actually supplied, so an
    // omitted type or isActive is absent rather than undefined and the database
    // default stands. The JSON column is cast at this boundary because Zod infers
    // an unknown-valued record, which Prisma's InputJsonValue does not accept
    // directly.
    const certificateTemplate = await prisma.certificateTemplate.create({
      data: {
        ...scalars,
        tenantId: tenant.id,
        variables: variables as Prisma.InputJsonValue | undefined,
      },
      select: CERTIFICATE_TEMPLATE_SELECT,
    });

    return NextResponse.json(ok(certificateTemplate, "Certificate template created"), {
      status: 201,
    });
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
    }

    console.error("[POST /api/certificate-templates]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

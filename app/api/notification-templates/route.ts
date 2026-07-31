// ============================================================================
// OWNER  : Gauransh
// MODULE : Email Notifications — Notification Template Collection
// FLOW   : Guard → tenant → query/body → list one tenant-scoped page / create
//          one template under the resolved tenant → response.
// ACCESS : GET  — UNIVERSITY_ADMIN
//          POST — UNIVERSITY_ADMIN
//          FACULTY, STUDENT and PARENT have no access to notification templates.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's notification templates and create new
//          ones.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createNotificationTemplateSchema } from "@/lib/validations/notification-template";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a notification template. Declared once so both handlers
 * answer with the same shape.
 *
 * Every scalar the model declares, and nothing else. The notifications relation
 * is not expanded, matching every other collection route in the project: a
 * template accumulates one row per notification sent from it, so nesting it would
 * make a page unbounded.
 *
 * isActive is reported even though this route never writes it, because it is a
 * column of the row and its database default is what a freshly created template
 * carries — reporting it is what makes that default verifiable from the response.
 */
const NOTIFICATION_TEMPLATE_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  subject: true,
  body: true,
  variables: true,
  isActive: true,
  createdAt: true,
} as const;

// NotificationTemplate holds no BigInt and no Decimal column, so the shared
// serialize() helper is not applied here. variables is Json and serialises as
// itself; createdAt carries its own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN only. A single requireRole call decides access.
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias; lib/validations/notification-template.ts
//              declares no query alias. The README defines no filter parameter for
//              this endpoint, so a supplied ?type or ?isActive is stripped and
//              ignored rather than honoured or rejected.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              templates alongside the total in a single transaction.
//
//              Both queries filter on the tenant id requireTenant proved equal to
//              the caller's own. NotificationTemplate.tenantId is nullable and
//              carries no foreign key — the model declares no tenant relation at
//              all — but that nullability is deliberately not exploited here: an
//              equality predicate never matches NULL, so a row with no tenant is
//              simply absent from every response. No global or shared template is
//              implemented, read or created by this route.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              the project's standard collection ordering. It is required for
//              correctness rather than presentation: offset pagination over an
//              unordered result can repeat or skip rows, and templates written in
//              one batch can share a createdAt timestamp, leaving createdAt alone
//              non-deterministic.
// RESPONSE   : { success: true, data: { notificationTemplates, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

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

    // An equality predicate never matches NULL, so a tenant-less row is
    // unreachable here — global templates are neither read nor implemented.
    const where = { tenantId: tenant.id };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [notificationTemplates, total] = await prisma.$transaction([
      prisma.notificationTemplate.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: NOTIFICATION_TEMPLATE_SELECT,
      }),
      prisma.notificationTemplate.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        notificationTemplates,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/notification-templates]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN only — the same single role that reads them.
// VALIDATION : createNotificationTemplateSchema — name, type, subject and body
//              required; variables optional. type is validated against the Prisma
//              NotificationType enum. id, tenantId, createdAt and isActive are
//              absent from the schema and so are stripped from any body that
//              supplies them, as is every unknown key.
//
//              Content is stored exactly as validated. body and subject are not
//              parsed, not validated as markup, not escaped and not sanitised;
//              placeholders are not resolved and are not checked against
//              variables in either direction. Nothing is rendered and no email is
//              sent by this route.
// FLOW       : Authorise → resolve tenant → parse body → create one row.
//
//              No reference lookup is performed, because there is no reference to
//              look up: the model declares no foreign key on any column. tenantId
//              is written from the resolved tenant context and can never come from
//              the body, so a template cannot be created under another tenant —
//              and because the schema's tenantId is nullable, it also cannot be
//              created without one: this route always writes a concrete tenant id
//              and never leaves the column NULL.
//
//              No duplicate check is performed and no uniqueness is enforced.
//              NotificationTemplate declares no unique constraint of any kind —
//              only @@index([tenantId]) — so two templates may share a name, a
//              type, or both, exactly as the database permits.
//
//              DEFAULTS. isActive is the only column with a database default and
//              is never written here, so DEFAULT true applies untouched and every
//              template is created active. id and createdAt are likewise never
//              mentioned. Zod's .optional() leaves an omitted variables key absent
//              from the parsed object rather than present-and-undefined; the cast
//              below names undefined only to satisfy the write-boundary type, and
//              Prisma drops an undefined key before building the statement, so the
//              emitted insert is identical to one that never mentioned the column.
// RESPONSE   : { success: true, data: <NotificationTemplate>,
//                message: "Notification template created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable, as in
//              POST /api/certificate-templates and POST /api/fee-structures: the
//              model declares no unique constraint, so Prisma cannot raise P2002
//              here. It is mapped only from a real Prisma conflict, never from an
//              application rule.
//
//              No foreign-key branch is handled, and none is reachable: the model
//              declares no foreign key on any column, not even tenantId.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createNotificationTemplateSchema.safeParse(body);
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
    // comes from the resolved tenant context, never from the request body, and is
    // always concrete: this route never writes the nullable column as NULL. The
    // JSON column is cast at this boundary because Zod infers an unknown-valued
    // record, which Prisma's InputJsonValue does not accept directly.
    const notificationTemplate = await prisma.notificationTemplate.create({
      data: {
        ...scalars,
        variables: variables as Prisma.InputJsonValue | undefined,
        tenantId: tenant.id,
      },
      select: NOTIFICATION_TEMPLATE_SELECT,
    });

    return NextResponse.json(ok(notificationTemplate, "Notification template created"), {
      status: 201,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — NotificationTemplate declares no unique
      // constraint — but mapped so a real constraint violation would never
      // surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Notification template already exists", "CONFLICT"), {
          status: 409,
        });
      }
    }

    console.error("[POST /api/notification-templates]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

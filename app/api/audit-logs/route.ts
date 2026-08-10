// ============================================================================
// OWNER  : Gauransh
// MODULE : Audit & Governance — Audit Log Viewer (WP-2, PRD §47)
// FLOW   : Guard → tenant → validate query → tenant-scoped read → response.
// ACCESS : UNIVERSITY_ADMIN only.
// BACKEND: Prisma
// PURPOSE: Read this institution's audit trail.
//
// THIS FILE EXPORTS GET AND NOTHING ELSE — THAT IS THE IMMUTABILITY DESIGN
//   No POST, no PATCH, no DELETE, here or anywhere. Audit records are evidence:
//   a record that can be edited by the person it incriminates is not evidence
//   of anything. Writes happen only server-side, through audit.service.ts,
//   inside the transaction of the change being described. There is no HTTP path
//   to creating, altering or removing one.
//
//   This is enforcement by absence rather than by a database trigger. Postgres
//   rules or a revoked UPDATE grant would be stronger, but Prisma's migration
//   engine does not manage grants and the application connects as the owner, so
//   a trigger would be one `migrate` away from being dropped without anybody
//   noticing. The absent handler cannot be bypassed by an HTTP client at all,
//   which is the threat this actually defends against. The residual risk —
//   direct database access — is recorded in TECHNICAL_DEBT.md.
//
// WHY UNIVERSITY_ADMIN AND NOT ALSO SUPER_ADMIN
//   PRD §47 lists the audit trail among a university's governance records, and
//   §2.2 makes each tenant's data separate. Nothing in the PRD grants the
//   platform owner read access to a university's audit trail, and an audit log
//   is the most sensitive collection in the product — it names who did what to
//   whom. Granting cross-tenant visibility on a guess would be exactly the kind
//   of invented requirement the brief forbids, so SUPER_ADMIN receives 403 and
//   the question is recorded for the product owner.
//
// EVERY FILTER HERE IS REAL
//   action, resource, resourceId, status, userId and a date range are all
//   applied in the WHERE clause below. There is no free-text search, because
//   the columns that would need it — before and after — are Json, and Postgres
//   cannot index a substring search across them at this scale. The UI shows no
//   search box rather than one that quietly does nothing.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { auditLogQuerySchema } from "@/lib/validations/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns the LIST returns.
 *
 * `before` and `after` are deliberately ABSENT. They are the sensitive part of
 * an audit row — a snapshot may name a student, an amount or an email — and a
 * list of twenty would move twenty of them over the wire to render a table that
 * shows none. They are fetched only when a reader opens one entry, which is
 * itself an authorised, single-row request.
 */
const AUDIT_LIST_SELECT = {
  id: true,
  action: true,
  resource: true,
  resourceId: true,
  userId: true,
  status: true,
  correlationId: true,
  ipAddress: true,
  createdAt: true,
} as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : auditLogQuerySchema — strict, so a misspelled filter is a 400
//              rather than a silently unfiltered page of somebody's audit trail.
// FLOW       : The WHERE clause always pins tenantId to the resolved tenant, so
//              no combination of query parameters can widen the read beyond the
//              caller's own institution. Count and page are read in one
//              transaction so the total cannot disagree with the rows.
// RESPONSE   : { success: true, data: { entries, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = auditLogQuerySchema.safeParse(
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

    const { page, limit, action, resource, resourceId, status, userId, from, to } =
      parsed.data;

    // tenantId is set FIRST and never from user input. Every other clause
    // narrows within it.
    const where = {
      tenantId: tenantGuard.tenant.id,
      ...(action ? { action } : {}),
      ...(resource ? { resource } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(status ? { status } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              // `to` is inclusive of the whole day the reader named — the
              // schema advances it to the following midnight, so an entry at
              // 23:59 on the end date is not silently excluded.
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
    };

    const [entries, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        select: AUDIT_LIST_SELECT,
        // Newest first, id as the tiebreaker: several entries from one request
        // share a timestamp to the millisecond, and without it page boundaries
        // would shuffle between requests.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        entries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/audit-logs]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Audit & Governance — one audit entry (WP-2, PRD §47)
// FLOW   : Guard → tenant → param → tenant-scoped read → response.
// ACCESS : UNIVERSITY_ADMIN only.
// BACKEND: Prisma
// PURPOSE: Read one entry INCLUDING its before/after snapshots.
//
// WHY THE SNAPSHOTS LIVE HERE AND NOT ON THE LIST
//   `before` and `after` are the sensitive part of an audit row — a snapshot
//   may carry a student's identifier, a fee amount, an email address. The list
//   endpoint omits them so browsing the trail does not stream twenty of them
//   over the wire to render a table that displays none. Reading one is a
//   deliberate, single-row, authorised act, and that is what this route is.
//
//   Least privilege, per the brief: the same role may read both, but the
//   sensitive payload is only transferred when it is actually asked for.
//
// NO PATCH, NO DELETE — see the collection route's header for the full
// reasoning. Evidence that its subject can edit is not evidence.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { auditLogParamSchema } from "@/lib/validations/audit";
import { ok, fail } from "@/types";

/**
 * Everything the list returns, plus the snapshots and the user agent.
 *
 * tenantId is NOT selected. The caller already knows which tenant they are —
 * requireTenant proved it — and echoing it back only adds an id to a payload
 * that is read by a person.
 */
const AUDIT_DETAIL_SELECT = {
  id: true,
  action: true,
  resource: true,
  resourceId: true,
  userId: true,
  status: true,
  correlationId: true,
  before: true,
  after: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : auditLogParamSchema — the [id] segment must be non-empty.
// FLOW       : findFirst scoped by BOTH id and tenantId, so an id belonging to
//              another institution matches nothing and answers 404 — the same
//              answer an id that does not exist gets, so the response confirms
//              nothing about another tenant's data.
// RESPONSE   : { success: true, data: <entry> }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = auditLogParamSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const entry = await prisma.auditLog.findFirst({
      where: { id: parsed.data.id, tenantId: tenantGuard.tenant.id },
      select: AUDIT_DETAIL_SELECT,
    });

    if (!entry) {
      return NextResponse.json(fail("Audit entry not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(entry));
  } catch (err) {
    console.error("[GET /api/audit-logs/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

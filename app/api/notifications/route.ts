// ============================================================================
// OWNER  : Gauransh
// MODULE : Email Notifications — Notification List
// FLOW   : Guard → tenant → query → tenant-scoped paginated read → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT have no access —
//          notably a STUDENT cannot read even their own notifications here.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's recorded notifications, exactly as
//          stored.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a notification.
 *
 * Every scalar the model declares, and nothing else. No relation is expanded:
 * Notification declares tenant and template relations and neither is taken, so no
 * template is read and no markup can enter this response. userId carries no
 * relation to expand even if one were wanted — the column has no foreign key at
 * all — so the recipient is reported as the bare id the row stores and no User
 * row is read.
 *
 * The four delivery columns are reported exactly as stored. status is whatever
 * the database holds, sentAt, readAt and error are reported including their
 * nulls, and nothing here derives a delivery state from them.
 */
const NOTIFICATION_SELECT = {
  id: true,
  tenantId: true,
  templateId: true,
  userId: true,
  type: true,
  subject: true,
  body: true,
  data: true,
  sentAt: true,
  readAt: true,
  status: true,
  error: true,
  createdAt: true,
} as const;

// Notification holds no BigInt and no Decimal column, so the shared serialize()
// helper is not applied here. data is Json and serialises as itself; the DateTime
// columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN only. A single requireRole call decides access,
//              matching POST /api/notifications/send and both
//              notification-template handlers. No elevated-first two-tier logic
//              appears here: no second role is permitted, so there is no second
//              scope to define and no self-access branch to build.
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias; no notification validation module
//              exists and none is created here.
//
//              No filter parameter is read. The README's Phase 13 table describes
//              this endpoint as "List sent notifications" and names no filter for
//              it, so a supplied ?status, ?type or ?userId is stripped and ignored
//              rather than honoured or rejected — the project-wide behaviour of a
//              plain z.object(). Only ?page and ?limit change the result.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              notifications alongside the total in a single transaction.
//
//              Both queries are filtered by the tenant id requireTenant proved
//              equal to the caller's own, so no cross-tenant row is reachable, and
//              the same where object backs both so the total can never describe a
//              wider set than the page. Notification.tenantId carries a real
//              foreign key to Tenant and is NOT NULL, so unlike
//              NotificationTemplate there is no nullable global row to consider —
//              every notification belongs to exactly one tenant.
//
//              No other model is read. The template is not fetched, so its subject
//              and body never enter this request; no User row is fetched, so no
//              recipient's name or email is reached.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              the project's standard collection ordering. It is required for
//              correctness rather than presentation: offset pagination over an
//              unordered result can repeat or skip rows across pages, and a single
//              send writes every one of its rows with one createMany, so an entire
//              batch shares a createdAt timestamp and createdAt alone is not
//              deterministic. The id tiebreaker is what separates them.
// REPORTS    : Every notification the tenant holds, exactly as stored. Nothing is
//              filtered and nothing is derived. Rows are not narrowed to those
//              actually delivered despite the README's "List sent notifications":
//              status is a stored column rather than a predicate, and treating
//              PENDING as invisible would invent a visibility rule the schema does
//              not express — every row would be hidden today, since nothing sets
//              status. No delivery state is computed, no valid, isSent, isDelivered
//              or isFailed field is invented, and sentAt is never compared to now.
//
//              Nothing is sent, retried or transitioned. No status is changed, no
//              row is marked read, and no delivery is attempted.
// RESPONSE   : { success: true, data: { notifications, pagination } }
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
    const [notifications, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: NOTIFICATION_SELECT,
      }),
      prisma.notification.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        notifications,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/notifications]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

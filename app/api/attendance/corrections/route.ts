// ============================================================================
// MODULE : Attendance correction requests (PRD §13.2)
// LAYER  : Route handler
// PURPOSE: Raise a correction against an attendance record, and read the queue.
//
// RAISING ONE CHANGES NOTHING
//   POST writes a request row and does not touch the register. The mark keeps
//   its value until somebody authorised to change it approves — which is the
//   whole reason this exists rather than a PATCH on the attendance record.
//
// THE LOCK IS NOT CONSULTED HERE, DELIBERATELY
//   assertWritable still guards POST /api/attendance and DELETE
//   /api/attendance/[id]. It is not applied to this path because a lock exists
//   to stop casual edits to a finalised register, and if it also stopped
//   corrections then a locked register could never be corrected — the one thing
//   corrections are for. See lib/services/attendanceCorrection.service.ts.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { readRequestOrigin } from "@/lib/middleware/requireAttendanceLockAccess";
import {
  ATTENDANCE_CORRECTION_READ_ROLES,
  ATTENDANCE_CORRECTION_REQUEST_ROLES,
  ATTENDANCE_CORRECTION_REVIEW_ROLES,
} from "@/lib/constants/attendanceCorrection";
import { hasAnyRole } from "@/constants/roles";
import {
  listCorrections,
  raiseCorrection,
} from "@/lib/services/attendanceCorrection.service";
import {
  listCorrectionsQuerySchema,
  raiseCorrectionSchema,
} from "@/lib/validations/attendanceCorrection";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/attendance/corrections";
const POST_SCOPE = "POST /api/attendance/corrections";

// GET
// ACCESS   : ATTENDANCE_CORRECTION_READ_ROLES — everyone who participates, but
//            they do not all see the same rows. A reviewer gets the tenant's
//            queue because deciding it is their job; anybody else gets only the
//            requests they raised themselves.
// RESPONSE : { success: true, data: { requests } }
// STATUS   : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...ATTENDANCE_CORRECTION_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsed = listCorrectionsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    // A lecturer may read their own corrections; they may not read the
    // university's. Narrowing here rather than in the service keeps the
    // reviewer's unrestricted read explicit at the place that is entitled to it.
    const canReview = hasAnyRole(guard.session.roles, ATTENDANCE_CORRECTION_REVIEW_ROLES);

    const requests = await listCorrections(
      tenantGuard.tenant.id,
      parsed.data.status,
      canReview ? undefined : guard.session.sub
    );

    return NextResponse.json(ok({ requests }));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS   : ATTENDANCE_CORRECTION_REQUEST_ROLES — the same set that may lock a
//            register. The people who own it are the people who notice it is
//            wrong.
// BODY     : attendanceId, requestedStatus, reason.
// RESPONSE : { success: true, data: request }
// STATUS   : 201 · 400 · 401 · 403 · 404 · 409 · 422 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole(...ATTENDANCE_CORRECTION_REQUEST_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = raiseCorrectionSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const origin = readRequestOrigin(request.headers);

    const created = await raiseCorrection(tenantGuard.tenant.id, parsed.data, {
      // The requester is the authenticated subject. Nothing in the body names
      // who is asking, so nothing in the body can misattribute a correction.
      userId: guard.session.sub,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    });

    return NextResponse.json(ok(created, "Correction request submitted"), { status: 201 });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}

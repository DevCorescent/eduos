// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score — External Marks Upload
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION.
//
//          FACULTY IS ABSENT, AND THAT IS THE ENTIRE POINT OF THIS ENDPOINT.
//          A university examination is marked under the examination
//          controller's authority. A lecturer holding only FACULTY receives
//          requireRole's 403 here and must use /api/results/internal, which
//          confines them to sittings they conduct.
// BACKEND: studentComponentScoreController → StudentComponentScoreService →
//          StudentComponentScoreRepository / AuditLogRepository → Prisma.
// PURPOSE: Record university examination marks for one sitting.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentComponentScoreController } from "@/lib/controllers/studentComponentScore.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  EXTERNAL_MARK_UPLOAD_ROLES,
  MARK_AUDIT_ACTION,
} from "@/lib/constants/studentComponentScore";
import { uploadMarksSchema } from "@/lib/validations/studentComponentScore";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/results/external";

// POST
// ACCESS     : EXTERNAL_MARK_UPLOAD_ROLES — administration and the examination
//              controller only. There is no confinement to conducted sittings
//              here, because there is no role admitted that needs one: the
//              registry legitimately records marks for any sitting in its
//              tenant.
// VALIDATION : uploadMarksSchema — the same contract as the internal endpoint.
//              The two differ in WHO may call them and in the audit action
//              recorded, not in what a marks payload looks like. Sharing the
//              schema is deliberate: two copies would drift, and a marks sheet
//              is a marks sheet whoever signs it off.
// FLOW       : Authorise → resolve tenant → validate → build the audit context
//              → controller.
//
//              Every academic rule is applied in the service, identically to
//              the internal path: the sitting must be OPEN, its regulation
//              still ACTIVE, and every registration must belong to this course,
//              term, teaching group and regulation and still be live. The whole
//              upload is one transaction, so a single bad row writes nothing.
// RESPONSE   : { success: true, data: MarkUploadResultDTO,
//                message: "External marks recorded" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              403 — a caller holding only FACULTY. This is the boundary the
//                    endpoint exists to draw.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole(...EXTERNAL_MARK_UPLOAD_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = uploadMarksSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await studentComponentScoreController.upload(
      tenantGuard.tenant.id,
      parsedBody.data,
      {
        action: MARK_AUDIT_ACTION.EXTERNAL_UPLOADED,
        // No role reaching this endpoint is confined to its own sittings.
        restrictToConductedEvents: false,
      },
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(result, "External marks recorded"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

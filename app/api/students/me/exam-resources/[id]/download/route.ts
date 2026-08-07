// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → controller → response.
// ACCESS : EXAM_RESOURCE_STUDENT_ROLES — STUDENT only.
// BACKEND: examResourceController → ExamResourceService → exam-resources
//          visibility domain → ExamResourceRepository → Prisma.
// PURPOSE: The README's "Download Question Papers", "Download Solutions" and
//          "Download Marking Scheme".
//
// THIS RETURNS DATA, NOT A FILE
//   Nothing in this project streams bytes, and no storage client exists to
//   stream from — verified before this phase was written. The Phase 17 receipt
//   download made exactly the same choice for exactly the same reason (see its
//   header). This route returns the standard JSON envelope carrying `fileUrl`,
//   and a client follows it.
//
// THE URL IS SERVED HERE AND NOWHERE ELSE
//   Neither the student list nor the student detail response carries `fileUrl`.
//   That is deliberate: a list endpoint that included it could be scraped for
//   every paper's location in one request, whereas this endpoint is reached one
//   resource at a time and re-checks entitlement on every call.
//
// ENTITLEMENT IS RE-CHECKED, NOT ASSUMED
//   Having listed or viewed a resource earlier grants nothing. This route
//   resolves the student, reads their registrations, and applies the visibility
//   predicate again — so a paper archived or unpublished since the list was
//   fetched is refused here.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { EXAM_RESOURCE_STUDENT_ROLES } from "@/lib/constants/examResource";
import { examResourceParamSchema } from "@/lib/validations/examResource.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/students/me/exam-resources/[id]/download";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireRole(STUDENT) then requireTenant.
// VALIDATION : examResourceParamSchema.
// FLOW       : Guard → validate → controller.
//
//              A resource the student may not download — unknown, another
//              tenant's, a course they are not registered for, a draft, an
//              archived paper, or one whose scheduled release has not arrived —
//              returns the identical 404. No id is ever confirmed to exist.
// RESPONSE   : { success: true, data: ExamResourceDownloadDto } — the resource
//              as the student sees it, plus `fileUrl`.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind. No download counter
//              is incremented: ExamResource declares no such column, and
//              inventing one would be a schema change this phase's
//              specification does not name.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EXAM_RESOURCE_STUDENT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = examResourceParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    const download = await examResourceController.downloadForStudent(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsed.data.id,
      new Date()
    );

    return NextResponse.json(ok(download));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

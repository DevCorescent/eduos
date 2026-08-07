// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → controller → response.
// ACCESS : EXAM_RESOURCE_STUDENT_ROLES — STUDENT only.
// BACKEND: examResourceController → ExamResourceService → exam-resources
//          visibility domain → ExamResourceRepository → Prisma.
// PURPOSE: The README's "View Question Papers" / "View Official Solutions" for
//          one resource.
//
// A RESOURCE THE STUDENT MAY NOT SEE IS A 404, NEVER A 403
//   Unknown id, another tenant's resource, a course the student is not
//   registered for, a draft, an archived paper and a published-but-not-yet-due
//   paper all return the identical 404. A 403 would confirm the resource exists
//   and is merely withheld — which is precisely how a student learns there is
//   an unpublished answer key worth asking about.
//
// NO fileUrl IN THIS RESPONSE EITHER
//   Viewing metadata and obtaining the download location are separate actions
//   with separate endpoints, so a client that only lists and views never
//   handles the URL.
//
// THIS PATH DOES NOT COLLIDE WITH PHASE 6's /api/students/[id]
//   `me` is a static segment and `[id]` is dynamic, so Next.js resolves
//   /api/students/me/... here and never treats "me" as a student id.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { EXAM_RESOURCE_STUDENT_ROLES } from "@/lib/constants/examResource";
import { examResourceParamSchema } from "@/lib/validations/examResource.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/students/me/exam-resources/[id]";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireRole(STUDENT) then requireTenant.
// VALIDATION : examResourceParamSchema.
// FLOW       : Guard → validate → controller.
//
//              The caller is resolved from session.sub to their own Student
//              row; a caller holding STUDENT but owning no Student row is 403.
//              The lookup then applies BOTH the registration confinement and
//              the visibility predicate in one statement, so an invisible row
//              never enters the process at all.
// RESPONSE   : { success: true, data: StudentExamResourceDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EXAM_RESOURCE_STUDENT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = examResourceParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    const resource = await examResourceController.getForStudent(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsed.data.id,
      new Date()
    );

    return NextResponse.json(ok(resource));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

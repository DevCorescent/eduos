// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme — Archival
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION.
// BACKEND: evaluationSchemeController → EvaluationSchemeService →
//          EvaluationSchemeRepository / AuditLogRepository → Prisma.
// PURPOSE: Retire an active regulation that has no successor.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { evaluationSchemeController } from "@/lib/controllers/evaluationScheme.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { EVALUATION_SCHEME_MANAGE_ROLES } from "@/lib/constants/evaluationScheme";
import { evaluationSchemeIdParamSchema } from "@/lib/validations/evaluationScheme";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/evaluation-schemes/[id]/archive";

// POST
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationSchemeIdParamSchema. No body is read.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              This endpoint retires a regulation WITHOUT a successor — the
//              university has stopped using it and nothing replaces it. A
//              retirement WITH a successor is not performed here: activating
//              the next draft archives the outgoing revision as part of that
//              single transaction, which is the only way supersededById can be
//              set correctly.
//
//              Archival is terminal. An archived regulation is never revived,
//              because reviving one would silently change the meaning of every
//              result already computed under it; the correct move is always a
//              new version.
//
//              The row is retained forever. Results reference a specific
//              revision id, so deleting an archived regulation would make a
//              historical grade card unexplainable.
// RESPONSE   : { success: true, data: EvaluationSchemeDetailDTO,
//                message: "Evaluation scheme archived" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              409 — the revision is not ACTIVE. A draft is discarded through
//                    DELETE, not archived, and an archived revision is already
//                    in its terminal state.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = evaluationSchemeIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const scheme = await evaluationSchemeController.archive(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(scheme, "Evaluation scheme archived"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

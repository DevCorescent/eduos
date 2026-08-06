// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme — Activation
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION.
//          Activation is the moment a regulation becomes binding on every
//          student it governs, so it is restricted to the two roles that own
//          the examination process. DEPARTMENT_HOD and FACULTY may read a
//          regulation but never authorise one.
// BACKEND: evaluationSchemeController → EvaluationSchemeService →
//          EvaluationSchemeRepository / AuditLogRepository → Prisma.
// PURPOSE: Promote a draft revision to ACTIVE and supersede the one it
//          replaces.
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

const SCOPE = "POST /api/evaluation-schemes/[id]/activate";

// POST
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationSchemeIdParamSchema. No body is read — activation
//              carries no parameters. Everything it needs is either stored on
//              the revision or derived from the verified session.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              The service performs the whole operation in ONE serializable
//              transaction: it verifies the revision is a DRAFT, verifies the
//              grade scale it cites is itself ACTIVE, archives whichever
//              revision of the same code is currently active and points its
//              supersededById at the incoming one, then activates the incoming
//              revision and writes the audit entry. There is no window in which
//              a tenant has two active revisions of one code, or none.
//
//              SERIALIZABLE is required rather than merely prudent: two
//              concurrent activations of two different drafts touch two
//              different rows, so no row lock can bring them into conflict, and
//              both would otherwise observe "nothing is active" and commit.
// RESPONSE   : { success: true, data: EvaluationSchemeDetailDTO,
//                message: "Evaluation scheme activated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              409 — the revision is not a DRAFT, the grade scale it cites is
//                    not ACTIVE, or a concurrent activation won the
//                    serialization conflict. The last case is retryable and
//                    says so in its message.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = evaluationSchemeIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const scheme = await evaluationSchemeController.activate(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(scheme, "Evaluation scheme activated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

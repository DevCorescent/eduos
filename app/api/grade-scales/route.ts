// ============================================================================
// MODULE : Grade Scale — Collection (read-only)
// LAYER  : Route
// FLOW   : Guard → tenant → module → read this tenant's scales → response.
// ACCESS : EVALUATION_SCHEME_READ_ROLES — UNIVERSITY_ADMIN ·
//          CONTROLLER_OF_EXAMINATION · DEPARTMENT_HOD · FACULTY.
// BACKEND: Prisma
// PURPOSE: Name the grade scales a regulation may cite, in the exact terms
//          POST /api/evaluation-schemes will accept.
//
// WHY THIS ROUTE HAD TO EXIST
//   createEvaluationSchemeSchema REQUIRES gradeScaleId, and until now NOTHING
//   in the project could resolve one: GradeScale had a full model, a version
//   chain and a status machine, but no route, no controller, no service and no
//   validation module anywhere. A client could therefore not discover a single
//   legal value, which made "create a scheme" unreachable from any UI no matter
//   which role was signed in. That is one of the two independent causes of the
//   reported defect.
//
//   Read-only, and deliberately so. It adds no mutation, no lifecycle
//   operation and no capability beyond naming a lookup the schemes module
//   already depends on. Authoring a grade scale remains outside this project's
//   API surface, exactly as it was.
//
// WHY THIS DISCLOSES NOTHING NEW
//   The guard is the SCHEMES' own read set, not a wider one, and every column
//   returned here is already served to those same roles by
//   GET /api/evaluation-schemes/[id]: EvaluationSchemeDetailDTO embeds the
//   scale's code, name, version, status, method and maxGradePoint. This route
//   lists what that route already shows one at a time.
//
// SECURITY: tenant comes from requireTenant and is never read from the request,
//           so one university can only ever enumerate its own scales.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { EVALUATION_SCHEME_READ_ROLES } from "@/lib/constants/evaluationScheme";
import { handleRouteError } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/grade-scales";

/**
 * How many scales one tenant can be offered.
 *
 * A grading regulation is a handful of named scales plus their revisions; this
 * is a ceiling against a runaway import rather than a page size. The response
 * is deliberately unpaginated because a select's option list is read whole —
 * the same reasoning as GET /api/faculty/me/teaching.
 */
const MAX_SCALES = 200;

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : none. There is nothing for a client to supply — no filter, no
//              page, and no id. Adding a query parameter would be adding a
//              capability this exists only to unblock.
// FLOW       : Authorise → resolve tenant → apply the module gate → read.
//
//              EVERY status is returned, not just ACTIVE. A DRAFT scale is a
//              legitimate citation for a DRAFT scheme — the ACTIVE requirement
//              bites at scheme ACTIVATION, where the service raises
//              GRADE_SCALE_NOT_ACTIVE — so filtering here would withhold a
//              choice the create endpoint accepts. `status` is returned so a
//              form can say so rather than the list quietly deciding.
// RESPONSE   : { success: true, data: { gradeScales } }
// STATUS     : 200 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and tenant so
    // a 403 here can only ever describe the caller's own university. Governed
    // by "examinations", the same module /api/evaluation-schemes sits under:
    // a university that has switched off examinations must not keep reading the
    // regulation's supporting configuration.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const scales = await prisma.gradeScale.findMany({
      where: { tenantId: tenantGuard.tenant.id },
      select: {
        id: true,
        code: true,
        name: true,
        version: true,
        status: true,
        method: true,
        maxGradePoint: true,
      },
      // Newest revision of each code first, which is the one a new regulation
      // almost always wants to cite.
      orderBy: [{ code: "asc" }, { version: "desc" }],
      take: MAX_SCALES,
    });

    return NextResponse.json(
      ok({
        // Decimal is converted at this boundary rather than left to whichever
        // serializer runs, exactly as the scheme DTO does with the same column.
        gradeScales: scales.map((scale) => ({
          ...scale,
          maxGradePoint: scale.maxGradePoint.toString(),
        })),
      })
    );
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

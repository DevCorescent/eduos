// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Permission System (Phase 21)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : STUDENT only — see lib/constants/studentPermissions.ts.
//
//          Narrower than the sibling Phase 18 routes, which also admit
//          UNIVERSITY_ADMIN. The README's Phase 21 names exactly one role, and
//          an administrator reading a description of what STUDENTS may do is
//          not a case the specification describes. An admin who is also a
//          student holds the STUDENT role and reaches this normally.
// BACKEND: studentPermissionController → StudentPermissionService → Prisma.
// PURPOSE: Report the permission matrix that applies to the calling student.
//
// THIS ENDPOINT DESCRIBES ENFORCEMENT, IT DOES NOT PERFORM IT
//   Every restriction it reports is already enforced elsewhere and would remain
//   enforced if this route were deleted: requireRole gates each handler,
//   requireTenant scopes each query, and the self-service modules resolve the
//   caller from session.sub. A client that ignored this response entirely would
//   gain nothing. See lib/constants/studentPermissions.ts for why the matrix is
//   deliberately not load-bearing.
//
// SECURITY: no [studentId] segment, and the query schema is empty, so a
//          client-supplied identity key is stripped before the controller — and
//          the controller has no parameter to receive one regardless. The
//          subject is resolved from session.sub inside the service.
//
// TENANT ISOLATION: the tenant comes from requireTenant, never from the request.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentPermissionController } from "@/lib/controllers/studentPermission.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_PERMISSION_ROLES } from "@/lib/constants/studentPermissions";
import { studentPermissionQuerySchema } from "@/lib/validations/studentPermission.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/student/permissions";

// GET
// ACCESS     : requireRole(STUDENT) then requireTenant, in that order — an
//              unauthenticated caller receives requireAuth's 401 and a wrongly
//              roled one receives 403 without the tenant lookup happening at
//              all. Reversing them would leak the existence of a tenant to
//              someone not permitted to reach the module.
// VALIDATION : studentPermissionQuerySchema — empty, parsed to STRIP rather
//              than to accept. See the validation module.
// FLOW       : Guard → validate → controller.
//
//              A caller holding STUDENT but owning no Student row in this
//              tenant is refused 403 by the service, not served a matrix for a
//              student who does not exist.
// REPORTS    : The matrix exactly as declared, plus the resolved subject.
//              Nothing is computed and nothing is filtered.
// RESPONSE   : { success: true, data: StudentPermissionsDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...STUDENT_PERMISSION_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedQuery = studentPermissionQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const permissions = await studentPermissionController.getPermissions(
      tenantGuard.tenant.id,
      guard.session.sub
    );

    return NextResponse.json(ok(permissions));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

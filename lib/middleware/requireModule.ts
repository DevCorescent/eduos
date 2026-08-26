// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant — Module authorization (GAP-01 enforcement)
// LAYER  : Middleware (route guard)
// PURPOSE: Refuse an API route whose module the authenticated tenant has not
//          enabled — so hiding a link is not the only thing standing between a
//          disabled module and its data.
//
// COMPOSED ON TOP OF THE EXISTING GUARDS, NEVER INSTEAD OF THEM
//   A route keeps its requireRole and its requireTenant exactly as written.
//   This runs AFTER them, against the tenant they resolved, and can only ever
//   remove access. It resolves no tenant of its own and reads nothing from the
//   request, so it cannot widen anything and cannot be reached by a caller who
//   was not already authorised and tenant-scoped.
//
// ORDER, AND WHY IT IS THIS WAY
//   role → tenant → module. A caller with the wrong role never learns whether
//   the module is on, and a caller from another tenant is refused before their
//   own configuration is consulted. The 403 therefore describes the CALLER'S
//   own university and nothing else — it cannot be used to discover whether
//   some other institution licenses a module.
//
// WHY THE MESSAGE IS DELIBERATELY PLAIN
//   "Module not enabled" names the caller's own configuration, which their
//   administrator can see and change. It does not name a plan, a price or
//   another tenant.
// ============================================================================

import { NextResponse } from "next/server";
import { MODULE_API_RULES, pathAllowed } from "@/lib/constants/moduleRoutes";
import { enabledModulesForTenant } from "@/lib/services/tenantModules";
import { fail, type ApiResponse } from "@/types";

/** Either the module is enabled, or the response to return to the caller as-is. */
export type ModuleGuardResult =
  | { allowed: true }
  | { allowed: false; response: NextResponse<ApiResponse<never>> };

/** Built on the rejection path — existing FORBIDDEN code and 403 status. */
function moduleDisabled(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail("Module not enabled", "FORBIDDEN"), { status: 403 });
}

/**
 * Guard a route behind the tenant's module selection.
 *
 * INPUT   : the tenant id from requireTenant, and the request path. The path is
 *           matched against MODULE_API_RULES, so a route does not have to name
 *           its own module and the mapping stays in one reviewable file.
 * RETURNS : `allowed: true` for an ungoverned path or an enabled module;
 *           otherwise a 403 for the route to early-return verbatim.
 *
 * @example
 * const tenantGuard = await requireTenant()
 * if (!tenantGuard.resolved) return tenantGuard.response
 *
 * const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname)
 * if (!moduleGuard.allowed) return moduleGuard.response
 *
 * COMPLEXITY : one indexed read, and none at all for an ungoverned path — the
 *              mapping is consulted first, so most routes pay nothing.
 */
export async function requireModule(
  tenantId: string,
  pathname: string
): Promise<ModuleGuardResult> {
  // Checked before any read: a path no module governs must not cost a query.
  if (pathAllowed(pathname, new Set(), MODULE_API_RULES)) {
    return { allowed: true };
  }

  const enabled = await enabledModulesForTenant(tenantId);

  return pathAllowed(pathname, enabled, MODULE_API_RULES)
    ? { allowed: true }
    : { allowed: false, response: moduleDisabled() };
}

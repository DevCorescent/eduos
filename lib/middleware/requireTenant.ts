// ============================================================================
// OWNER  : Gauransh
// MODULE : Authentication — Tenant Middleware
// FLOW   : Resolves tenant, validates ownership, and attaches tenant context.
// ACCESS : Authenticated Users
// BACKEND: Uses existing tenant service and Prisma tenant model.
// PURPOSE: Enforce tenant isolation for all protected resources.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/middleware/requireAuth";
import { getTenantFromRequest } from "@/lib/services/tenant";
import type { JwtPayload } from "@/lib/auth/jwt";
import type { Tenant } from "@/app/generated/prisma/client";
import { fail, type ApiResponse } from "@/types";
import { requestScoped } from "@/lib/middleware/requestCache";

/**
 * Result of a tenant check.
 *
 * On failure the guard hands back an already-built NextResponse using the
 * project's existing envelope, so the calling route early-returns it as-is
 * instead of re-declaring status codes or error shapes. Mirrors the
 * AuthGuardResult and RoleGuardResult contracts in the sibling guards.
 *
 * On success the resolved Tenant is returned alongside the session — App Router
 * route handlers expose no mutable per-request object, so returning the record
 * for the route to destructure is how tenant context is attached here, exactly
 * as requireAuth and requireRole return the session.
 */
export type TenantGuardResult =
  | { resolved: true; session: JwtPayload; tenant: Tenant }
  | { resolved: false; response: NextResponse<ApiResponse<never>> };

/** Built when the host maps to no usable tenant — existing NOT_FOUND code. */
function tenantNotFound(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
}

/** Built on the rejection paths — existing FORBIDDEN code and 403 status. */
function forbidden(message: string): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail(message, "FORBIDDEN"), { status: 403 });
}

/**
 * Guard a route handler behind a valid, owned, serviceable tenant.
 *
 * INPUT      : None. The tenant comes from the request host and the caller from
 *              the edu_access cookie.
 * VALIDATION : No request body is read, so no Zod schema applies. Authentication
 *              is delegated entirely to requireAuth; host-to-tenant resolution
 *              is delegated entirely to getTenantFromRequest, so neither the
 *              session chain nor the host parsing is reimplemented here.
 * RULES      : Runs only after authentication succeeds. The authenticated
 *              user's tenantId must equal the tenant resolved from the host,
 *              which is what blocks a token issued for one tenant from being
 *              replayed against another tenant's subdomain. A tenant that is
 *              SUSPENDED or CANCELLED is rejected while ACTIVE and TRIAL pass,
 *              matching the policy already enforced at /api/auth/login so that
 *              any tenant able to sign in is equally able to serve requests.
 *              No role check is performed — that stays in requireRole.
 * DATABASE   : One read — Tenant.findUnique by the id the service resolved.
 *              The service performs its own lookup by slug, so a request
 *              through this guard touches the tenant row twice; the second read
 *              is required because the service returns only an id, which is
 *              insufficient to validate status or to attach the record.
 * TENANCY    : This guard is the tenant boundary. Note that getTenantFromRequest
 *              returns null on the root domain, so this guard answers 404 there
 *              — platform-level routes that intentionally span all tenants must
 *              use requireRole alone and must not call requireTenant.
 * RETURNS    : { resolved: true, session, tenant } — the full Tenant record for
 *              the route to use, plus the session for its own scoping.
 *              { resolved: false, response } — requireAuth's 401, or a 403/404.
 *
 * @example
 * export async function GET() {
 *   const guard = await requireTenant();
 *   if (!guard.resolved) return guard.response;
 *
 *   const { session, tenant } = guard;
 *   // ... tenant.id is safe to scope queries by; it is proven to match session
 * }
 */
export async function requireTenant(): Promise<TenantGuardResult> {
  const auth = await requireAuth();

  if (!auth.authenticated) {
    return { resolved: false, response: auth.response };
  }

  const { session } = auth;

  // Delegated host → slug → tenant id resolution. Returns null for the root
  // domain, an unknown slug, or a CANCELLED tenant; those are indistinguishable
  // to a caller, so all three surface as NOT_FOUND.
  const resolvedTenantId = await getTenantFromRequest();

  if (!resolvedTenantId) {
    return { resolved: false, response: tenantNotFound() };
  }

  // Ownership is settled against the id the service already returned, so a
  // caller from another tenant is rejected without a further read and without
  // learning anything about the target tenant's state.
  if (session.tenantId !== resolvedTenantId) {
    return { resolved: false, response: forbidden("Forbidden") };
  }

  // Read once per request. getTenantFromRequest above has already touched this
  // row to resolve and status-check it, and every other guard in the same
  // request would repeat the read; the DATABASE note below records that the row
  // is visited twice by design, and this is what stops that costing two round
  // trips.
  const tenant = await requestScoped(`tenant:full:${resolvedTenantId}`, () =>
    prisma.tenant.findUnique({ where: { id: resolvedTenantId } })
  );

  // Defensive: the row can disappear between the service's lookup and this one.
  if (!tenant) {
    return { resolved: false, response: tenantNotFound() };
  }

  // CANCELLED is already filtered by the service, but it is re-checked here so
  // the guard stays correct on its own terms rather than relying on that detail.
  if (tenant.status === "SUSPENDED" || tenant.status === "CANCELLED") {
    return { resolved: false, response: forbidden("Tenant is not active") };
  }

  return { resolved: true, session, tenant };
}

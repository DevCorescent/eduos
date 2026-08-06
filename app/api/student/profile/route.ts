// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Route
// FLOW   : Guard (auth → role → tenant) → validate query → controller →
//          response.
// ACCESS : STUDENT_PROFILE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only — see lib/constants/studentProfile.ts.
// BACKEND: studentProfileController → StudentProfileService →
//          StudentProfileRepository → Prisma.
// PURPOSE: The caller's own complete profile — identity, photograph, personal
//          details, academic placement, parents, documents, certificates and
//          achievements.
//
// SECURITY: There is no [studentId] segment on this route and no studentId in
//          its query schema. The caller is resolved to the Student row THEY OWN
//          from session.sub, inside the service. A client-supplied identifier
//          is not rejected here — it is unexpressible, because nothing in the
//          path, the query or the controller signature can carry one.
//
// TENANT ISOLATION: the tenant comes from requireTenant, never from the
//          request body or query, and every repository read is filtered on it.
//
// QUERY BUDGET: six statements — one to resolve the caller, then five
//          collections issued concurrently. Independent of how many documents,
//          parents, certificates or achievements the student holds.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentProfileController } from "@/lib/controllers/studentProfile.controller";
import { requireStudentProfileAccess } from "@/lib/middleware/requireStudentProfileAccess";
import { profileQuerySchema } from "@/lib/validations/studentProfile.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/student/profile";

// GET
// ACCESS     : requireStudentProfileAccess — role then tenant, in that order,
//              so an unauthenticated caller receives 401 and a wrongly-roled
//              one receives 403 without a tenant lookup ever being performed.
// VALIDATION : profileQuerySchema. Deliberately empty of filters — a profile is
//              returned whole, because assembling a partial one would mean a
//              second shape to test and a second set of nulls to reason about
//              for no benefit a client cannot get by ignoring fields. It is
//              still parsed, so that any identity key a client appends is
//              STRIPPED rather than carried forward.
// FLOW       : Guard → validate → controller.
//
//              `now` is taken ONCE here and passed down. Certificate expiry is
//              evaluated against an instant, and reading the clock separately
//              in the mapper would let a certificate expiring this millisecond
//              be active in one field and expired in another.
//
//              A caller holding a permitted role but owning no Student row in
//              this tenant — the UNIVERSITY_ADMIN case — is FORBIDDEN by the
//              service, not served an empty profile.
// RESPONSE   : { success: true, data: StudentProfileDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireStudentProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedQuery = profileQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const profile = await studentProfileController.getProfile(
      guard.access.tenantId,
      guard.access.userId,
      new Date()
    );

    return NextResponse.json(ok(profile));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Route
// FLOW   : Guard (auth → role → tenant) → validate query → controller →
//          response.
// ACCESS : UNIVERSITY_ADMIN · DEPARTMENT_HOD · STUDENT — see
//          lib/constants/openElective.ts.
// BACKEND: openElectiveController → OpenElectiveService → domain engine →
//          OpenElectiveRepository → Prisma.
// PURPOSE: The offering catalogue.
//
// DUAL-MODE, AND THE RESPONSE DIFFERS
//   Staff receive the plain catalogue. A STUDENT receives it annotated with
//   THEIR eligibility, THEIR ineligibility reasons and THEIR existing choice —
//   computed by the domain engine, never here. The guard reports which audience
//   the caller belongs to; the service acts on it.
//
// SECURITY: no studentId in the path and none in the query schema. A student is
//   resolved from session.sub inside the service, so impersonation is
//   unexpressible rather than merely refused.
//
// QUERY BUDGET: four statements for any page size — the page, its count, one
//   BATCHED eligibility read and one BATCHED seat count. A student's own
//   preferences add one per semester the page spans. Forty offerings cost the
//   same as one; the batching is what prevents the N+1.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { openElectiveController } from "@/lib/controllers/openElective.controller";
import { requireElectiveRead } from "@/lib/middleware/requireOpenElectiveAccess";
import { listOfferingsQuerySchema } from "@/lib/validations/openElective.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/open-electives";

// GET
// ACCESS     : requireElectiveRead — staff and students, reported distinctly.
// VALIDATION : listOfferingsQuerySchema — shared pagination plus optional
//              semester, status, department and course filters. Read-lenient:
//              an unknown key is stripped, so a cache-busting parameter does
//              not earn a 400.
// FLOW       : Guard → validate → controller.
//
//              `seatsRemaining` on each offering is DERIVED — totalSeats minus
//              the allocated count — and never stored, so it cannot drift from
//              the verdicts behind it.
// RESPONSE   : { success: true, data: { offerings, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireElectiveRead();
    if (!guard.granted) return guard.response;

    const parsedQuery = listOfferingsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const result = await openElectiveController.listOfferings(
      guard.context.tenantId,
      parsedQuery.data,
      guard.context.access
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

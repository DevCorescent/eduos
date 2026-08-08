// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : FACULTY_PROFILE_ROLES at the role gate, narrowed at the data gate.
// BACKEND: facultyProfileController → FacultyProfileService →
//          faculty-analytics domain + Phase 20 feedback statistics → Prisma.
// PURPOSE: The README's "Dashboard Charts" — everything the performance
//          endpoint reports, plus the two breakdowns a chart and a table need.
//
// WHY THIS EXISTS ALONGSIDE /api/faculty/performance
//   The README names both endpoints, and they return genuinely different
//   shapes: performance is four headline metrics for a summary card, analytics
//   adds the per-session-type breakdown a chart plots and the per-course list a
//   table renders. Collapsing them into one would make whichever survived a lie
//   about what it returns.
//
//   They do NOT cost twice as much. The service gathers once and projects
//   twice — getAnalytics reuses the same reads getPerformance makes rather than
//   issuing a second set for identical data.
//
// SAME NULL DISCIPLINE, SAME ABSENCE OF A COMPOSITE SCORE
//   See the performance route's header. Nothing here weights the metrics
//   together, because the README defines no weighting and inventing one would
//   produce an authoritative-looking number nobody decided.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { facultyProfileController } from "@/lib/controllers/facultyProfile.controller";
import { requireFacultyProfileAccess } from "@/lib/middleware/requireFacultyProfileAccess";
import {
  facultyIdParamSchema,
  facultyScopeQuerySchema,
} from "@/lib/validations/facultyProfile.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/faculty/analytics/[facultyId]";

type RouteContext = { params: Promise<{ facultyId: string }> };

// GET
// ACCESS     : requireFacultyProfileAccess.
// VALIDATION : facultyIdParamSchema; facultyScopeQuerySchema for ?semesterId.
// FLOW       : Guard → validate → controller.
// REPORTS    : Everything FacultyPerformanceDto carries, plus
//              `slotsBySessionType` (LECTURE / LAB / TUTORIAL counts, for a
//              chart) and `courses` (the taught-course list, for a table).
// RESPONSE   : { success: true, data: FacultyAnalyticsDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireFacultyProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedParam = facultyIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = facultyScopeQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const analytics = await facultyProfileController.getAnalytics(
      guard.access,
      parsedParam.data.facultyId,
      parsedQuery.data
    );

    return NextResponse.json(ok(analytics));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

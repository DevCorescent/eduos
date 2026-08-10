// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : FACULTY_PROFILE_ROLES at the role gate, narrowed at the data gate.
//          A faculty member reads their OWN performance; reading a colleague's
//          requires an administrative role, because a feedback rating is a
//          judgement about a person.
// BACKEND: facultyProfileController → FacultyProfileService →
//          faculty-analytics domain + Phase 20 feedback statistics → Prisma.
// PURPOSE: The performance dashboard — teaching load, attendance marking,
//          examination outcomes and student feedback, side by side.
//
// THERE IS NO SINGLE "PERFORMANCE SCORE" IN THIS RESPONSE, DELIBERATELY
//   The README lists "Teaching Performance" as a feature but defines no
//   formula, no inputs and no scale for it. A weighted composite would be a
//   number nobody decided, presented with the authority of a computed
//   statistic, and acted on by a head of department in a review. So this
//   endpoint reports the four COMPONENT metrics — each traceable to one query
//   and one definition — and leaves any combination to a client that knows what
//   its institution weights.
//
// EVERY RATE CAN BE NULL, AND NULL IS NOT ZERO
//   A member who has marked no attendance has no marking rate; a member whose
//   examinations define no pass mark has no pass rate. Those come back null
//   rather than 0, because a fabricated 0% attaches a failure to someone who
//   simply has no data, and a dashboard sorting ascending would rank them last.
//
// THE FEEDBACK FIGURE IS READ FROM PHASE 20, NOT RE-DERIVED
//   It comes from that module's own repository reads and its own statistics
//   functions. Recomputing it here would give a faculty member two different
//   ratings on two pages of the same product.
//
//   A failure in that subsystem degrades to a null rating with a zero count
//   rather than taking the dashboard down — one unavailable panel must not cost
//   the whole page.
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

const SCOPE = "GET /api/faculty/performance/[facultyId]";

type RouteContext = { params: Promise<{ facultyId: string }> };

// GET
// ACCESS     : requireFacultyProfileAccess.
// VALIDATION : facultyIdParamSchema; facultyScopeQuerySchema for ?semesterId.
// FLOW       : Guard → validate → controller.
//
//              The attendance and result reads are BOUNDED. Each reads limit+1
//              rows so truncation is detected without a second count query, and
//              a truncated set reports `truncated: true` rather than presenting
//              a partial aggregate as a total.
// REPORTS    : teaching (four counts), attendance (marked / present / rate),
//              results (marked / pass / fail / rate / average percentage), and
//              feedback (average rating / response count).
//
//              Marks are normalised to a percentage of each examination's own
//              maximum before averaging, so a course marked out of 20 and one
//              out of 100 contribute equally rather than the second dominating
//              by a factor of five.
// RESPONSE   : { success: true, data: FacultyPerformanceDto }
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

    const performance = await facultyProfileController.getPerformance(
      guard.access,
      parsedParam.data.facultyId,
      parsedQuery.data
    );

    return NextResponse.json(ok(performance));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Route
// FLOW   : Guard (auth → role → tenant) → validate query → controller →
//          response.
// ACCESS : STUDENT_PROFILE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only.
// BACKEND: studentProfileController → StudentProfileService →
//          StudentProfileRepository → Prisma.
// PURPOSE: The caller's own achievements, most recently ACHIEVED first.
//
// WHAT AN ACHIEVEMENT IS, AND IS NOT
//   Student-CLAIMED: a prize, a publication, a competition placing, a
//   certification earned outside the institution. It is deliberately NOT a
//   Certificate — that model is institution-ISSUED, carries a verification QR
//   and a revocation flag, and the university stands behind it. Conflating the
//   two would put unverified claims inside the certificate verification path.
//   Certificates are returned by GET /api/student/profile instead.
//
// SECURITY: no [studentId] segment and no studentId in the query schema.
//   Achievement carries its own tenantId and no composite tenant-proving
//   foreign key — see the model's documentation for why that key was
//   unavailable — so the repository's (tenantId, studentId) predicate IS the
//   enforcement, not a convenience.
//
// QUERY BUDGET: two statements — one to resolve the caller, one to read.
//   Served by @@index([tenantId, studentId, achievedOn]), a composite matching
//   this predicate and its sort exactly.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentProfileController } from "@/lib/controllers/studentProfile.controller";
import { requireStudentProfileAccess } from "@/lib/middleware/requireStudentProfileAccess";
import { achievementQuerySchema } from "@/lib/validations/studentProfile.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/student/achievements";

// GET
// ACCESS     : requireStudentProfileAccess.
// VALIDATION : achievementQuerySchema — an optional `?category` drawn from the
//              AchievementCategory enum. An unknown category is a 400 rather
//              than a silently unfiltered list, because returning everything
//              when a client asked for one category would look like the student
//              simply has many achievements.
// FLOW       : Guard → validate → controller.
//
//              The response is NOT paginated, and that is a contract decision.
//              A student's achievements are bounded by what one person holds —
//              tens of rows — and paging them would make the dashboard's own
//              achievementCount disagree with the list behind it.
// RESPONSE   : { success: true, data: AchievementDto[] }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireStudentProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedQuery = achievementQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const achievements = await studentProfileController.getAchievements(
      guard.access.tenantId,
      guard.access.userId,
      parsedQuery.data
    );

    return NextResponse.json(ok(achievements));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

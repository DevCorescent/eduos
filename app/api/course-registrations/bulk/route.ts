// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration — Bulk
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION.
// BACKEND: courseRegistrationController → CourseRegistrationService →
//          CourseRegistrationRepository / AuditLogRepository → Prisma.
// PURPOSE: Register a whole cohort against one course in one transaction.
//
// WHY THIS ENDPOINT EXISTS SEPARATELY
//   Registering a section is the ordinary administrative act, and doing it
//   through the single endpoint would be one request and eight statements per
//   student — sixty thousand statements for a modest university's semester.
//   Here the shared references are resolved ONCE for the cohort, every student
//   is validated in one query, every prior attempt across the batch arrives in
//   one more, and the insert is a single createMany. Six to eight statements
//   for any batch up to the cap.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { courseRegistrationController } from "@/lib/controllers/courseRegistration.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { REGISTRATION_MANAGE_ROLES } from "@/lib/constants/courseRegistration";
import { HTTP_STATUS } from "@/lib/constants/errors";
import { bulkCourseRegistrationSchema } from "@/lib/validations/courseRegistration";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/course-registrations/bulk";

// POST
// ACCESS     : REGISTRATION_MANAGE_ROLES.
// VALIDATION : bulkCourseRegistrationSchema. The batch is capped, and a body
//              naming the same student twice is REJECTED rather than silently
//              de-duplicated: a caller who sent a duplicate has a bug, and
//              returning success would hide it.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              A student who already holds an active enrolment is SKIPPED and
//              reported, not treated as a failure — registering a section when
//              a handful are already enrolled is the ordinary case, and failing
//              the batch would force the caller to diff the roster by hand.
//              A student who does not exist in the tenant is a 404 for the
//              whole batch: that is a caller error rather than an expected
//              overlap.
//
//              A batch with nothing left to insert returns 201 with
//              registeredCount zero and every skip listed, so re-running the
//              same request is idempotent rather than an error.
//
//              The rows that ARE created are all-or-nothing inside one
//              transaction, with a single audit entry for the batch — five
//              hundred entries would bury the administrative act that caused
//              them.
// RESPONSE   : { success: true, data: BulkRegistrationResultDTO,
//                message: "Bulk registration processed" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole(...REGISTRATION_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = bulkCourseRegistrationSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await courseRegistrationController.registerBulk(
      tenantGuard.tenant.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(result, "Bulk registration processed"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

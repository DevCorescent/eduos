// ============================================================================
// MODULE : Examination — Seat allocation (PRD §17.2 "Seat allocation")
// LAYER  : Route handler
// PURPOSE: Allocate seats to the hall tickets already issued for one
//          examination.
//
// NO SEAT IS NAMED IN THE REQUEST
//   The body is empty. The allocator walks the issued tickets in enrolment
//   order and assigns from the start of the hall plan, so there is no seat and
//   no student for a caller to name — and therefore nothing to manipulate into
//   a conflicting allocation.
//
// UNIQUENESS IS THE DATABASE'S, NOT THE ALLOCATOR'S
//   @@unique([examinationId, seatNo]) is what makes "no two candidates share a
//   seat" true against every write path, not only this one.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { EXAMINATION_READ_ROLES } from "@/lib/constants/examination";
import { allocateSeats, findExamination } from "@/lib/services/hallTicket.service";
import { examinationIdParamSchema } from "@/lib/validations/examination";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

const SCOPE = "POST /api/examinations/[id]/seats";

// POST
// ACCESS   : the examination office — UNIVERSITY_ADMIN or
//            CONTROLLER_OF_EXAMINATION. Narrowed from EXAMINATION_READ_ROLES,
//            which also admits the student and lecturer who read the calendar.
// BODY     : none.
// RESPONSE : { success: true, data: { allocatedCount, alreadyAllocatedCount } }
// STATUS   : 200 · 400 · 401 · 403 · 404 · 500
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole(...EXAMINATION_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const roles = guard.session.roles;
    if (
      !roles.includes("UNIVERSITY_ADMIN") &&
      !roles.includes("CONTROLLER_OF_EXAMINATION")
    ) {
      return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const moduleGuard = await requireModule(
      tenantGuard.tenant.id,
      request.nextUrl.pathname
    );
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsed = examinationIdParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    const examination = await findExamination(tenantGuard.tenant.id, parsed.data.id);

    // Tenant-scoped, so another university's examination id is
    // indistinguishable from one that does not exist.
    if (examination === null) {
      return NextResponse.json(fail("Examination not found", "NOT_FOUND"), {
        status: 404,
      });
    }

    const result = await allocateSeats(tenantGuard.tenant.id, examination);

    return NextResponse.json(ok(result, "Seats allocated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

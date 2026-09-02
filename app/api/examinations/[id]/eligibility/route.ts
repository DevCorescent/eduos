// ============================================================================
// MODULE : Examination — Eligibility (PRD §17.2 "Student eligibility")
// LAYER  : Route handler
// PURPOSE: Who may sit this examination, and why not where they may not.
//
// NO SEPARATE EXAMINATION REGISTRATION
//   The cohort is the course's CourseRegistration rows for the examination's
//   semester. An enrolment in the course IS the registration for its
//   examinations; there is deliberately no second registration model.
//
// DERIVED, NOT STORED
//   Every figure is recomputed from the enrolment and the attendance register
//   on each request. There is no eligibility column anywhere, so nothing can
//   go stale against the register it is drawn from.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { EXAMINATION_READ_ROLES } from "@/lib/constants/examination";
import { findExamination, listEligibility } from "@/lib/services/hallTicket.service";
import { examinationIdParamSchema } from "@/lib/validations/examination";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

const SCOPE = "GET /api/examinations/[id]/eligibility";

// GET
// ACCESS     : EXAMINATION_READ_ROLES — the examination office and the
//              university administrator run the eligibility list. STUDENT and
//              FACULTY hold the same read role for the calendar, so they are
//              excluded HERE rather than by the shared array: a cohort-wide
//              eligibility roll is not a student's to read, and a lecturer has
//              no examination-office duty over it.
// FLOW       : Authorise → tenant → module → validate → resolve → compute.
// RESPONSE   : { success: true, data: { examination, rows, summary } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole(...EXAMINATION_READ_ROLES);
    if (!guard.authorized) return guard.response;

    // The cohort roll is an examination-office instrument. Narrowed from the
    // shared read set, which also admits the student and lecturer who read the
    // calendar itself.
    const roles = guard.session.roles;
    const isOffice =
      roles.includes("UNIVERSITY_ADMIN") || roles.includes("CONTROLLER_OF_EXAMINATION");

    if (!isOffice) {
      return NextResponse.json(
        fail("Forbidden", "FORBIDDEN"),
        { status: 403 }
      );
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

    // Tenant-scoped resolution, so another university's examination id is
    // indistinguishable from one that does not exist.
    if (examination === null) {
      return NextResponse.json(
        fail("Examination not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    const rows = await listEligibility(tenantGuard.tenant.id, examination);

    return NextResponse.json(
      ok({
        examination,
        rows,
        summary: {
          total: rows.length,
          eligible: rows.filter((row) => row.decision.eligible).length,
          ineligible: rows.filter((row) => !row.decision.eligible).length,
          ticketsIssued: rows.filter((row) => row.ticketNo !== null).length,
          seated: rows.filter((row) => row.seatNo !== null).length,
        },
      })
    );
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

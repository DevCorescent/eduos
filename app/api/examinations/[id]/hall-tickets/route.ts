// ============================================================================
// MODULE : Examination — Hall Tickets (PRD §17.2 "Hall-ticket generation")
// LAYER  : Route handler
// PURPOSE: Issue hall tickets to the eligible cohort, and list what was issued.
//
// THE ELIGIBILITY GATE
//   POST issues for the COHORT, never for a named student. There is no
//   studentId anywhere in the request, so there is no id to manipulate into a
//   ticket for someone who is not entitled to one: the service recomputes
//   eligibility from the enrolment and the attendance register and issues only
//   to those it judges eligible.
//
// IDEMPOTENT
//   @@unique([examinationId, studentId]) plus skipDuplicates means running the
//   generation twice issues nothing the second time and says so, rather than
//   duplicating or failing.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { EXAMINATION_READ_ROLES } from "@/lib/constants/examination";
import {
  findExamination,
  issueHallTickets,
  listEligibility,
} from "@/lib/services/hallTicket.service";
import { examinationIdParamSchema } from "@/lib/validations/examination";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

const GET_SCOPE = "GET /api/examinations/[id]/hall-tickets";
const POST_SCOPE = "POST /api/examinations/[id]/hall-tickets";

/**
 * The examination office, narrowed from the shared read set.
 *
 * EXAMINATION_READ_ROLES also admits STUDENT and FACULTY so they can read the
 * calendar. Issuing tickets for a cohort is not theirs, and a student's own
 * ticket is served by /api/students/me/hall-tickets instead.
 */
function isExaminationOffice(roles: readonly string[]): boolean {
  return (
    roles.includes("UNIVERSITY_ADMIN") || roles.includes("CONTROLLER_OF_EXAMINATION")
  );
}

async function resolve(request: NextRequest, params: Promise<{ id: string }>) {
  const guard = await requireRole(...EXAMINATION_READ_ROLES);
  if (!guard.authorized) return { ok: false as const, response: guard.response };

  if (!isExaminationOffice(guard.session.roles)) {
    return {
      ok: false as const,
      response: NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 }),
    };
  }

  const tenantGuard = await requireTenant();
  if (!tenantGuard.resolved) return { ok: false as const, response: tenantGuard.response };

  const moduleGuard = await requireModule(
    tenantGuard.tenant.id,
    request.nextUrl.pathname
  );
  if (!moduleGuard.allowed) return { ok: false as const, response: moduleGuard.response };

  const parsed = examinationIdParamSchema.safeParse(await params);
  if (!parsed.success) return { ok: false as const, response: validationFailure(parsed.error) };

  const examination = await findExamination(tenantGuard.tenant.id, parsed.data.id);

  if (examination === null) {
    return {
      ok: false as const,
      response: NextResponse.json(fail("Examination not found", "NOT_FOUND"), {
        status: 404,
      }),
    };
  }

  return {
    ok: true as const,
    tenantId: tenantGuard.tenant.id,
    userId: guard.session.sub,
    examination,
  };
}

// GET
// ACCESS   : the examination office.
// RESPONSE : { success: true, data: { examination, tickets } }
// STATUS   : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const resolved = await resolve(request, context.params);
    if (!resolved.ok) return resolved.response;

    const rows = await listEligibility(resolved.tenantId, resolved.examination);

    return NextResponse.json(
      ok({
        examination: resolved.examination,
        tickets: rows
          .filter((row) => row.ticketNo !== null)
          .map((row) => ({
            studentId: row.studentId,
            enrollmentNo: row.enrollmentNo,
            studentName: row.studentName,
            ticketNo: row.ticketNo,
          })),
      })
    );
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS   : the examination office.
// BODY     : none. The cohort is derived from the examination, so there is
//            nothing for a caller to name and nothing to manipulate.
// RESPONSE : { success: true, data: { issuedCount, alreadyIssuedCount, ineligibleCount } }
// STATUS   : 200 · 400 · 401 · 403 · 404 · 500
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const resolved = await resolve(request, context.params);
    if (!resolved.ok) return resolved.response;

    const result = await issueHallTickets(
      resolved.tenantId,
      resolved.examination,
      resolved.userId
    );

    return NextResponse.json(ok(result, "Hall tickets issued"));
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}

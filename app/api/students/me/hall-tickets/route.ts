// ============================================================================
// MODULE : Examination — a student's own hall tickets
// LAYER  : Route handler
// PURPOSE: Serve the signed-in student the tickets issued to them.
//
// THERE IS NO STUDENT ID IN THIS ROUTE, AND THAT IS THE POINT
//   The path carries no parameter and the body carries nothing. The Student row
//   is resolved from session.sub, so a student cannot ask for anybody else's
//   ticket by editing anything — there is no id to edit. That is why this is
//   /students/me/hall-tickets rather than /students/[id]/hall-tickets with a
//   comparison inside it: an endpoint that cannot express the wrong request is
//   stronger than one that rejects it.
//
// A ticket is only ever created for a student the examination office judged
// eligible, so this route needs no eligibility logic of its own — it reports
// what was issued.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ROLES } from "@/constants/roles";
import { listStudentHallTickets } from "@/lib/services/hallTicket.service";
import { handleRouteError } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

const SCOPE = "GET /api/students/me/hall-tickets";

// GET
// ACCESS     : STUDENT, confined to themselves by construction.
// FLOW       : Authorise → resolve tenant → resolve own Student row → list.
// RESPONSE   : { success: true, data: { hallTickets } }
// STATUS     : 200 · 401 · 403 · 500
export async function GET() {
  try {
    const guard = await requireRole(ROLES.STUDENT);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // Tenant-scoped, so an account carrying the STUDENT role in another
    // university resolves to nothing here rather than to a foreign record.
    const student = await prisma.student.findFirst({
      where: { userId: guard.session.sub, tenantId: tenantGuard.tenant.id },
      select: { id: true },
    });

    // A STUDENT role with no Student row in this tenant is a misconfigured
    // account, refused rather than served an empty list that would read as
    // "you have no hall tickets".
    if (student === null) {
      return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
    }

    const hallTickets = await listStudentHallTickets(
      tenantGuard.tenant.id,
      student.id
    );

    return NextResponse.json(ok({ hallTickets }));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

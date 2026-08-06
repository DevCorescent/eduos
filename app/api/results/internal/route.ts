// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score — Internal Marks Upload
// LAYER  : Route
// FLOW   : Guard → tenant → resolve authority from the caller's own roles →
//          validate → controller → service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION · FACULTY.
// BACKEND: studentComponentScoreController → StudentComponentScoreService →
//          StudentComponentScoreRepository / AuditLogRepository → Prisma.
// PURPOSE: Record continuous-assessment marks for one sitting.
//
// HOW THIS DIFFERS FROM /api/results/external — AND WHY
//   Not by component type. Deciding that THEORY is "external" and QUIZ is
//   "internal" would hardcode an academic taxonomy into application code, and
//   this phase exists to make that a tenant's configuration. A medical college
//   assessing a logbook and an engineering college assessing a PUT would both
//   be wrong under any list we invented.
//
//   The difference is AUTHORITY, which is real and taxonomy-free:
//
//     • FACULTY is admitted HERE and nowhere else.
//     • A FACULTY caller is confined to sittings THEY CONDUCT
//       (AssessmentEvent.conductedById). Admitting them by role alone would let
//       a lecturer upload the end-semester theory marks through this endpoint —
//       exactly what the external endpoint exists to prevent.
//     • UNIVERSITY_ADMIN and CONTROLLER_OF_EXAMINATION are unconfined, because
//       the registry legitimately records marks for any sitting.
//
//   Role precedence is elevated-first, so a caller holding both an
//   administrative role and FACULTY is not confined. Asking requireRole live
//   rather than reading session.roles is deliberate and matches every
//   role-scoped route in this project: a revoked role must take effect on the
//   next request rather than at token expiry.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentComponentScoreController } from "@/lib/controllers/studentComponentScore.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { EXTERNAL_MARK_UPLOAD_ROLES, MARK_AUDIT_ACTION } from "@/lib/constants/studentComponentScore";
import { ROLES } from "@/constants/roles";
import { uploadMarksSchema } from "@/lib/validations/studentComponentScore";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/results/internal";

// POST
// ACCESS     : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION · FACULTY, with
//              different reach — see the module note above.
// VALIDATION : uploadMarksSchema. One shape serves single and bulk upload: a
//              single mark is a batch of one. A batch naming the same
//              registration twice is rejected rather than de-duplicated,
//              because two rows for one student in a marks spreadsheet is a
//              transcription error and the second value quietly winning is how
//              a wrong mark reaches a transcript.
// FLOW       : Authorise → resolve tenant → decide authority → validate body →
//              build the audit context → controller.
//
//              Every academic rule is applied in the service, in an order where
//              each step is a precondition of the next: the sitting must be
//              OPEN (which is what locking and publication mean here), its
//              regulation must still be ACTIVE, the caller must be entitled to
//              this sitting, and every registration must belong to this course,
//              term, teaching group and regulation and still be live.
//
//              The whole upload is one transaction. A single ineligible
//              registration or an out-of-range mark rejects the batch and
//              writes nothing — a partially applied marks sheet is worse than
//              none, because nobody can tell which half landed.
// RESPONSE   : { success: true, data: MarkUploadResultDTO,
//                message: "Internal marks recorded" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              200 rather than 201: the endpoint is an upsert over a sitting's
//              marks sheet, so it neither always creates nor identifies a new
//              resource by location.
//              403 — a lecturer reaching a sitting they do not conduct.
//              409 — the sitting is not OPEN, the regulation is not ACTIVE, or
//                    a registration is ineligible.
export async function POST(request: NextRequest) {
  try {
    // Elevated first: a caller holding an administrative role is never confined
    // to their own sittings, even if they also hold FACULTY.
    const elevatedGuard = await requireRole(...EXTERNAL_MARK_UPLOAD_ROLES);

    let session;
    let restrictToConductedEvents: boolean;

    if (elevatedGuard.authorized) {
      session = elevatedGuard.session;
      restrictToConductedEvents = false;
    } else {
      const facultyGuard = await requireRole(ROLES.FACULTY);
      if (!facultyGuard.authorized) return facultyGuard.response;

      session = facultyGuard.session;
      restrictToConductedEvents = true;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = uploadMarksSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await studentComponentScoreController.upload(
      tenantGuard.tenant.id,
      parsedBody.data,
      { action: MARK_AUDIT_ACTION.INTERNAL_UPLOADED, restrictToConductedEvents },
      buildRequestContext(request, session)
    );

    return NextResponse.json(ok(result, "Internal marks recorded"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

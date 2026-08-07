// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate body → controller
//          → response.
// ACCESS : EXAM_RESOURCE_READ_ROLES at the role gate, narrowed at the data gate
//          to the uploader or an administrative role.
// BACKEND: examResourceController → ExamResourceService →
//          ExamResourceRepository + AuditLogRepository → Prisma.
// PURPOSE: Release a resource to students — the README's "Publish Immediately",
//          "Schedule Publish" and HOD "Publish/Unpublish".
//
// PUBLICATION AND VERIFICATION ARE SEPARATE, AND BOTH LIVE HERE
//   The README lists "Verify Uploads" and "Publish/Unpublish" as distinct HOD
//   capabilities, so `isVerified` is an OPTIONAL field on this request and does
//   NOT gate student visibility. Publishing without verifying is legitimate; a
//   published-but-unverified resource is visible and reports itself as
//   unverified. Making verification a gate would silently hide material a
//   faculty member deliberately released.
//
// SCHEDULING IS STORED, NOT ACTED ON
//   `scheduledPublishAt` is compared against now() by every student-facing
//   query. Nothing flips a status column on a timer, because this project has
//   no cron, queue or job runner. The honest consequence — a resource that is
//   PUBLISHED and still invisible — is reported by the staff listing as
//   `pendingReason: "SCHEDULED"` rather than hidden.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireExamResourceAccess } from "@/lib/middleware/requireExamResourceAccess";
import {
  examResourceParamSchema,
  publishExamResourceSchema,
} from "@/lib/validations/examResource.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";
// PHASE 27 student events "Question Paper Uploaded" and "Solution Uploaded".
// Emitted on PUBLICATION rather than on upload — see below.
import {
  findStudentUserIdsForCourse,
  notificationEmitter,
} from "@/lib/controllers/notificationEmitter.controller";

const SCOPE = "PATCH /api/exam-resources/[id]/publish";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH
// ACCESS     : requireExamResourceAccess, narrowed at the data gate.
// VALIDATION : publishExamResourceSchema, .strict(). `scheduledPublishAt` may
//              be set or cleared here; `isVerified` may be set. `status` and
//              `publishedAt` are absent — both are the server's.
// FLOW       : Guard → validate param → parse → validate body → controller.
//
//              REFUSES an already-PUBLISHED resource with 409. Re-publishing
//              would silently reset publishedAt and lose the original release
//              date, which is exactly what a "when was this available to
//              students" question needs.
//
//              An ARCHIVED resource CAN be published: that is how withdrawn
//              material is restored, and it is the only route back to editable.
//              `archivedAt` is cleared as part of the same update.
//
//              The update and its audit entry share ONE transaction — a change
//              to what students can see cannot go unrecorded.
// RESPONSE   : { success: true, data: ExamResourceDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    const parsedParam = examResourceParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    // The body is optional in practice — publishing with no options is the
    // common case — so an absent body parses as {} rather than failing.
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // A malformed body is still an error; an ABSENT one is not. Only a
      // present-but-unparseable payload reaches here with content.
      const raw = await request.text().catch(() => "");
      if (raw.trim().length > 0) return malformedBody();
    }

    const parsedBody = publishExamResourceSchema.safeParse(body ?? {});
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const published = await examResourceController.publish(
      guard.access,
      parsedParam.data.id,
      parsedBody.data,
      new Date()
    );

    // PHASE 27 student events "Question Paper Uploaded" / "Solution Uploaded".
    //
    // Emitted on PUBLICATION, never on upload: a draft is invisible to
    // students, and telling them about a paper they cannot open would be worse
    // than silence.
    //
    // Guarded on `isLiveForStudents` — a resource published with a FUTURE
    // scheduled release is not yet visible, so notifying now would announce
    // something the download endpoint would refuse. Those recipients learn of
    // it when they next list, which is the honest consequence of evaluating
    // publication on read rather than by a job runner this project lacks.
    if (published.isLiveForStudents) {
      const recipients = await findStudentUserIdsForCourse(
        guard.access.tenantId,
        published.courseId,
        null
      );

      await notificationEmitter.examResourcePublished({
        tenantId: guard.access.tenantId,
        recipientUserIds: recipients,
        resourceId: published.id,
        resourceType: published.type,
        title: published.title,
        courseLabel: published.courseCode ?? published.courseId,
      });
    }

    return NextResponse.json(ok(published, "Examination resource published"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

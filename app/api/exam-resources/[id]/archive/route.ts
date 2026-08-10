// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → controller → response.
// ACCESS : EXAM_RESOURCE_READ_ROLES at the role gate, narrowed at the data gate
//          to the uploader or an administrative role.
// BACKEND: examResourceController → ExamResourceService →
//          ExamResourceRepository + AuditLogRepository → Prisma.
// PURPOSE: Withdraw a resource from students — the README's "Archive
//          Resources" and the unpublish half of HOD "Publish/Unpublish".
//
// ARCHIVE IS NOT DELETE, AND THAT DISTINCTION IS THE POINT
//   Previous-year question papers are the reason this repository exists, so
//   nothing here destroys one. An archived resource stops being listed to
//   students and remains fully readable by staff. DELETE /api/exam-resources/[id]
//   is the genuinely destructive operation, and it exists separately because
//   the README names both.
//
// AN ARCHIVED RESOURCE IS FROZEN
//   PATCH refuses it with 409. It is the historical record students relied on,
//   and silently rewriting a withdrawn answer key would leave no trace that the
//   document changed. Publishing it again is the deliberate path back to
//   editable.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireExamResourceAccess } from "@/lib/middleware/requireExamResourceAccess";
import { examResourceParamSchema } from "@/lib/validations/examResource.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "PATCH /api/exam-resources/[id]/archive";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH
// ACCESS     : requireExamResourceAccess, narrowed at the data gate.
// VALIDATION : examResourceParamSchema. The body carries no fields —
//              ExamResource has no reason or notes column, so a supplied
//              explanation would have nowhere to go. That gap is stated rather
//              than papered over: it is the same unattributable-state-change
//              shape TD-008 and TD-C20 record elsewhere, and closing it would
//              mean adding a column this phase's specification does not name.
// FLOW       : Guard → validate → controller.
//
//              REFUSES an already-ARCHIVED resource with 409, so a repeated
//              call cannot silently reset archivedAt and lose the original
//              withdrawal date.
//
//              The update and its audit entry share ONE transaction — a change
//              to what students can see cannot go unrecorded.
// RESPONSE   : { success: true, data: ExamResourceDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    const parsed = examResourceParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    const archived = await examResourceController.archive(
      guard.access,
      parsed.data.id,
      {},
      new Date()
    );

    return NextResponse.json(ok(archived, "Examination resource archived"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

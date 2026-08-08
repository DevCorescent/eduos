// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate body → controller
//          → response.
// ACCESS : EXAM_RESOURCE_READ_ROLES at the role gate. READS are open to every
//          staff role; WRITES are narrowed at the data gate — a FACULTY caller
//          may edit or delete only their own uploads.
// BACKEND: examResourceController → ExamResourceService →
//          ExamResourceRepository → Prisma.
// PURPOSE: Read, edit and delete one examination resource.
//
// A REFUSED WRITE IS A 404, NOT A 403
//   A faculty member reaching a colleague's resource receives the same answer
//   as for an unknown id. A 403 would confirm the resource exists and is merely
//   withheld, which is how someone learns that an unpublished answer key is out
//   there to look for.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireExamResourceAccess } from "@/lib/middleware/requireExamResourceAccess";
import {
  examResourceParamSchema,
  updateExamResourceSchema,
} from "@/lib/validations/examResource.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireExamResourceAccess. Any staff role reads any resource in
//              their tenant, including drafts — an HOD reviewing uploads needs
//              to see work in progress, which is the README's "View Uploaded
//              Resources".
// VALIDATION : examResourceParamSchema. No format is asserted on the id:
//              asserting one turns an unrecognised-but-well-formed id into a
//              400 when 404 is the accurate answer.
// RESPONSE   : { success: true, data: ExamResourceDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest, context: RouteContext) {
  const SCOPE = "GET /api/exam-resources/[id]";

  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    const parsed = examResourceParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    const resource = await examResourceController.getById(
      guard.access,
      parsed.data.id,
      new Date()
    );

    return NextResponse.json(ok(resource));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PATCH
// ACCESS     : requireExamResourceAccess, narrowed at the data gate to the
//              uploader or an administrative role.
// VALIDATION : updateExamResourceSchema, .strict(), and refusing an EMPTY body
//              — an update with no fields would be a silent no-op that still
//              advanced updatedAt.
//
//              courseId and semesterId are ABSENT. Moving a resource to a
//              different course would change which students can see it, which
//              is a re-filing rather than an edit and has no endpoint in the
//              README.
// FLOW       : Guard → validate param → parse → validate body → controller.
//
//              An ARCHIVED resource is REFUSED with 409. It is the historical
//              record students relied on, and silently rewriting a withdrawn
//              answer key would leave no trace that the document changed.
//              Re-publishing it first is the deliberate path back.
// RESPONSE   : { success: true, data: ExamResourceDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  const SCOPE = "PATCH /api/exam-resources/[id]";

  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    const parsedParam = examResourceParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateExamResourceSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const updated = await examResourceController.update(
      guard.access,
      parsedParam.data.id,
      parsedBody.data,
      new Date()
    );

    return NextResponse.json(ok(updated, "Examination resource updated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// DELETE
// ACCESS     : requireExamResourceAccess, narrowed to the uploader or an
//              administrative role.
// VALIDATION : examResourceParamSchema.
// FLOW       : Guard → validate → controller.
//
//              A HARD delete, and AUDITED. The README names DELETE and archive
//              as separate operations, so this one is genuinely destructive and
//              archive is the non-destructive alternative. The audit entry
//              records the title, type and location — the only trace that will
//              remain once the row is gone.
//
//              The delete and its audit entry share ONE transaction, so a
//              destroyed resource cannot go unrecorded. A row removed between
//              the lookup and the write reports the same 404 the lookup would
//              have produced.
// RESPONSE   : { success: true, data: null, message: "Examination resource deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function DELETE(request: NextRequest, context: RouteContext) {
  const SCOPE = "DELETE /api/exam-resources/[id]";

  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    const parsed = examResourceParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    await examResourceController.remove(guard.access, parsed.data.id);

    return NextResponse.json(ok(null, "Examination resource deleted"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

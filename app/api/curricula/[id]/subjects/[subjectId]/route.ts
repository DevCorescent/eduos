// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Curriculum Subject Detail
// FLOW   : Guard → tenant → params → verify curriculum ownership →
//          curriculum-scoped delete → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Remove one subject from a curriculum within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  curriculumIdParamSchema,
  curriculumSubjectIdParamSchema,
} from "@/lib/validations/curriculum";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : curriculumIdParamSchema for the [id] segment and
//              curriculumSubjectIdParamSchema for the [subjectId] segment, each
//              parsed from its own key so neither can stand in for the other. Both
//              must be non-empty once trimmed. No body is read: a delete carries no
//              payload, and any body sent is ignored rather than rejected.
// FLOW       : Authorise → resolve tenant → validate both params → prove the
//              curriculum belongs to this tenant → delete the subject filtered by
//              BOTH its own id and that curriculumId.
//
//              Both route parameters are authoritative and subjectId alone never
//              authorises anything. CurriculumSubject has no tenantId column, so
//              its tenant is inherited entirely through its curriculum: a delete
//              keyed on the subject id alone would reach any subject in any tenant.
//              The parent is therefore resolved first, and the delete is then
//              scoped through the curriculum relationship — a subject belonging to
//              a different curriculum matches nothing, whether that curriculum
//              belongs to this tenant or another one.
//
//              deleteMany rather than delete, filtered on id and curriculumId
//              together. This is a single atomic statement, so there is no window
//              between checking the subject and removing it, and a row that does
//              not match simply yields a count of zero rather than an exception.
//              It also keeps the two-parameter scoping in the query itself rather
//              than splitting it across a lookup and a write. This mirrors
//              DELETE /api/students/[id]/documents/[docId], the project's other
//              parent-scoped nested delete.
//
//              An unknown subject, a subject under a different curriculum and a
//              subject in another tenant all return the identical 404, so no id is
//              ever confirmed to exist elsewhere. A repeated delete returns 404 for
//              the same reason: the row is already gone.
// RESPONSE   : { success: true, data: null,
//                message: "Subject removed from curriculum" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No conflict status is reachable and none is handled. Nothing in the
//              schema holds a foreign key to CurriculumSubject and it has no
//              child relations, so the row can always be removed once ownership is
//              proven — unlike Campus or Course, whose deletions can be refused by
//              a dependent RESTRICT.
//
//              The removal is permanent. The schema has no deletedAt column and no
//              archive model for this data, so there is nothing to soft-delete
//              into and no restore path; the row is gone.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; subjectId: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const rawParams = await params;

    const parsedCurriculumParam = curriculumIdParamSchema.safeParse({ id: rawParams.id });
    const parsedSubjectParam = curriculumSubjectIdParamSchema.safeParse({
      subjectId: rawParams.subjectId,
    });

    if (!parsedCurriculumParam.success || !parsedSubjectParam.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: [
            ...(parsedCurriculumParam.success ? [] : validationDetails(parsedCurriculumParam.error)),
            ...(parsedSubjectParam.success ? [] : validationDetails(parsedSubjectParam.error)),
          ],
        },
        { status: 400 }
      );
    }

    const curriculumId = parsedCurriculumParam.data.id;
    const subjectId = parsedSubjectParam.data.subjectId;

    // Tenant ownership lives on Curriculum, not on CurriculumSubject, so the
    // curriculum is resolved before any subject is touched. A foreign or unknown
    // curriculum is rejected here and the subject is never reached.
    const curriculum = await prisma.curriculum.findFirst({
      where: { id: curriculumId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!curriculum) {
      return NextResponse.json(fail("Curriculum not found", "NOT_FOUND"), { status: 404 });
    }

    // Filtered by curriculumId as well as id, so a subject belonging to another
    // curriculum — in this tenant or any other — matches nothing.
    const removed = await prisma.curriculumSubject.deleteMany({
      where: { id: subjectId, curriculumId },
    });

    if (removed.count === 0) {
      return NextResponse.json(fail("Subject not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(null, "Subject removed from curriculum"));
  } catch (err) {
    console.error("[DELETE /api/curricula/[id]/subjects/[subjectId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

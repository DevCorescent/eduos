// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Curriculum Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup with nested subjects →
//          response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Return one curriculum together with all of its subjects within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { curriculumIdParamSchema } from "@/lib/validations/curriculum";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Course columns exposed inside a curriculum subject.
 *
 * CurriculumSubject.course is a real relation backed by a foreign key, so this
 * join is one Prisma can perform — unlike Course.departmentId, which has no
 * relation and therefore cannot be expanded into a department anywhere.
 *
 * Deliberately narrower than the full course record. description and syllabus are
 * omitted: a curriculum can carry many subjects, and returning a syllabus per row
 * would make the payload grow without bound. The complete course is available from
 * GET /api/courses/[id].
 *
 * credits is included on purpose. Course.credits is authoritative while
 * CurriculumSubject.credits is a snapshot taken when the subject was added, so
 * exposing both lets a client see that the two have diverged. Neither value is
 * altered here — this endpoint reports what is stored.
 */
const COURSE_SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  credits: true,
  isActive: true,
} as const;

/**
 * Columns returned for each subject of the curriculum.
 *
 * CurriculumSubject has no updatedAt column, so createdAt is the only timestamp
 * there is to report.
 */
const SUBJECT_SELECT = {
  id: true,
  curriculumId: true,
  courseId: true,
  semesterNumber: true,
  isCompulsory: true,
  credits: true,
  internalMarks: true,
  externalMarks: true,
  createdAt: true,
  course: { select: COURSE_SUMMARY_SELECT },
} as const;

/**
 * Ordering applied to the nested subjects.
 *
 * Declared separately and typed with `satisfies` rather than `as const`. The two
 * SELECT constants above are frozen with `as const` to keep their `true` literals
 * from widening to `boolean`, which would degrade the inferred result type — but
 * `as const` would also make this array `readonly`, and Prisma's orderBy input is
 * a mutable array, so nesting it inside a frozen object fails to type check.
 * `satisfies` preserves the "asc" literals without freezing the array.
 *
 * semesterNumber comes first, since a curriculum is read as a semester-wise list.
 * createdAt and id follow as tiebreakers: several subjects added to the same
 * semester in one request can share a createdAt, which would otherwise leave their
 * relative order undefined between calls. Unlike the collection routes this
 * ordering ascends — a curriculum reads forwards through the programme, not
 * newest-first.
 */
const SUBJECT_ORDER_BY = [
  { semesterNumber: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.CurriculumSubjectOrderByWithRelationInput[];

/**
 * Columns returned for the curriculum itself, with its subjects nested.
 *
 * The collection route declares the same scalar shape but no subjects; both are
 * restated rather than shared because a Next.js route module may only export route
 * handlers and segment config.
 *
 * The programme is not joined even though Curriculum.programme is a real relation.
 * The README defines this endpoint as "Curriculum with all subjects", so the
 * response carries programmeId and the programme is read through its own endpoint.
 */
const CURRICULUM_SELECT = {
  id: true,
  tenantId: true,
  programmeId: true,
  name: true,
  version: true,
  effectiveFrom: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  subjects: {
    select: SUBJECT_SELECT,
    orderBy: SUBJECT_ORDER_BY,
  },
} as const;

// Neither Curriculum, CurriculumSubject nor Course holds a BigInt, Decimal or
// Json column, so the shared serialize() helper is not applied here. effectiveFrom
// and createdAt are DateTime and carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : curriculumIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No query parameters are read: this addresses a single
//              resource, so there is no collection to page through and no
//              pagination contract to validate. Any query string supplied is
//              simply ignored rather than rejected, matching every other detail
//              route in the project.
//
//              The subjects are returned in full rather than paged. The README
//              defines this endpoint as "Curriculum with all subjects", and no
//              nested pagination contract exists anywhere in the project, so
//              inventing one here would add a capability the rest of the API does
//              not have.
// FLOW       : Authorise → resolve tenant → read the curriculum filtered by BOTH
//              id and tenantId, so one owned by another tenant is simply not found
//              rather than being disclosed. An unknown id and a foreign id return
//              the identical response, so no id is ever confirmed to exist
//              elsewhere.
//
//              The subjects need no tenant filter of their own and are given none.
//              CurriculumSubject has no tenantId column: a subject is reachable
//              only through its curriculum, so scoping the parent scopes the
//              children. Filtering the nested rows further would silently hide
//              stored data rather than protect anything.
// RESPONSE   : { success: true, data: <Curriculum with subjects[]> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              A curriculum with no subjects returns 200 with subjects: [], not
//              404 — the curriculum exists and an empty subject list is a valid
//              state, since nothing in the schema requires a curriculum to carry
//              any subject.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = curriculumIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged. One
    // query fetches the curriculum, its subjects and each subject's course.
    const curriculum = await prisma.curriculum.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: CURRICULUM_SELECT,
    });

    if (!curriculum) {
      return NextResponse.json(fail("Curriculum not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(curriculum));
  } catch (err) {
    console.error("[GET /api/curricula/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

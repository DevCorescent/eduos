// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate → controller → response.
// ACCESS : EXAM_RESOURCE_READ_ROLES at the role gate; write authority is
//          narrowed at the data gate — a FACULTY caller manages only their own
//          uploads, an administrative caller manages anything in the tenant.
//          See lib/middleware/requireExamResourceAccess.ts.
// BACKEND: examResourceController → ExamResourceService → exam-resources
//          visibility domain → ExamResourceRepository → Prisma.
// PURPOSE: Upload an examination resource, and list the staff repository.
//
// THIS STORES A LOCATION, NOT A FILE
//   No upload, R2 client, presigned-URL helper or multipart handler exists
//   anywhere in this repository — verified before this phase was written.
//   StudentDocument, Certificate.pdfUrl and AssignmentSubmission.attachments
//   all store a client-supplied URL. `fileUrl` follows that precedent, and IS
//   validated as a URL: TD-C21 records that Certificate.pdfUrl accepts a
//   `javascript:` URI, and a question paper is rendered as a download link to
//   every student on a course.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireExamResourceAccess } from "@/lib/middleware/requireExamResourceAccess";
import {
  createExamResourceSchema,
  examResourceListQuerySchema,
} from "@/lib/validations/examResource.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

// GET
// ACCESS     : requireExamResourceAccess — every staff role may BROWSE the
//              whole tenant's repository. Restricting reads would be perverse
//              when the README grants students far wider access than that;
//              ?mine=true narrows to the caller's own uploads.
// VALIDATION : examResourceListQuerySchema, .strict(). Every filter optional:
//              course, semester, department, examination, type, status,
//              academic year, verification, and `q` for the README's "Resource
//              Search". An unrecognised parameter is a 400 rather than an inert
//              filter the caller believes was applied.
// FLOW       : Guard → validate → controller.
//
//              The page and its total are read in one transaction, so the count
//              cannot describe a wider set than the page. Ordering is createdAt
//              then id, both descending — the id tiebreaker is required for
//              correctness, since a bulk upload writes several rows within one
//              millisecond.
// REPORTS    : Each resource with `isLiveForStudents` and `pendingReason`,
//              derived from the SAME predicate the student endpoints use — so a
//              staff listing can never claim a resource is live while the
//              student route hides it. "SCHEDULED" is the state that exists
//              only because publication is evaluated on read rather than by a
//              job runner this project does not have.
// RESPONSE   : { success: true, data: { resources, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  const SCOPE = "GET /api/exam-resources";

  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    const parsed = examResourceListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await examResourceController.list(guard.access, parsed.data, new Date());

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// POST
// ACCESS     : requireExamResourceAccess. Any staff role may upload; the
//              resource is attributed to the caller via uploadedById, taken
//              from session.sub and absent from the schema.
// VALIDATION : createExamResourceSchema, .strict(). `status`, `isVerified`,
//              `publishedAt`, `archivedAt` and `departmentId` are all ABSENT
//              and therefore refused with 400 — every one is written by the
//              server or by a named transition endpoint, and accepting `status`
//              would give a second, unaudited path to the one change that
//              affects what students can see.
// FLOW       : Guard → parse → validate → controller.
//
//              The course and semester are verified against this tenant
//              individually, so the caller learns which reference is wrong.
//              The department is DENORMALISED from the course rather than
//              accepted, so a resource cannot be filed under a department its
//              course does not belong to.
//
//              A new resource is always DRAFT — the README's "Draft Mode". Its
//              "Publish Immediately" is the publish endpoint called straight
//              after, which keeps the visibility transition on one audited path.
// RESPONSE   : { success: true, data: ExamResourceDto }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 500
export async function POST(request: NextRequest) {
  const SCOPE = "POST /api/exam-resources";

  try {
    const guard = await requireExamResourceAccess(request.headers);
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = createExamResourceSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const created = await examResourceController.create(
      guard.access,
      parsed.data,
      new Date()
    );

    return NextResponse.json(ok(created, "Examination resource uploaded"), { status: 201 });
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

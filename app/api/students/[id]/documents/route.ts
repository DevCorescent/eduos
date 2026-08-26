// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Documents
// FLOW   : Guard → tenant → params → load student (tenant-scoped) → body →
//          create document → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and register document metadata for a student within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  createStudentDocumentSchema,
  listStudentDocumentsQuerySchema,
  studentIdParamSchema,
} from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a document. Declared once so both handlers answer with
 * the same shape.
 *
 * The three verification columns are returned but never accepted: a reader may
 * see whether a document has been checked and by whom, while an uploader has no
 * way to assert it. StudentDocument has no tenantId column, so there is none to
 * return.
 */
const DOCUMENT_SELECT = {
  id: true,
  studentId: true,
  type: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  mimeType: true,
  isVerified: true,
  verifiedBy: true,
  verifiedAt: true,
  uploadedAt: true,
} as const;

// StudentDocument holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment,
//              listStudentDocumentsQuerySchema for ?page and ?limit.
// FLOW       : Authorise → resolve tenant → confirm the student belongs to this
//              tenant (404 otherwise) → read one page of that student's
//              documents alongside the total in a single transaction.
//              The parent check comes first: without it an unknown student id
//              would return an empty list rather than 404, silently implying the
//              student exists with no documents on file.
//              StudentDocument carries no tenantId of its own — it is reachable
//              only through its student — so resolving the student is the whole
//              of tenant isolation here. Querying documents by studentId alone
//              would be scoped by nothing.
//              Ordering is by uploadedAt with an id tiebreaker: documents
//              registered in the same batch can share a timestamp, and without
//              the tiebreaker offset pagination would be free to repeat or skip
//              rows.
// RESPONSE   : { success: true, data: { documents, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = studentIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    const parsedQuery = listStudentDocumentsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedQuery.error),
        },
        { status: 400 }
      );
    }

    const studentId = parsedParams.data.id;

    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    const { page, limit } = parsedQuery.data;
    const where = { studentId };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [documents, total] = await prisma.$transaction([
      prisma.studentDocument.findMany({
        where,
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: DOCUMENT_SELECT,
      }),
      prisma.studentDocument.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        documents,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students/[id]/documents]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment,
//              createStudentDocumentSchema for the body. type, fileName and
//              fileUrl are required; fileSize and mimeType optional.
//              Five fields are absent from the body schema and so are stripped
//              from any request supplying them: studentId, because the route
//              parameter decides which student the document belongs to, and
//              isVerified, verifiedBy, verifiedAt and uploadedAt, because those
//              record that a person checked the document and when it arrived.
// FLOW       : Authorise → resolve tenant → parse body → confirm the student
//              belongs to this tenant (404 otherwise) → create the document
//              against that student.
//              The verification columns are written explicitly as unverified
//              rather than left to their defaults. Stripping them in Zod already
//              prevents a client from setting them, but asserting the values at
//              the write site keeps the guarantee visible where the row is
//              created: a document registered through this endpoint is always
//              unverified, by nobody, at no time. Verification is a separate act
//              and no endpoint in README Phase 6 performs it.
//              No duplicate check exists because StudentDocument carries no
//              unique constraint beyond its primary key — a student may hold
//              several documents, including several of the same type, so
//              concurrent uploads are all legitimate rather than racing.
// RESPONSE   : { success: true, data: <StudentDocument>,
//                message: "Document registered" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409 is documented or handled: with no unique constraint on the
//              model, P2002 cannot be raised by this insert.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = studentIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = createStudentDocumentSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const studentId = parsedParams.data.id;

    // Tenant ownership lives on Student, not on StudentDocument, so the student
    // must be resolved before the child row is written.
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    // Single write — already atomic, so no transaction is warranted. studentId
    // comes from the route and the verification state is forced, never from the
    // request body. Both are placed after the spread so a future schema change
    // could not let them be overridden by it.
    const document = await prisma.studentDocument.create({
      data: {
        ...parsedBody.data,
        studentId,
        isVerified: false,
        verifiedBy: null,
        verifiedAt: null,
      },
      select: DOCUMENT_SELECT,
    });

    return NextResponse.json(ok(document, "Document registered"), { status: 201 });
  } catch (err) {
    // The student was deleted between the ownership check and the insert, so the
    // foreign key rejected the reference.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      isForeignKeyViolation(err)
    ) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    console.error("[POST /api/students/[id]/documents]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

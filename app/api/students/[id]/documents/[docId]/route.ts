// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Document Removal
// FLOW   : Guard → tenant → params → resolve student (tenant-scoped) → delete
//          the document scoped to that student → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Remove a single document belonging to a student within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { documentIdParamSchema, studentIdParamSchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";

// StudentDocument is referenced by nothing in the schema, so no dependent row
// can block this delete and no cascade follows it. It also carries no BigInt,
// Decimal or Json column, and the response returns no record, so the shared
// serialize() helper does not apply.

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment and
//              documentIdParamSchema for the [docId] segment. No request body is
//              read, so there is nothing a client could inject.
// FLOW       : Authorise → resolve tenant → confirm the student belongs to this
//              tenant (404 otherwise) → delete the document filtered by BOTH its
//              own id and that studentId.
//
//              The two-part filter is the security boundary. StudentDocument has
//              no tenantId column, and its id is globally unique, so a delete
//              keyed on docId alone would remove any document in the database
//              whose id a caller could guess — including one belonging to a
//              different student, or to a different university. Pairing the id
//              with the resolved student means an id that exists but belongs
//              elsewhere simply matches nothing.
//
//              deleteMany is used rather than a lookup followed by delete: it
//              performs the scoped removal in one statement and reports how many
//              rows matched, which answers the existence question without a
//              second query. That also makes the operation race-safe by
//              construction — two concurrent deletes cannot both report success,
//              because only one can match a row.
//
//              A document belonging to another student and one belonging to
//              another tenant are indistinguishable in the response: both match
//              nothing and return the same message, so no id is ever confirmed
//              to exist elsewhere.
// RESPONSE   : { success: true, data: null, message: "Document deleted" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409 or P2025 branch exists. Nothing references StudentDocument
//              so no foreign key can refuse the delete, and deleteMany reports a
//              zero count rather than raising when the row is absent — a P2025
//              handler here would be unreachable code.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const rawParams = await params;

    const parsedStudentParam = studentIdParamSchema.safeParse({ id: rawParams.id });
    const parsedDocumentParam = documentIdParamSchema.safeParse({ docId: rawParams.docId });

    if (!parsedStudentParam.success || !parsedDocumentParam.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const studentId = parsedStudentParam.data.id;
    const documentId = parsedDocumentParam.data.docId;

    // Tenant ownership lives on Student, not on StudentDocument, so the student
    // is resolved before any document is touched.
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    // Filtered by studentId as well as id, so a document belonging to another
    // student — in this tenant or any other — matches nothing.
    const removed = await prisma.studentDocument.deleteMany({
      where: { id: documentId, studentId },
    });

    if (removed.count === 0) {
      return NextResponse.json(fail("Document not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(null, "Document deleted"));
  } catch (err) {
    console.error("[DELETE /api/students/[id]/documents/[docId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

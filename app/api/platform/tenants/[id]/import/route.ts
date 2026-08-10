// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Initial University Data Import (W1.6, PRD §5.1 #14, §54, §55)
// FLOW   : requirePlatformAdmin() → Zod → lib/services/dataImport.service.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Writes the EXISTING Course and Programme models through the import
//          service. No new model, and no direct Prisma access from this file.
// PURPOSE: §55 Stage 3 — "Data templates", "Validation", "Test imports",
//          "Final migration" — for the entities §54 names.
//
// TWO METHODS, NOT FOUR ENDPOINTS
//   GET returns the catalogue and each entity's columns, which is what §55's
//   "Data templates" needs — the UI builds its template and its column
//   documentation from it rather than hard-coding either.
//
//   POST does both validation and import, chosen by `mode`. They share one code
//   path in the service, so a preview cannot disagree with the import that
//   follows it. A separate /preview endpoint would have been a second route
//   that must be kept in step with this one forever.
//
// THE TENANT COMES FROM THE ROUTE SEGMENT
//   Not from the body, and not from the CSV. No row schema defines a tenant
//   column and the request schema is strict, so there is no key through which a
//   file could name a different university. This is the whole of "never trust a
//   tenantId supplied by the CSV".
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import {
  importRequestSchema,
  MAX_IMPORT_ROWS,
  MAX_PERSON_IMPORT_ROWS,
} from "@/lib/validations/import";
import { IMPORT_ENTITIES, templateHeaders } from "@/lib/constants/importEntities";
import { runImport } from "@/lib/services/dataImport.service";
import { recordAudit, recordAuditFailure } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema.
// FLOW       : Authorise → validate the param → return the importable entities,
//              their columns and their template header rows.
// RESPONSE   : { success: true, data: { entities, maxRows } }
// STATUS     : 200 · 400 · 401 · 403 · 500
//
// Reads no tenant data, so there is nothing here to leak between universities;
// the param is still validated because the UI addresses this route per tenant.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = tenantIdParamSchema.safeParse(await params);
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

    return NextResponse.json(
      ok({
        maxRows: MAX_IMPORT_ROWS,
        entities: IMPORT_ENTITIES.map((entity) => ({
          key: entity.key,
          label: entity.label,
          model: entity.model,
          prdSource: entity.prdSource,
          duplicateKey: entity.duplicateKey,
          dependsOn: entity.dependsOn,
          createsUser: Boolean(entity.createsUser),
          // The role each imported person receives, or null. Shown in the UI so
          // an operator knows what access an import grants before running it.
          roleName: entity.roleName ?? null,
          // Per entity, because a user-creating import is capped far lower —
          // each account costs a bcrypt hash. The UI states the real number
          // rather than a global one that would be wrong for people.
          maxRows: entity.createsUser ? MAX_PERSON_IMPORT_ROWS : MAX_IMPORT_ROWS,
          columns: entity.columns,
          templateHeaders: templateHeaders(entity),
        })),
      })
    );
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/import]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + importRequestSchema (entity, csv, mode),
//              strict. Then, per row, the entity's own schema.
// FLOW       : Authorise → validate → confirm the tenant exists → run the
//              import in the requested mode → audit a commit.
// RESPONSE   : { success: true, data: <ImportReport> } — totalRows, validRows,
//              invalidRows, importedRows, skippedRows and per-row errors.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
// A FILE-LEVEL PROBLEM IS A 400; A ROW-LEVEL ONE IS A 200 WITH A REPORT.
//   Unparseable text or wrong columns mean the request cannot be acted on at
//   all. Rows that fail validation mean the request WAS acted on and produced
//   exactly the answer the operator asked for — which rows are wrong. Returning
//   400 for the second would make a successful preview look like a failure.
//
// A preview is never audited: it writes nothing, and an audit trail full of
// "somebody looked at a file" entries buries the imports that did happen.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = tenantIdParamSchema.safeParse(await params);
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = importRequestSchema.safeParse(body);
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

    const tenantId = parsedParams.data.id;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    const { entity, csv, mode } = parsedBody.data;
    const result = await runImport(tenantId, entity, csv, mode, guard.platformUserId);

    if (!result.ok) {
      // A rejected COMMIT is recorded. §47 "Failed action logs" — an attempted
      // bulk write that was refused is exactly the kind of event an
      // investigator looks for, and it leaves no other trace. The reason is
      // recorded; no row content is, so a university's data never reaches the
      // log through an error message.
      if (mode === "commit") {
        await recordAuditFailure({
          tenantId,
          actor: { userId: null, ...readRequestOrigin(request.headers) },
          action: AUDIT_ACTIONS.DATA_IMPORTED,
          resource: AUDIT_RESOURCES.DATA_IMPORT,
          after: { entity, reason: result.error, platformActor: guard.platformUserId },
        });
      }

      return NextResponse.json(fail(result.error, "VALIDATION_ERROR"), { status: 400 });
    }

    if (result.report.committed && result.report.importedRows > 0) {
      // PRD §47 "Data change logs". One entry per import, with counts only —
      // never a row, a name or a code. `userId` is null because the actor is a
      // PLATFORM operator, who is not a member of this tenant; their id travels
      // in the snapshot instead. (Same constraint as TD-W13-1: AuditLog.userId
      // refers to a tenant User.)
      await recordAudit({
        tenantId,
        actor: { userId: null, ...readRequestOrigin(request.headers) },
        action: AUDIT_ACTIONS.DATA_IMPORTED,
        resource: AUDIT_RESOURCES.DATA_IMPORT,
        after: {
          entity,
          importedRows: result.report.importedRows,
          skippedRows: result.report.skippedRows,
          totalRows: result.report.totalRows,
          platformActor: guard.platformUserId,
        },
      });
    }

    return NextResponse.json(ok(result.report));
  } catch (err) {
    console.error("[POST /api/platform/tenants/[id]/import]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

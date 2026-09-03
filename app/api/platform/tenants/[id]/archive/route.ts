// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Archive / Restore a University (W1.5, PRD §5.1, §46.3)
// FLOW   : requirePlatformAdmin() → Zod → Prisma over the EXISTING Tenant.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// PURPOSE: PRD §5.1 "Tenant deletion and data archival", non-destructively.
//
// THERE IS NO DELETE HERE, AND THAT IS THE POINT
//   Deleting a Tenant cascades away its users, roles, campuses, subscriptions,
//   students, results and certificates. §5.1 names "deletion and data
//   archival" as ONE capability, and the archival half is undefined: §46.3
//   names "Data-retention policies" and "Data-deletion workflows" without
//   specifying either, and §54's "Legacy Archival" is a step in DATA MIGRATION,
//   not tenant deletion. Shipping the destructive half alone would implement
//   the irreversible part of a requirement whose safeguards are unspecified.
//
//   So this route archives: status becomes ARCHIVED, every row is kept, and the
//   university stops serving traffic through the SAME mechanism that already
//   stops a suspended one — lib/services/tenant.ts refuses to resolve any status
//   that is not ACTIVE or TRIAL, and /api/auth/login refuses to issue a session.
//   No new enforcement path was added, so there is no second place to keep in
//   step.
//
// WHAT IS NOT INVENTED
//   No retention period, no scheduled purge, no export format, no restore
//   window. The PRD defines none of them. `restore: true` simply returns the
//   university to SUSPENDED — deliberately not straight to ACTIVE, so bringing
//   an archived institution back is an explicit two-step act rather than one
//   click that puts students back online.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantArchiveSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import { logProvisioningEvent } from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's "record required but not found" code, raised by update. */
const RECORD_NOT_FOUND = "P2025";

const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  archivedAt: true,
  archivedBy: true,
} as const;

// POST
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + tenantArchiveSchema — `restore` chooses the
//              direction, `reason` is recorded when archiving. No retention or
//              purge field is accepted, because the PRD defines none.
// FLOW       : Authorise → validate → read the tenant → archive or restore.
//              Archiving records archivedAt and the operator who did it, and
//              restoring clears both;
//              restoring returns the tenant to SUSPENDED and CLEARS neither
//              column, so the archival stays on the record.
// RESPONSE   : { success: true, data: <tenant>, message }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
// ARCHIVING AN ALREADY-ARCHIVED UNIVERSITY IS A 409, NOT A SILENT SUCCESS.
// The reason and the timestamp would otherwise be overwritten by a repeated
// click, losing when it actually happened and who decided it.
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

    const parsedBody = tenantArchiveSchema.safeParse(body);
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
    const { restore, reason } = parsedBody.data;

    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    const isArchived = existing.status === "ARCHIVED";

    if (restore) {
      if (!isArchived) {
        return NextResponse.json(
          fail("This university is not archived", "CONFLICT"),
          { status: 409 }
        );
      }

      // Back to SUSPENDED, not ACTIVE. Restoring makes the institution
      // manageable again; putting its students back online is a separate,
      // deliberate status change.
      //
      // archivedAt and archivedBy are cleared in the SAME update, which the
      // restore path previously did not do. It set the status and left the
      // stamp behind, so a restored university carried a timestamp and an
      // operator id asserting it was archived while its status said otherwise —
      // two columns of the same row disagreeing about the same fact. The panel
      // branches on `status`, so the screen looked right; anything reading the
      // stamp did not. This mirrors what exam resources already do when a
      // publish clears an archive.
      const restored = await prisma.tenant.update({
        where: { id: tenantId },
        data: { status: "SUSPENDED", archivedAt: null, archivedBy: null },
        select: TENANT_SELECT,
      });

      logProvisioningEvent("tenant-restored", guard.platformUserId, tenantId);

      return NextResponse.json(
        ok(restored, "University restored to Suspended. Set it to Active when ready.")
      );
    }

    if (isArchived) {
      return NextResponse.json(
        fail("This university is already archived", "CONFLICT"),
        { status: 409 }
      );
    }

    const archived = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedBy: guard.platformUserId,
        // The reason is kept in `settings` rather than in a dedicated column:
        // the PRD defines no archival metadata, and adding a column for one
        // undefined field would be modelling a requirement that does not exist.
        // settings is the existing free-form store on Tenant.
        ...(reason
          ? {
              settings: {
                ...(((
                  await prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { settings: true },
                  })
                )?.settings as Record<string, unknown>) ?? {}),
                archivalReason: reason,
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
      select: TENANT_SELECT,
    });

    logProvisioningEvent("tenant-archived", guard.platformUserId, tenantId);

    return NextResponse.json(
      ok(archived, "University archived. All of its data is retained.")
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === RECORD_NOT_FOUND) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    console.error("[POST /api/platform/tenants/[id]/archive]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

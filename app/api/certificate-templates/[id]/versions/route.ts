// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Template version history
// FLOW   : Guard → tenant → module → params → lineage read → response.
// ACCESS : GET — UNIVERSITY_ADMIN. No other role sees template history.
// BACKEND: Prisma (via lib/services/certificateTemplateVersions)
// PURPOSE: List every version of one certificate template, newest first.
//
// WHY A SEPARATE ENDPOINT
//   The detail endpoint answers "what is this template now". History is a
//   different question with an unbounded answer, and hanging it off the detail
//   response would grow that payload for every caller that never asked. It
//   reuses templateVersions() — the same lineage rule the fork logic applies —
//   rather than restating how versions relate to one another.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { templateVersions } from "@/lib/services/certificateTemplateVersions";
import { certificateTemplateIdParamSchema } from "@/lib/validations/certificate-template";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsed = certificateTemplateIdParamSchema.safeParse(await params);
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

    // Tenant-scoped inside the service: a lineage id from another university
    // resolves to an empty list rather than to their history.
    const versions = await templateVersions(tenantGuard.tenant.id, parsed.data.id);

    // A template that exists always appears in its own lineage, so an empty
    // list means the id belongs to nobody — or to another university. Both
    // answer 404, and identically: a 200 with [] here while the detail endpoint
    // returned 404 would let a caller tell the two apart.
    if (versions.length === 0) {
      return NextResponse.json(fail("Certificate template not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(versions));
  } catch (err) {
    console.error("[GET /api/certificate-templates/[id]/versions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

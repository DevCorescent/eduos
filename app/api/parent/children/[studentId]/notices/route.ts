// ============================================================================
// MODULE : Parent Portal — notices reaching the child (W2, PRD §32 "Notices")
// ACCESS : PARENT + tenant + StudentParent ownership.
// BACKEND: EXISTING Announcement, filtered by the audience the model defines —
//          INSTITUTION, or the child's own DEPARTMENT / BATCH / SECTION.
//          Drafts and expired notices are excluded.
// ============================================================================

import { parentChildRoute, parentListQuerySchema } from "@/lib/middleware/parentChildRoute";
import { childNotices } from "@/lib/services/parentPortal.service";

export const GET = parentChildRoute(({ studentId, tenantId, request }) => {
  const parsed = parentListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  return childNotices(studentId, tenantId, parsed.success ? parsed.data.limit : 50);
}, "notices");

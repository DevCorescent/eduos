// ============================================================================
// MODULE : Parent Portal — child documents (W2, PRD §32 "Download documents")
// ACCESS : PARENT + tenant + StudentParent ownership.
// BACKEND: EXISTING StudentDocument and Certificate. Returned separately
//          because they are different things — one the student supplied, one
//          the institution issued. Revoked certificates are excluded.
// ============================================================================

import { parentChildRoute } from "@/lib/middleware/parentChildRoute";
import { childDocuments } from "@/lib/services/parentPortal.service";

export const GET = parentChildRoute(
  ({ studentId, tenantId }) => childDocuments(studentId, tenantId),
  "documents"
);

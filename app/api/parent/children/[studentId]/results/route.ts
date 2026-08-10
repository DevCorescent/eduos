// ============================================================================
// MODULE : Parent Portal — child results (W2, PRD §32 "Examination results",
//          "Academic progress"; §18 "Parent-accessible report cards")
// ACCESS : PARENT + tenant + StudentParent ownership.
// BACKEND: EXISTING ExamResult. PUBLISHED results only — an unpublished mark is
//          provisional and must not reach a parent before the institution
//          releases it. No grade is recomputed here.
// ============================================================================

import { parentChildRoute } from "@/lib/middleware/parentChildRoute";
import { childResults } from "@/lib/services/parentPortal.service";

export const GET = parentChildRoute(
  ({ studentId, tenantId }) => childResults(studentId, tenantId),
  "results"
);

// ============================================================================
// MODULE : Parent Portal — child timetable (W2, PRD §32 "Timetable")
// ACCESS : PARENT + tenant + StudentParent ownership.
// BACKEND: EXISTING Timetable model, scoped to the child's own section. A
//          student with no section gets an empty list, never the university's.
// ============================================================================

import { parentChildRoute } from "@/lib/middleware/parentChildRoute";
import { childTimetable } from "@/lib/services/parentPortal.service";

export const GET = parentChildRoute(
  ({ studentId, tenantId }) => childTimetable(studentId, tenantId),
  "timetable"
);

// ============================================================================
// MODULE : Parent Portal — child attendance (W2, PRD §32 "Student attendance")
// ACCESS : PARENT + tenant + StudentParent ownership, enforced by
//          parentChildRoute before this file's projection runs.
// BACKEND: Reads the EXISTING Attendance model through a parent-safe select.
//          The staff attendance API is untouched — its guard was not widened.
// ============================================================================

import { parentChildRoute, parentListQuerySchema } from "@/lib/middleware/parentChildRoute";
import { childAttendance } from "@/lib/services/parentPortal.service";

export const GET = parentChildRoute(({ studentId, tenantId, request }) => {
  // An unparseable ?limit falls back to the default rather than failing the
  // request: a bad query string should not hide a child's attendance.
  const parsed = parentListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  return childAttendance(studentId, tenantId, parsed.success ? parsed.data.limit : 50);
}, "attendance");

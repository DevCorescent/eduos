// ============================================================================
// MODULE : Parent Portal — child fee status (W2, PRD §32 "Fee status")
// ACCESS : PARENT + tenant + StudentParent ownership.
// BACKEND: EXISTING FeeDemand and Payment, READ ONLY.
//
// NO PAYMENT IS TAKEN HERE. §32 also names "Online payments", but the gateway,
// provider and reconciliation behaviour are defined nowhere in the PRD, so
// nothing in the parent portal initiates one. Recorded as a PRD gap.
// ============================================================================

import { parentChildRoute } from "@/lib/middleware/parentChildRoute";
import { childFees } from "@/lib/services/parentPortal.service";

export const GET = parentChildRoute(
  ({ studentId, tenantId }) => childFees(studentId, tenantId),
  "fees"
);

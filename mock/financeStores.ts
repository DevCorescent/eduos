// ============================================================================
// MODULE : Mock — Finance & Certificate Stores
// PURPOSE: Mutable stores for fee demands and issued certificates.
//
//          Both genuinely need to be mutable: raising demands, waiving a
//          balance, issuing and revoking are the primary actions on their
//          screens, and each must be visible immediately afterwards.
// ============================================================================

import type { Certificate, FeeDemand } from "@/types";
import { MOCK_FEE_DEMANDS } from "./data/finance";
import { MOCK_CERTIFICATES } from "./data/certificates";
import { createMockStore } from "./store";

export const feeDemandStore = createMockStore<FeeDemand>(MOCK_FEE_DEMANDS, "fdm_new", 4);

export const certificateStore = createMockStore<Certificate>(
  MOCK_CERTIFICATES,
  "cert_new",
  4
);

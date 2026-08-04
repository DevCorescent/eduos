"use server";

// ============================================================================
// MODULE : Actions — Finance & Certificates
// PURPOSE: Server Actions for waiving demands, generating them, and issuing or
//          revoking certificates.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
// ============================================================================

import {
  generateFeeDemands,
  issueCertificate,
  revokeCertificate,
  waiveFeeDemand,
} from "@/services/finance";
import type { ActionResult } from "./setup";

export async function waiveFeeDemandAction(id: string): Promise<ActionResult> {
  return waiveFeeDemand(id);
}

/**
 * Raise demands for a batch.
 *
 * Returns the created/skipped split rather than a bare success, because the
 * skipped count is the number that matters: a second run reporting "0 created,
 * 118 skipped" is how the operator knows the first run already worked, rather
 * than wondering whether anything happened.
 */
export async function generateFeeDemandsAction(
  batchId: string,
  semesterId: string,
  feeStructureId: string
): Promise<ActionResult> {
  if (!batchId || !semesterId || !feeStructureId) {
    return { success: false, error: "Select a batch, semester and fee structure." };
  }
  return generateFeeDemands(batchId, semesterId, feeStructureId);
}

export async function issueCertificateAction(
  studentId: string,
  templateId: string
): Promise<ActionResult> {
  if (!studentId || !templateId) {
    return { success: false, error: "Select a student and a template." };
  }
  return issueCertificate(studentId, templateId);
}

export async function revokeCertificateAction(id: string): Promise<ActionResult> {
  return revokeCertificate(id);
}

"use server";

// ============================================================================
// MODULE : Actions — Open Electives
// PURPOSE: The staff operations that settle an offering, and the student
//          operation that records a ranking, as Server Actions.
//
//          They run on the server for the same reason every other mutation in
//          this project does: the session is an httpOnly cookie, so issuing the
//          request from the server keeps the credential out of client
//          JavaScript entirely. services/client.ts forwards that cookie and the
//          tenant host onto the outbound request.
//
//          Neither action navigates or revalidates. The caller is a client
//          component that calls router.refresh() on success, which re-runs the
//          Server Component page — the same convention EntityCrud uses.
// ============================================================================

import {
  allocateOffering,
  lockOffering,
  submitPreferences,
  type PreferenceItem,
} from "@/services/electives";
import type { ActionResult } from "./setup";

/**
 * Close an offering to further choices.
 *
 * Locking is a precondition of allocation, not a cosmetic state: allocating an
 * offering that students may still edit would settle seats against a set of
 * preferences that changes underneath the run.
 */
export async function lockOfferingAction(offeringId: string): Promise<ActionResult> {
  return lockOffering(offeringId);
}

/**
 * Run allocation for one offering.
 *
 * `force` is not exposed. Discarding a completed run's verdicts is a decision
 * with consequences for students who have already been told their result, and
 * it should be a deliberate act behind its own confirmation rather than a
 * parameter this button could pass by accident.
 */
export async function allocateOfferingAction(offeringId: string): Promise<ActionResult> {
  return allocateOffering(offeringId);
}

/**
 * Record a student's ranked choices for a semester.
 *
 * Replaces the previous set wholesale, which is the API's contract and not a
 * choice made here — a partial update would leave a student unable to remove a
 * choice they no longer want.
 */
export async function submitPreferencesAction(
  semesterId: string,
  preferences: PreferenceItem[]
): Promise<ActionResult> {
  return submitPreferences(semesterId, preferences);
}

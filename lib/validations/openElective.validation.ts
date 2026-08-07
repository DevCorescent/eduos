// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Validation
// PURPOSE: Shape and bounds for the five open-elective requests.
//
// THE PREFERENCE LIST IS WHERE THE REAL WORK IS
//   A preference submission is not a bag of ids — it is an ORDERED list, and
//   three things can be wrong with it that no per-field rule would catch:
//
//     • the same offering ranked twice        -> which rank wins?
//     • two offerings sharing one rank        -> which is preferred?
//     • ranks 1, 2, 5                         -> what happened to 3 and 4?
//
//   The database catches the second and third only AFTER a write is attempted,
//   as a unique-constraint violation with a message no student could act on.
//   All three are refused here instead, with a message that names the problem.
//
//   Ranks are required to be a CONTIGUOUS PERMUTATION of 1..n. That is stricter
//   than the unique constraint needs, and deliberately so: a list ranked 1, 2, 5
//   is almost always a client that dropped a row, and honouring it would silently
//   allocate against choices the student did not realise they had lost.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : shape, bounds, enum membership, rank coherence, and the stripping of
//          identity keys.
//   Not  : whether an offering exists, whether it is OPEN, whether the student
//          is eligible, or whether a seat remains. Every one of those needs the
//          database and belongs to the service — and the answer to the last two
//          is a business outcome, not a 400.
//
// SELF-SERVICE, PARTIALLY
//   Unlike Phases 17 and 18, this module is DUAL-MODE: a student acts on their
//   own record, while an admin acts on a cohort. So `studentId` is stripped from
//   the student-facing schemas (a student never names themselves) but the admin
//   schemas legitimately name an OFFERING. The asymmetry is the point, and
//   `rejectsStudentIdentity` below makes the student half testable.
// ============================================================================

import { z } from "zod";
import {
  ElectiveAllocationStrategy,
  OpenElectiveStatus,
} from "@/app/generated/prisma/enums";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { identifier } from "@/lib/validations/shared";

/**
 * Fewest choices a student may submit.
 *
 * One, not zero. Clearing a preference list is a withdrawal rather than a
 * submission, and conflating the two would let an empty POST silently erase a
 * student's choices — the most destructive thing this endpoint can do, reached
 * by the least deliberate action.
 */
export const MIN_PREFERENCES = 1;

/**
 * Most choices a student may submit.
 *
 * A bound rather than a policy claim: no university runs an elective basket
 * this wide, and an unbounded list is an unbounded write.
 */
export const MAX_PREFERENCES = 20;

/** Highest rank value accepted. Equal to MAX_PREFERENCES by construction. */
export const MAX_PREFERENCE_RANK = MAX_PREFERENCES;

/** Largest seat count an offering may declare. */
export const MAX_SEATS = 10_000;

/** One ranked choice. */
const preferenceItemSchema = z.object({
  offeringId: identifier,
  preferenceRank: z.number().int().min(1).max(MAX_PREFERENCE_RANK),
});

export type PreferenceItem = z.infer<typeof preferenceItemSchema>;

/** Whether every offering appears at most once. */
function offeringsAreDistinct(items: readonly PreferenceItem[]): boolean {
  return new Set(items.map((item) => item.offeringId)).size === items.length;
}

/**
 * Whether the ranks are exactly 1..n with nothing missing and nothing repeated.
 *
 * Checked by comparing the sorted ranks against their positions, which catches
 * duplicates and gaps in one pass without a second data structure.
 */
function ranksAreContiguous(items: readonly PreferenceItem[]): boolean {
  const ranks = items.map((item) => item.preferenceRank).sort((a, b) => a - b);

  return ranks.every((rank, index) => rank === index + 1);
}

/**
 * Body for POST /api/open-electives/select.
 *
 * `semesterId` is named by the client because a student may hold preferences in
 * more than one semester and the submission replaces exactly one semester's set.
 * `studentId` is NOT named and never can be — it is resolved from the session.
 *
 * `.strict()` here, unlike the read schemas: a misspelled key on a submission
 * that REPLACES a student's whole preference list must be a 400, not a silent
 * strip. Being lenient about reads and strict about destructive writes is the
 * same split Phase 17 applied to its fee filters.
 */
export const submitPreferencesSchema = z
  .object({
    semesterId: identifier,
    preferences: z
      .array(preferenceItemSchema)
      .min(MIN_PREFERENCES)
      .max(MAX_PREFERENCES),
  })
  .strict()
  .refine((data) => offeringsAreDistinct(data.preferences), {
    message: "An offering may be ranked only once",
    path: ["preferences"],
  })
  .refine((data) => ranksAreContiguous(data.preferences), {
    message: "Preference ranks must be 1..n with no gaps and no duplicates",
    path: ["preferences"],
  });

export type SubmitPreferencesInput = z.infer<typeof submitPreferencesSchema>;

/**
 * Query for GET /api/open-electives.
 *
 * Read-lenient: unknown keys are stripped rather than rejected, so a client
 * appending a cache-busting parameter does not receive a 400.
 */
export const listOfferingsQuerySchema = paginationQuerySchema.extend({
  semesterId: identifier.optional(),
  status: z.enum(OpenElectiveStatus).optional(),
  departmentId: identifier.optional(),
  courseId: identifier.optional(),
});

export type ListOfferingsQuery = z.infer<typeof listOfferingsQuerySchema>;

/**
 * Query for GET /api/open-electives/status.
 *
 * `semesterId` is required. A status response spans one semester's choices, and
 * defaulting to "the current semester" would need this layer to decide which
 * semester is current — a determination it cannot make and should not guess.
 */
export const electiveStatusQuerySchema = z.object({
  semesterId: identifier,
});

export type ElectiveStatusQuery = z.infer<typeof electiveStatusQuerySchema>;

/**
 * Body for POST /api/open-electives/allocate.
 *
 * One offering per run, per the Phase 19 decision. `.strict()` because this is
 * the most consequential write in the module: it assigns seats to students and
 * creates enrolments, and a misspelled key here must not be quietly ignored.
 *
 * There is deliberately no `strategy` field. The strategy is CONFIGURATION on
 * the offering; accepting one per request would let a caller override a
 * department's declared policy at allocation time, which is precisely the
 * hardcoding this design exists to prevent.
 */
export const allocateSchema = z
  .object({
    offeringId: identifier,
    /**
     * Whether a previous run's verdicts may be discarded and recomputed.
     *
     * Defaults to false, so a re-run is an explicit act. Whether it is
     * PERMITTED at all is a lifecycle rule the service enforces; this only
     * carries the caller's intent.
     */
    force: z.boolean().default(false),
  })
  .strict();

export type AllocateInput = z.infer<typeof allocateSchema>;

/**
 * Body for PATCH /api/open-electives/lock.
 *
 * Also one offering, per the Phase 19 decision. Carries no target status: this
 * endpoint locks, and a body able to name any status would make it a general
 * transition endpoint with a misleading name.
 */
export const lockSchema = z
  .object({
    offeringId: identifier,
  })
  .strict();

export type LockInput = z.infer<typeof lockSchema>;

/**
 * The schemas a student submits, for the identity-stripping guarantee.
 *
 * Only the student-facing half. The admin schemas legitimately name an
 * offering, and asserting they name no student would be asserting something
 * that is true for a different reason.
 */
export const STUDENT_FACING_SCHEMAS = [
  submitPreferencesSchema,
  electiveStatusQuerySchema,
] as const;

/** Identity keys a student-facing request may never supply. */
export const FORBIDDEN_IDENTITY_KEYS = ["studentId", "userId", "tenantId"] as const;

/** Strategies an offering may declare. Re-exported so a test names one source. */
export const ALLOCATION_STRATEGIES = [
  ElectiveAllocationStrategy.FCFS,
  ElectiveAllocationStrategy.MERIT,
] as const;

// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Validation
// PURPOSE: Bound the small query surface the three profile endpoints accept.
//
// THE MOST IMPORTANT THING HERE IS WHAT IS ABSENT
//   There is NO studentId schema, and there must never be one. Phase 18 is
//   self-service: the student is resolved tenantId + userId -> Student, and a
//   client-supplied id is not merely ignored, it is unexpressible. A schema
//   that accepted one — even to reject it later — would be the first step
//   toward a route that trusted it, so the field simply does not exist in this
//   module's vocabulary.
//
//   `rejectsIdentityOverride` below makes that guarantee testable rather than
//   merely stated: every schema strips studentId, userId and tenantId.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : enum membership for the achievement category filter, bounds on the
//          notification limit, and the stripping of identity keys.
//   Not  : whether the student exists, whether they have a profile, or whether
//          the caller may read it. All three are the service's, and the answer
//          to the last is FORBIDDEN rather than a validation error.
//
// No pagination schema is declared, and that is a contract decision. A profile
// is one document; a page of a profile is not a profile. The achievement and
// document lists are bounded by what one student holds — tens of rows — and a
// paged achievement list would make the dashboard's own count disagree with it.
// ============================================================================

import { z } from "zod";
import { AchievementCategory } from "@/app/generated/prisma/enums";

/**
 * Largest number of notifications a dashboard panel will return.
 *
 * A bound rather than pagination: a dashboard shows a handful, and page two of
 * a dashboard panel is not a thing anyone asks for.
 */
export const MAX_NOTIFICATIONS = 20;

/** Notifications returned when the caller expresses no preference. */
export const DEFAULT_NOTIFICATIONS = 5;

/**
 * Query for GET /api/student/achievements.
 *
 * `category` narrows the list. Unknown keys are STRIPPED rather than rejected,
 * which is Zod's default and the project-wide convention for read endpoints: a
 * client appending a cache-busting parameter should not receive a 400.
 */
export const achievementQuerySchema = z.object({
  category: z.enum(AchievementCategory).optional(),
});

export type AchievementQuery = z.infer<typeof achievementQuerySchema>;

/**
 * Query for GET /api/student/dashboard.
 *
 * `notifications` caps the panel. Coerced because a search param always arrives
 * as a string, and bounded at both ends so a caller can neither ask for zero
 * (which would be a silently empty panel) nor for the whole table.
 */
export const dashboardQuerySchema = z.object({
  notifications: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_NOTIFICATIONS)
    .default(DEFAULT_NOTIFICATIONS),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/**
 * Query for GET /api/student/profile.
 *
 * Deliberately empty of filters. A profile is returned whole — a caller cannot
 * ask for "just the parents", because assembling a partial profile would mean
 * a second shape to test and a second set of nulls to reason about for no
 * benefit a client cannot get by ignoring fields.
 *
 * It exists as a schema rather than being skipped so the identity-stripping
 * guarantee applies here too.
 */
export const profileQuerySchema = z.object({});

export type ProfileQuery = z.infer<typeof profileQuerySchema>;

/**
 * Every schema in this module, for the identity-stripping guarantee.
 *
 * Exported so the test can iterate them rather than naming each one — a schema
 * added later is then covered automatically instead of being forgotten.
 */
export const STUDENT_PROFILE_SCHEMAS = [
  achievementQuerySchema,
  dashboardQuerySchema,
  profileQuerySchema,
] as const;

/**
 * The identity keys no client may ever supply to this module.
 *
 * Exported so the guarantee is stated in one place and asserted against that
 * same place, rather than restated in a test that could drift from it.
 */
export const FORBIDDEN_IDENTITY_KEYS = ["studentId", "userId", "tenantId"] as const;

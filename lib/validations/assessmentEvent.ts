// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event
// LAYER  : Validation
// PURPOSE: Shape and bounds for every assessment-event request, applied before
//          the controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : field shape, enum membership, the decimal scale of maxMarks, and
//          title bounds — all decidable from the request body alone.
//   Not  : whether the component, course, semester, section and faculty exist
//          in this tenant; whether the component's SCHEME is ACTIVE; which
//          sitting number comes next; whether the sitting is still editable;
//          and whether a status transition is legal. Every one of those depends
//          on stored state.
//
// WHAT IS DELIBERATELY NOT ACCEPTED
//   sequenceNumber and status are absent from every schema below. The sitting
//   number is assigned by the server from the sittings that already exist — a
//   client able to choose it could hide a sitting from a BEST_N aggregation.
//   The status moves only through the dedicated transition endpoint, where the
//   state machine is applied.
// ============================================================================

import { z } from "zod";
import { AssessmentEventStatus } from "@/app/generated/prisma/client";
import {
  ASSESSMENT_EVENT_TITLE_MAX_LENGTH,
  ASSESSMENT_EVENT_TITLE_MIN_LENGTH,
} from "@/lib/constants/assessmentEvent";
import { MAX_MARKS_MAX, MAX_MARKS_MIN } from "@/lib/constants/evaluationComponent";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { boundedDecimal, identifier } from "@/lib/validations/shared";

const eventTitle = z
  .string()
  .trim()
  .min(ASSESSMENT_EVENT_TITLE_MIN_LENGTH)
  .max(ASSESSMENT_EVENT_TITLE_MAX_LENGTH);

/**
 * Body schema for POST /api/assessment-events.
 *
 * `maxMarks` is OPTIONAL. Omitting it means "however many the component
 * contributes on", which the service fills from the component — the common
 * case, and one a caller should not have to restate. Supplying it means the
 * paper was set out of a different total, which is an ordinary arrangement and
 * is reconciled by a SCALE rule rather than by pretending the two figures are
 * one.
 *
 * `scheduledAt` uses the project-wide z.coerce.date() convention. Note the
 * known project-wide caveat recorded as TD-002: coercion maps null and booleans
 * onto the Unix epoch rather than rejecting them. Kept for consistency rather
 * than diverging here.
 */
export const createAssessmentEventSchema = z.object({
  evaluationComponentId: identifier,
  courseId: identifier,
  semesterId: identifier,
  sectionId: identifier.nullable().optional(),
  title: eventTitle,
  maxMarks: boundedDecimal(MAX_MARKS_MIN, MAX_MARKS_MAX).optional(),
  scheduledAt: z.coerce.date().optional(),
  conductedById: identifier.nullable().optional(),
});

export type CreateAssessmentEventInput = z.infer<typeof createAssessmentEventSchema>;

/**
 * Body schema for PATCH /api/assessment-events/[id].
 *
 * The references are absent and therefore unpatchable: moving a sitting to a
 * different component, course or term would silently reattribute every mark
 * recorded against it. A sitting in the wrong place is created again in the
 * right one.
 *
 * What remains is the sitting's own description — its title, what it was marked
 * out of, when it was held and who ran it. Even that is refused once entry has
 * opened, because changing maxMarks would revalue marks already recorded; the
 * service enforces that against the stored status.
 *
 * At least one key must be present: an empty body is a client error, not a
 * silent no-op that would still advance updatedAt.
 */
export const updateAssessmentEventSchema = z
  .object({
    title: eventTitle.optional(),
    maxMarks: boundedDecimal(MAX_MARKS_MIN, MAX_MARKS_MAX).optional(),
    scheduledAt: z.coerce.date().optional(),
    conductedById: identifier.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

export type UpdateAssessmentEventInput = z.infer<typeof updateAssessmentEventSchema>;

/**
 * Body schema for POST /api/assessment-events/[id]/status.
 *
 * ONE endpoint naming its target status, rather than four verb routes —
 * open, lock, publish and unpublish would be four copies of the same
 * guard/validate/delegate skeleton, and the state machine would be spread
 * across four files instead of living in one constant.
 *
 * That is a deliberate departure from C2, where activate and archive ARE
 * separate routes: two transitions justify two endpoints, five do not.
 *
 * Which transitions are legal is a rule about the STORED status, so the machine
 * itself is applied in the service.
 */
export const assessmentEventStatusSchema = z.object({
  status: z.enum(AssessmentEventStatus),
});

export type AssessmentEventStatusInput = z.infer<typeof assessmentEventStatusSchema>;

/**
 * Query schema for GET /api/assessment-events.
 *
 * Extends the shared pagination contract. `semesterId` + `courseId` ride
 * @@index([tenantId, semesterId, courseId]) — the assessment-calendar read and
 * the calculation engine's input set. The remaining filters narrow an
 * already-bounded result rather than driving the scan.
 */
export const listAssessmentEventsQuerySchema = paginationQuerySchema.extend({
  courseId: identifier.optional(),
  semesterId: identifier.optional(),
  sectionId: identifier.optional(),
  evaluationComponentId: identifier.optional(),
  status: z.enum(AssessmentEventStatus).optional(),
});

export type ListAssessmentEventsQuery = z.infer<typeof listAssessmentEventsQuerySchema>;

/** Route param schema for /api/assessment-events/[id] and its sub-route. */
export const assessmentEventParamSchema = z.object({
  id: identifier,
});

export type AssessmentEventParam = z.infer<typeof assessmentEventParamSchema>;

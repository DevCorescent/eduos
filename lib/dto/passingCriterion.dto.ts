// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
// TWO CONVERSIONS AT THIS BOUNDARY, as in every Phase 16 DTO: Date to ISO-8601
// string, and Decimal to a lossless string. `threshold` is Decimal(6,2), so it
// is reported as "21.00" rather than as a number — Number() would be lossy in
// the general case and would leak a Prisma class into the response type.
//
// ONE FIELD IS DERIVED, NOT STORED
//   `scope` is computed from `metric`. A client rendering a regulation needs to
//   group course-level requirements separately from semester-level ones, and
//   the engine needs to know when to evaluate each. It is derived because the
//   metric already determines it; a stored column would be a second source of
//   truth able to disagree with the metric it describes.
// ============================================================================

import type {
  CriterionOutcome,
  PassingMetric,
  ThresholdUnit,
} from "@/app/generated/prisma/client";
import type { CriterionScope } from "@/lib/constants/passingCriterion";

/** One minimum a student must meet beyond being awarded a passing grade. */
export interface PassingCriterionDTO {
  id: string;
  tenantId: string;
  schemeId: string;

  /** Null for every metric that is not a property of a single component. */
  componentId: string | null;

  code: string;
  name: string;
  description: string | null;

  metric: PassingMetric;

  /** Decimal(6,2) as a lossless string, e.g. "21.00". */
  threshold: string;
  unit: ThresholdUnit;

  failureOutcome: CriterionOutcome;

  /** Derived: whether this is evaluated per course or once per semester. */
  scope: CriterionScope;

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * A regulation's whole criterion set.
 *
 * Returned unpaginated and ordered by code, which is unique per scheme and
 * therefore a total order. Criteria form a CONJUNCTION — every one must hold —
 * so a page of them would misrepresent the requirement: a client seeing three
 * of five criteria would believe a student meeting those three has passed.
 *
 * The two counts are reported separately because they are evaluated at
 * different times by different parts of the engine, and an administrator
 * reviewing a regulation needs to see at a glance that it constrains both.
 */
export interface PassingCriterionListDTO {
  schemeId: string;
  isMutable: boolean;
  courseScopedCount: number;
  semesterScopedCount: number;
  criteria: PassingCriterionDTO[];
}

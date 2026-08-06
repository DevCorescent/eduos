// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
//          Two conversions happen at this boundary and nowhere else:
//
//          • Date -> ISO-8601 string. Returning a Date relies on
//            JSON.stringify to convert it, which makes the wire contract a
//            side effect of the serializer rather than a declared type. An
//            explicit string means the contract is what this file says it is.
//
//          • Decimal -> string. Prisma's Decimal defines its own toJSON, so it
//            would survive JSON.stringify, but its TypeScript type is a class
//            instance — leaking it into the DTO would make the response type
//            unusable by any consumer that is not running Prisma. String is
//            lossless for a decimal, unlike number.
// ============================================================================

import type {
  AttemptPolicy,
  EvaluationSchemeStatus,
  GradeCalculationMethod,
  GradeScaleStatus,
  RoundingMode,
} from "@/app/generated/prisma/client";
import type { Pagination } from "@/types/api";

/**
 * The grade scale a regulation cites, summarised.
 *
 * Enough for a client to render "graded on UG-10-POINT v2 (active, absolute,
 * out of 10.00)" without a second request, and deliberately not the full scale:
 * the bands belong to the grade-scale endpoint, and embedding them here would
 * make every scheme response grow with a vocabulary the caller may not need.
 *
 * `status` is included because it is the one fact that decides whether the
 * citing scheme can be activated at all.
 */
export interface EvaluationSchemeGradeScaleDTO {
  id: string;
  code: string;
  name: string;
  version: number;
  status: GradeScaleStatus;
  method: GradeCalculationMethod;
  /** Decimal(4,2) as a lossless string, e.g. "10.00". */
  maxGradePoint: string;
}

/**
 * A single evaluation scheme revision.
 *
 * Every column of the model is reported. There is nothing secret on this row —
 * it is configuration, and a reader authorised to see the regulation is
 * authorised to see all of it. tenantId is included to match the project's
 * existing entity responses; it is never accepted as input.
 */
export interface EvaluationSchemeDTO {
  id: string;
  tenantId: string;

  code: string;
  name: string;
  description: string | null;

  version: number;
  status: EvaluationSchemeStatus;

  gradeScaleId: string;

  attemptPolicy: AttemptPolicy;
  marksRounding: RoundingMode;
  marksPrecision: number;
  gpaRounding: RoundingMode;
  gpaPrecision: number;

  supersededById: string | null;

  /** ISO-8601, or null while the revision is still a draft. */
  activatedAt: string | null;
  activatedById: string | null;
  /** ISO-8601, or null until the revision is retired. */
  archivedAt: string | null;

  createdById: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * A scheme with its cited grade scale resolved.
 *
 * Returned by the single-resource reads and by every mutation, because a caller
 * that has just created or activated a regulation needs to see what it grades
 * against. The list endpoint returns the flat DTO instead: joining the scale
 * for every row of every page would be a per-row join bought for a column the
 * list does not display.
 */
export interface EvaluationSchemeDetailDTO extends EvaluationSchemeDTO {
  gradeScale: EvaluationSchemeGradeScaleDTO;
}

/**
 * One page of schemes.
 *
 * The rows sit under an entity-named key rather than a generic `items`,
 * matching every other collection endpoint in the project and the
 * ListEnvelope<K, T> contract in types/api.ts.
 */
export interface EvaluationSchemeListDTO {
  schemes: EvaluationSchemeDTO[];
  pagination: Pagination;
}

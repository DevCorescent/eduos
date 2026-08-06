// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : Validation
// PURPOSE: Shape and bounds for the four result requests, applied before the
//          controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : that a path parameter is present and non-empty once trimmed, and
//          that an optional semester filter is well-formed.
//   Not  : that the id exists, that it belongs to this tenant, or that the
//          caller may read it. Student.id and Semester.id are cuids and
//          therefore OPAQUE keys — no format assertion can distinguish an
//          unrecognised id from an invalid one, so an unrecognised but
//          well-formed id is a 404 (or a 403 for a student asking about
//          someone else) rather than a 400.
//
// No response schema is declared and no pagination schema either. Both are
// deliberate and explained where the shapes are: a cohort statistic computed
// from a page would be wrong rather than partial.
// ============================================================================

import { z } from "zod";
import { identifier } from "@/lib/validations/shared";

/** Route params for /api/results/student/[studentId] and its siblings. */
export const studentResultParamSchema = z.object({
  studentId: identifier,
});

export type StudentResultParam = z.infer<typeof studentResultParamSchema>;

/** Route params for /api/results/semester/[semesterId]. */
export const semesterResultParamSchema = z.object({
  semesterId: identifier,
});

export type SemesterResultParam = z.infer<typeof semesterResultParamSchema>;

/**
 * Optional query for GET /api/results/student/[studentId].
 *
 * `semesterId` narrows the record to one semester. Absent, the endpoint returns
 * every semester — which is what a student portal wants on first load, and what
 * a CGPA needs to be correct at all.
 *
 * Unknown keys are stripped rather than rejected, which is Zod's default and
 * the project-wide convention: a client appending a cache-busting parameter
 * should not receive a 400.
 */
export const studentResultQuerySchema = z.object({
  semesterId: identifier.optional(),
});

export type StudentResultQuery = z.infer<typeof studentResultQuerySchema>;

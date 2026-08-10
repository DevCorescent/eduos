// ============================================================================
// OWNER  : Gauransh
// MODULE : Parent Portal — shared child-route handler (W2, PRD §32)
// PURPOSE: Every parent feature is the same request shape: validate the student
//          id, prove the child is theirs, read a parent-safe projection, reply
//          in the existing envelope.
//
// WHY A HELPER RATHER THAN SIX COPIES
//   The ownership check is the security boundary of the whole portal. Six
//   hand-written copies is six chances for one to drift — to forget the tenant
//   scope, or to read the id before the guard rather than after. Written once,
//   every feature route is a projection function and nothing else, and none of
//   them can reach a student the guard did not return.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireParentChild } from "@/lib/middleware/requireParent";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * The [studentId] segment.
 *
 * No cuid shape is asserted — the id is an opaque key, and asserting a format
 * would turn an unrecognised-but-well-formed id into a 400 when the accurate
 * answer is the guard's 404.
 */
const studentIdParamSchema = z.object({ studentId: z.string().trim().min(1) });

/**
 * How many rows a list feature returns.
 *
 * Bounded so a parent cannot ask for an unbounded history in one request.
 * Coerced from a search param, which always arrives as text.
 */
export const parentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** What a feature does once ownership is proven. */
type ChildReader<T> = (args: {
  studentId: string;
  tenantId: string;
  request: NextRequest;
}) => Promise<T>;

/**
 * Build a GET handler for one child-scoped parent feature.
 *
 * The reader is called ONLY with a studentId the guard returned — never the raw
 * one from the URL — so a projection cannot accidentally trust client input.
 *
 * @example
 * export const GET = parentChildRoute(({ studentId, tenantId }) =>
 *   childTimetable(studentId, tenantId)
 * )
 */
export function parentChildRoute<T>(read: ChildReader<T>, label = "parent data") {
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ studentId: string }> }
  ): Promise<NextResponse> {
    try {
      // Route params resolve asynchronously in this Next.js version.
      const parsed = studentIdParamSchema.safeParse(await params);
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false as const,
            error: "Invalid input",
            code: "VALIDATION_ERROR",
            details: validationDetails(parsed.error),
          },
          { status: 400 }
        );
      }

      // Authentication, PARENT role, tenant, Parent record and the
      // StudentParent link — all five, before any data is read.
      const guard = await requireParentChild(parsed.data.studentId);
      if (!guard.authorized) return guard.response;

      const data = await read({
        // The guard's value, not the URL's. They are equal here by
        // construction, and using the guard's makes that structural.
        studentId: guard.studentId,
        tenantId: guard.tenant.id,
        request,
      });

      return NextResponse.json(ok(data));
    } catch (err) {
      console.error(`[GET parent ${label}]`, err);
      return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
    }
  };
}

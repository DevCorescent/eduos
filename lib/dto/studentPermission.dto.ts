// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Permission System (Phase 21)
// LAYER  : DTO
// PURPOSE: The shape GET /api/student/permissions returns.
//
// THE MATRIX IS ACCOMPANIED BY WHO IT APPLIES TO
//   Returning the two lists alone would leave a client unable to tell whose
//   permissions it received. The DTO therefore carries the resolved subject —
//   the caller's own student id, enrollment number and status — so a portal can
//   label the view and, more importantly, so a response cached against the
//   wrong account is detectable rather than silently applied.
//
// `status` IS REPORTED, NOT INTERPRETED
//   A student whose StudentStatus is not ACTIVE still receives the same matrix.
//   Nothing in the README says a graduated or suspended student holds fewer
//   permissions, and inventing that rule here would deny access the specification
//   grants. The status is reported so a client can decide what to show; the
//   server's own refusals continue to come from the route guards.
// ============================================================================

import type { StudentStatus } from "@/app/generated/prisma/enums";
import {
  STUDENT_CAN,
  STUDENT_CANNOT,
  type StudentCapability,
} from "@/lib/constants/studentPermissions";

/** Who the matrix was resolved for. Never client-supplied. */
export interface StudentPermissionSubjectDto {
  readonly studentId: string;
  readonly enrollmentNo: string;
  readonly status: StudentStatus;
}

/** The permission matrix, plus its subject. */
export interface StudentPermissionsDto {
  readonly subject: StudentPermissionSubjectDto;
  /** The role the matrix describes. Constant, but stated so a client need not assume it. */
  readonly role: string;
  readonly can: readonly StudentCapability[];
  readonly cannot: readonly StudentCapability[];
}

/** The Student columns this module reads. Declared so the service states its need. */
export interface StudentPermissionSubjectRow {
  readonly id: string;
  readonly enrollmentNo: string;
  readonly status: StudentStatus;
}

/**
 * Build the response.
 *
 * The two lists are spread into new arrays rather than passed by reference.
 * `STUDENT_CAN` and `STUDENT_CANNOT` are module-level constants, and handing a
 * caller the live object would let anything downstream mutate the matrix every
 * later request also reads.
 */
export function toStudentPermissionsDto(
  student: StudentPermissionSubjectRow,
  role: string
): StudentPermissionsDto {
  return {
    subject: {
      studentId: student.id,
      enrollmentNo: student.enrollmentNo,
      status: student.status,
    },
    role,
    can: [...STUDENT_CAN],
    cannot: [...STUDENT_CANNOT],
  };
}

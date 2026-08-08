// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Permission System (Phase 21)
// LAYER      : Service
// PURPOSE    : Resolve the caller to their OWN Student row and return the
//              permission matrix for it.
// ARCHITECTURE:
//   • Service owns the one rule this module has: a permitted role with no
//     Student row in this tenant is FORBIDDEN, not served an empty matrix.
//   • It computes nothing. The matrix is a constant; this layer decides only
//     WHETHER the caller is entitled to be told about it.
//
// SELF-SERVICE, ENFORCED BY SIGNATURE
//   The single public method takes (tenantId, userId) and has no studentId
//   parameter. A caller-supplied identifier is not ignored — there is nowhere
//   to put one. This mirrors Phase 17 and Phase 18 exactly.
//
// WHY THIS IS A SEPARATE SERVICE AND NOT A METHOD ON StudentProfileService
//   Phase 18's service composes three other services and is wired to a
//   repository that reads seven collections. Adding a method that needs one
//   two-column lookup would drag this endpoint's cost and its test setup up to
//   that module's, for no shared logic — the matrix has nothing in common with
//   profile composition beyond both being student-facing. Keeping it separate
//   also means Phase 18's files are not edited, which the assignment requires.
//
// QUERY BUDGET: one statement. Independent of everything.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { ROLES } from "@/constants/roles";
import { STUDENT_PERMISSION_MESSAGE } from "@/lib/constants/studentPermissions";
import {
  toStudentPermissionsDto,
  type StudentPermissionSubjectRow,
  type StudentPermissionsDto,
} from "@/lib/dto/studentPermission.dto";

/**
 * The one read this module performs.
 *
 * A NARROW PORT rather than a repository class: it is a single projection no
 * existing repository exposes in this shape (Phase 18's findStudentByUserId
 * selects `id` alone), and a whole repository for one lookup would be more
 * surface than the lookup justifies. The same reasoning, and the same shape, as
 * the adapters in feedback.controller.ts.
 *
 * Declared here so the service imports a CONTRACT rather than a live Prisma
 * connection, which is what lets every branch below be unit-tested with no
 * database and no environment.
 */
export interface StudentPermissionSubjectPort {
  /** The caller's Student row in this tenant, or null if they own none. */
  findSubject(
    tenantId: string,
    userId: string
  ): Promise<StudentPermissionSubjectRow | null>;
}

export class StudentPermissionService {
  constructor(private readonly subjects: StudentPermissionSubjectPort) {}

  /**
   * GET /api/student/permissions
   *
   * RULES   : The caller must own a Student row in the resolved tenant. Holding
   *           the STUDENT role is necessary (checked by the route guard) but not
   *           sufficient — a role assignment with no student record behind it is
   *           refused with 403 rather than answered with a matrix describing a
   *           student who does not exist.
   *
   *           The refusal is 403 FORBIDDEN and not 404, and the message is the
   *           same one Phase 18 uses. Distinguishing "you are not a student"
   *           from "no such student" would tell a caller something about a
   *           record they are not entitled to know exists.
   *
   * REPORTS : The matrix exactly as the constant declares it, plus the resolved
   *           subject. Nothing is filtered by status, by tenant configuration or
   *           by anything else — see the DTO for why a non-ACTIVE student still
   *           receives the full matrix.
   *
   * COMPLEXITY : one statement, a lookup on Student.userId.
   */
  async getPermissions(tenantId: string, userId: string): Promise<StudentPermissionsDto> {
    const student = await this.subjects.findSubject(tenantId, userId);

    if (!student) {
      throw new AppError(
        STUDENT_PERMISSION_MESSAGE.FORBIDDEN,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.FORBIDDEN
      );
    }

    return toStudentPermissionsDto(student, ROLES.STUDENT);
  }
}

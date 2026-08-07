// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Permission System (Phase 21)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no DTO reshaping.
//
// THE COMPOSITION ROOT
//   The single place StudentPermissionService is wired to its one port. The
//   route shares this instance, so it cannot construct a differently-wired one.
//
// THE ADAPTER BELOW READS AND DECIDES NOTHING
//   It returns the caller's Student row or null. That a null means FORBIDDEN
//   rather than "empty matrix" is the SERVICE's rule, not a branch taken here —
//   an adapter that threw would be a business decision hiding in a data-access
//   shim.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import {
  StudentPermissionService,
  type StudentPermissionSubjectPort,
} from "@/lib/services/studentPermission.service";
import type { StudentPermissionsDto } from "@/lib/dto/studentPermission.dto";

/**
 * Resolves a signed-in user to the Student they ARE.
 *
 * Scoped by tenant as well as user, so a session carried into the wrong tenant
 * resolves to nothing rather than to a student — the same predicate Phase 18's
 * repository uses, restated because the projection differs: this module needs
 * enrollmentNo and status, which findStudentByUserId does not select.
 */
const subjectPort: StudentPermissionSubjectPort = {
  async findSubject(tenantId, userId) {
    return prisma.student.findFirst({
      where: { userId, tenantId },
      select: { id: true, enrollmentNo: true, status: true },
    });
  },
};

/** The single wired instance the route delegates to. */
const studentPermissionService = new StudentPermissionService(subjectPort);

export class StudentPermissionController {
  /** GET /api/student/permissions */
  async getPermissions(tenantId: string, userId: string): Promise<StudentPermissionsDto> {
    return studentPermissionService.getPermissions(tenantId, userId);
  }
}

export const studentPermissionController = new StudentPermissionController();

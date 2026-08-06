// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Profile Portal
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping, no Prisma, no
//     calculation. Profile completion is arithmetic and lives in the service.
//
// THE COMPOSITION ROOT
//   This is the single place StudentProfileService is wired to its repository
//   and to the three services it composes. Every route in this module shares
//   one instance, so no route can construct a differently-wired one — and the
//   three collaborators are supplied as NARROW PORTS, so the profile module
//   cannot reach anything on them beyond the one method each it declared.
//
// WHY `now` IS A PARAMETER AND NOT A CLOCK READ
//   Certificate expiry and the dashboard's active-certificate count are both
//   evaluated against an instant. Taking that instant ONCE per request and
//   passing it down means every figure in one response agrees; reading the
//   clock separately in the service, the mapper and the repository would let a
//   certificate expiring this millisecond be active in one field and expired in
//   another. The controller is the outermost layer that still belongs to this
//   module, so it is where the instant is taken.
// ============================================================================

import { studentProfileRepository } from "@/lib/repositories/studentProfile.repository";
import { resultRepository } from "@/lib/repositories/result.repository";
import { studentFinanceRepository } from "@/lib/repositories/studentFinance.repository";
import { attendanceAnalyticsService } from "@/lib/services/attendanceAnalytics.service";
import { ResultService } from "@/lib/services/result.service";
import { StudentFinanceService } from "@/lib/services/studentFinance.service";
import { StudentProfileService } from "@/lib/services/studentProfile.service";
import type {
  AchievementDto,
  StudentDashboardDto,
  StudentProfileDto,
} from "@/lib/dto/studentProfile.dto";
import type {
  AchievementQuery,
  DashboardQuery,
} from "@/lib/validations/studentProfile.validation";

/** The single wired instance every route handler in this module delegates to. */
const studentProfileService = new StudentProfileService(
  studentProfileRepository,
  new ResultService(resultRepository),
  attendanceAnalyticsService,
  new StudentFinanceService(studentFinanceRepository)
);

export class StudentProfileController {
  /** GET /api/student/profile */
  async getProfile(tenantId: string, userId: string, now: Date): Promise<StudentProfileDto> {
    return studentProfileService.getProfile(tenantId, userId, now);
  }

  /** GET /api/student/dashboard */
  async getDashboard(
    tenantId: string,
    userId: string,
    query: DashboardQuery,
    now: Date
  ): Promise<StudentDashboardDto> {
    return studentProfileService.getDashboard(tenantId, userId, query, now);
  }

  /** GET /api/student/achievements */
  async getAchievements(
    tenantId: string,
    userId: string,
    query: AchievementQuery
  ): Promise<readonly AchievementDto[]> {
    return studentProfileService.getAchievements(tenantId, userId, query);
  }
}

export const studentProfileController = new StudentProfileController();

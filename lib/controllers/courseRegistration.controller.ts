// ============================================================================
// OWNER      : Gauransh
// MODULE     : Course Registration
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates to the
//              service.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping.
//
// COMPOSITION ROOT
//   Binds the concrete repositories to the service's three ports. The
//   EvaluationScheme repository is passed whole and narrowed by the
//   constructor to a single read method, so enrolment handling can verify that
//   a regulation is ACTIVE and provably cannot alter one.
// ============================================================================

import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { courseRegistrationRepository } from "@/lib/repositories/courseRegistration.repository";
import { evaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";
import { CourseRegistrationService } from "@/lib/services/courseRegistration.service";
import type {
  BulkRegistrationResultDTO,
  CourseRegistrationDTO,
  CourseRegistrationListDTO,
} from "@/lib/dto/courseRegistration.dto";
import type {
  BulkCourseRegistrationInput,
  CreateCourseRegistrationInput,
  ListCourseRegistrationsQuery,
  UpdateCourseRegistrationInput,
} from "@/lib/validations/courseRegistration";
import type { RequestContext } from "@/lib/utils/request-context";

/** The single wired instance every route handler in this module delegates to. */
const courseRegistrationService = new CourseRegistrationService(
  courseRegistrationRepository,
  auditLogRepository,
  evaluationSchemeRepository
);

export class CourseRegistrationController {
  /** GET /api/course-registrations */
  async list(
    tenantId: string,
    query: ListCourseRegistrationsQuery,
    departmentId: string | null = null
  ): Promise<CourseRegistrationListDTO> {
    return courseRegistrationService.list(tenantId, query, departmentId);
  }

  /** GET /api/course-registrations/[id] */
  async getById(
    tenantId: string,
    id: string,
    departmentId: string | null = null
  ): Promise<CourseRegistrationDTO> {
    return courseRegistrationService.getById(tenantId, id, departmentId);
  }

  /** POST /api/course-registrations */
  async register(
    tenantId: string,
    input: CreateCourseRegistrationInput,
    context: RequestContext
  ): Promise<CourseRegistrationDTO> {
    return courseRegistrationService.register(tenantId, input, context);
  }

  /** POST /api/course-registrations/bulk */
  async registerBulk(
    tenantId: string,
    input: BulkCourseRegistrationInput,
    context: RequestContext
  ): Promise<BulkRegistrationResultDTO> {
    return courseRegistrationService.registerBulk(tenantId, input, context);
  }

  /** PATCH /api/course-registrations/[id] */
  async update(
    tenantId: string,
    id: string,
    input: UpdateCourseRegistrationInput,
    context: RequestContext
  ): Promise<CourseRegistrationDTO> {
    return courseRegistrationService.update(tenantId, id, input, context);
  }
}

export const courseRegistrationController = new CourseRegistrationController();

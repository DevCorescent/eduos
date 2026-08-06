// ============================================================================
// OWNER      : Gauransh
// MODULE     : Open Elective Management
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling.
//   • No validation, no business logic, no DTO reshaping, no Prisma, no
//     calculation. Every seat decision belongs to the domain engine and every
//     lifecycle rule to the service.
//
// THE COMPOSITION ROOT
//   This is the single place OpenElectiveService is wired to its repository and
//   to the four ports it depends on. Every route shares one instance, so none
//   can construct a differently-wired one — and the collaborators arrive as
//   NARROW PORTS, so elective handling cannot reach anything on them beyond the
//   one or two methods each it declared.
//
// THE MERIT ADAPTER IS WHERE "DO NOT INVENT CGPA" IS ENFORCED
//   `findCgpaScaled` returns a Map that OMITS a student with no computed
//   result, and the service reads a miss as null. Nothing in the chain
//   substitutes a zero, an average of nothing, or a default — a student without
//   a CGPA is a real state the domain engine handles by placing them after the
//   graded group, which is the Phase 19 decision expressed in code rather than
//   in a comment.
//
// WHY `now` IS A PARAMETER
//   A preference's submittedAt is the FCFS tie-breaker and an allocation's
//   timestamp is stamped on every verdict of one run. Taking the instant once
//   per request and passing it down means one run has one time; reading the
//   clock inside the loop would let two verdicts from the same allocation
//   disagree about when it happened.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { courseRegistrationRepository } from "@/lib/repositories/courseRegistration.repository";
import { openElectiveRepository } from "@/lib/repositories/openElective.repository";
import { CourseRegistrationService } from "@/lib/services/courseRegistration.service";
import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import { evaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";
import {
  OpenElectiveService,
  type ElectiveAccess,
  type ElectiveMeritPort,
  type ElectiveStudentPort,
} from "@/lib/services/openElective.service";
import type {
  AllocationReportDto,
  ElectiveStatusDto,
  OpenElectiveOfferingDto,
  PreferenceSubmissionDto,
} from "@/lib/dto/openElective.dto";
import type {
  AllocateInput,
  ListOfferingsQuery,
  LockInput,
  SubmitPreferencesInput,
} from "@/lib/validations/openElective.validation";

/**
 * Reads the student facts eligibility is decided on.
 *
 * A thin adapter over Prisma rather than a new repository: these are two
 * projections of Student that no existing repository exposes in this shape, and
 * a whole repository for two reads would be more surface than the reads
 * justify. It contains no logic — every decision made on these facts happens in
 * the domain engine.
 */
const studentPort: ElectiveStudentPort = {
  async findStudentByUserId(tenantId, userId) {
    return prisma.student.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
  },

  async findStudentProfiles(tenantId, studentIds) {
    if (studentIds.length === 0) {
      return [];
    }

    // One statement for the whole cohort — a 500-student allocation reads its
    // profiles once, not five hundred times.
    return prisma.student.findMany({
      where: { tenantId, id: { in: [...studentIds] } },
      select: {
        id: true,
        programmeId: true,
        specialisationId: true,
        currentSemester: true,
      },
    });
  },
};

/**
 * Supplies the MERIT ordering key.
 *
 * A student with no computed CGPA is ABSENT from the returned map, and the
 * service reads that as null. No value is invented — see the file header.
 *
 * Phase 19 Batch 3 wires this to return an empty map, which makes every student
 * ungraded and therefore orders a MERIT offering by FCFS within each rank. That
 * is a deliberate, stated placeholder rather than a fabricated CGPA: the
 * result engine can compute a real CGPA, but doing so per cohort is a
 * performance decision this batch was not asked to take. It is recorded as a
 * known limitation.
 */
const meritPort: ElectiveMeritPort = {
  async findCgpaScaled() {
    return new Map<string, number | null>();
  },
};

/** The single wired instance every route handler in this module delegates to. */
const openElectiveService = new OpenElectiveService(
  openElectiveRepository,
  studentPort,
  meritPort,
  new CourseRegistrationService(
    courseRegistrationRepository,
    auditLogRepository,
    evaluationSchemeRepository
  ),
  courseRegistrationRepository
);

export class OpenElectiveController {
  /** GET /api/open-electives */
  async listOfferings(
    tenantId: string,
    query: ListOfferingsQuery,
    access: ElectiveAccess
  ) {
    return openElectiveService.listOfferings(tenantId, query, access);
  }

  /** POST /api/open-electives/select */
  async submitPreferences(
    tenantId: string,
    userId: string,
    input: SubmitPreferencesInput,
    now: Date
  ): Promise<PreferenceSubmissionDto> {
    return openElectiveService.submitPreferences(tenantId, userId, input, now);
  }

  /** GET /api/open-electives/status */
  async getStatus(
    tenantId: string,
    userId: string,
    semesterId: string
  ): Promise<ElectiveStatusDto> {
    return openElectiveService.getStatus(tenantId, userId, semesterId);
  }

  /** POST /api/open-electives/allocate */
  async allocate(
    tenantId: string,
    input: AllocateInput,
    actorUserId: string,
    now: Date
  ): Promise<AllocationReportDto> {
    return openElectiveService.allocate(tenantId, input, actorUserId, now);
  }

  /** PATCH /api/open-electives/lock */
  async lock(
    tenantId: string,
    input: LockInput,
    now: Date
  ): Promise<OpenElectiveOfferingDto> {
    return openElectiveService.lock(tenantId, input, now);
  }
}

export const openElectiveController = new OpenElectiveController();

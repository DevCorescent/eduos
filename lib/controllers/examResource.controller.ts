// ============================================================================
// OWNER      : Gauransh
// MODULE     : Question Paper & Solution Repository (Phase 26)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no visibility arithmetic, no Prisma.
//
// THE COMPOSITION ROOT
//   The single place ExamResourceService is wired to its repository and the
//   shared audit-log repository. All ten Phase 26 routes share this instance,
//   so the staff surface and the student surface provably apply the same
//   visibility rule.
// ============================================================================

import { examResourceRepository } from "@/lib/repositories/examResource.repository";
import { auditLogRepository } from "@/lib/repositories/auditLog.repository";
import {
  ExamResourceService,
  type ExamResourceAccess,
} from "@/lib/services/examResource.service";
import type {
  ExamResourceDownloadDto,
  ExamResourceDto,
  ExamResourcePageDto,
  StudentExamResourceDto,
} from "@/lib/dto/examResource.dto";
import type {
  ArchiveExamResourceInput,
  CreateExamResourceInput,
  ExamResourceListQuery,
  PublishExamResourceInput,
  StudentExamResourceQuery,
  UpdateExamResourceInput,
} from "@/lib/validations/examResource.validation";

/** The single wired instance every Phase 26 route delegates to. */
const examResourceService = new ExamResourceService(
  examResourceRepository,
  auditLogRepository
);

export class ExamResourceController {
  /** POST /api/exam-resources */
  async create(
    access: ExamResourceAccess,
    input: CreateExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    return examResourceService.create(access, input, now);
  }

  /** GET /api/exam-resources */
  async list(
    access: ExamResourceAccess,
    query: ExamResourceListQuery,
    now: Date
  ): Promise<ExamResourcePageDto<ExamResourceDto>> {
    return examResourceService.list(access, query, now);
  }

  /** GET /api/exam-resources/[id] */
  async getById(
    access: ExamResourceAccess,
    id: string,
    now: Date
  ): Promise<ExamResourceDto> {
    return examResourceService.getById(access, id, now);
  }

  /** PATCH /api/exam-resources/[id] */
  async update(
    access: ExamResourceAccess,
    id: string,
    input: UpdateExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    return examResourceService.update(access, id, input, now);
  }

  /** DELETE /api/exam-resources/[id] */
  async remove(access: ExamResourceAccess, id: string): Promise<void> {
    return examResourceService.remove(access, id);
  }

  /** PATCH /api/exam-resources/[id]/publish */
  async publish(
    access: ExamResourceAccess,
    id: string,
    input: PublishExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    return examResourceService.publish(access, id, input, now);
  }

  /** PATCH /api/exam-resources/[id]/archive */
  async archive(
    access: ExamResourceAccess,
    id: string,
    input: ArchiveExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    return examResourceService.archive(access, id, input, now);
  }

  /** GET /api/students/me/exam-resources */
  async listForStudent(
    tenantId: string,
    userId: string,
    query: StudentExamResourceQuery,
    now: Date
  ): Promise<ExamResourcePageDto<StudentExamResourceDto>> {
    return examResourceService.listForStudent(tenantId, userId, query, now);
  }

  /** GET /api/students/me/exam-resources/[id] */
  async getForStudent(
    tenantId: string,
    userId: string,
    id: string,
    now: Date
  ): Promise<StudentExamResourceDto> {
    return examResourceService.getForStudent(tenantId, userId, id, now);
  }

  /** GET /api/students/me/exam-resources/[id]/download */
  async downloadForStudent(
    tenantId: string,
    userId: string,
    id: string,
    now: Date
  ): Promise<ExamResourceDownloadDto> {
    return examResourceService.downloadForStudent(tenantId, userId, id, now);
  }
}

export const examResourceController = new ExamResourceController();

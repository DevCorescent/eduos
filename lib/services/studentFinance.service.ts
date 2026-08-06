// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Finance — Read Layer
// LAYER      : Service
// PURPOSE    : Resolve a caller to the Student row they own, then compose the
//              repository's reads into the DTO shapes the five finance-portal
//              routes return. No calculation happens here beyond pagination
//              arithmetic — the DTO mappers already carry every money and date
//              conversion, and the repository already carries every predicate.
//
// SELF-SERVICE ONLY — SEE lib/constants/studentFinance.ts
//   Every method takes (tenantId, userId, ...) and never a caller-supplied
//   studentId. The Student row is resolved from userId, once, by
//   resolveOwnStudent(), and every repository call after that uses the
//   RESOLVED id — a caller-supplied id is never in play because no route in
//   this module accepts one. A permitted role with no Student row is
//   FORBIDDEN, not served an empty page: see resolveOwnStudent().
//
// A RECEIPT THAT DOES NOT RESOLVE IS NOT FOUND, NEVER FORBIDDEN
//   findReceiptById/findReceiptDownload already fold tenantId AND the resolved
//   studentId into the query (studentFinance.repository.ts). A receipt that
//   belongs to another student and one that does not exist are therefore
//   indistinguishable at the database layer, and this service preserves that:
//   both become RECEIPT_NOT_FOUND. Nothing here discloses that a receipt
//   belonging to someone else exists.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE } from "@/lib/constants/errors";
import { STUDENT_FINANCE_MESSAGE } from "@/lib/constants/studentFinance";
import type {
  PaymentHistoryFilters,
  PendingFeeFilters,
  ReceiptListFilters,
  ScholarshipFilters,
  StudentFinanceRepository,
} from "@/lib/repositories/studentFinance.repository";
import {
  toFineSummaryDto,
  toPaymentHistoryDto,
  toPendingFeeDto,
  toReceiptDetailDto,
  toReceiptDownloadDto,
  toReceiptSummaryDto,
  toScholarshipDto,
  type FineSummaryDto,
  type PaymentHistoryDto,
  type PendingFeeDto,
  type ReceiptDetailDto,
  type ReceiptDownloadDto,
  type ReceiptSummaryDto,
  type ScholarshipDto,
} from "@/lib/dto/studentFinance.dto";

/** The pagination block every list response carries, computed once here. */
export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PaymentHistoryResult {
  readonly payments: readonly PaymentHistoryDto[];
  readonly pagination: PaginationMeta;
}

export interface ReceiptListResult {
  readonly receipts: readonly ReceiptSummaryDto[];
  readonly pagination: PaginationMeta;
}

/**
 * The pending-fees response.
 *
 * Bundles three repository reads behind the one route README Phase 17 defines
 * — GET /api/fees/pending — rather than inventing three additional routes for
 * "Scholarship Summary" and "Fine Summary". Both are listed in README as
 * FEATURES of the finance portal, not as separate endpoints, and a student's
 * financial position is naturally one page: what they owe, what has been
 * waived, and what is overdue.
 */
export interface PendingFeesResult {
  readonly demands: readonly PendingFeeDto[];
  readonly pagination: PaginationMeta;
  readonly scholarships: readonly ScholarshipDto[];
  readonly fineSummary: FineSummaryDto;
}

function paginationOf(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export class StudentFinanceService {
  /**
   * The service depends on a REPOSITORY TYPE, not on Prisma and not on the
   * singleton instance — matching result.service.ts's constructor-injection
   * pattern rather than the module-singleton style attendanceAnalytics.service
   * uses. That is what makes this class unit-testable with a fake repository
   * and no database, and the controller (this module's composition root)
   * wires the real singleton in exactly once.
   */
  constructor(private readonly repository: StudentFinanceRepository) {}

  /**
   * One student's payment history, paged.
   *
   * COST: resolveOwnStudent (one statement) + findPaymentHistory (two) = three.
   */
  async getPaymentHistory(
    tenantId: string,
    userId: string,
    query: PaymentHistoryFilters
  ): Promise<PaymentHistoryResult> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const { rows, total } = await this.repository.findPaymentHistory(
      tenantId,
      studentId,
      query
    );

    return {
      payments: rows.map(toPaymentHistoryDto),
      pagination: paginationOf(query.page, query.limit, total),
    };
  }

  /**
   * One student's receipts (SUCCEEDED payments only), paged.
   *
   * COST: resolveOwnStudent (one) + findReceipts (two) = three.
   */
  async getReceipts(
    tenantId: string,
    userId: string,
    query: ReceiptListFilters
  ): Promise<ReceiptListResult> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const { rows, total } = await this.repository.findReceipts(
      tenantId,
      studentId,
      query
    );

    return {
      receipts: rows.map(toReceiptSummaryDto),
      pagination: paginationOf(query.page, query.limit, total),
    };
  }

  /**
   * One receipt, with the demand it settled.
   *
   * COST: resolveOwnStudent (one) + findReceiptById (one) = two.
   */
  async getReceiptDetail(
    tenantId: string,
    userId: string,
    receiptId: string
  ): Promise<ReceiptDetailDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const row = await this.repository.findReceiptById(tenantId, studentId, receiptId);

    if (row === null) {
      throw new AppError(STUDENT_FINANCE_MESSAGE.RECEIPT_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    return toReceiptDetailDto(row);
  }

  /**
   * Everything a printable receipt renders from — the demand, its fee lines,
   * and the fee structure they belong to.
   *
   * Returns DATA, not a rendered artifact: producing a PDF or an HTML view is
   * a route/presentation concern, and nothing in the schema stores a receipt
   * file to fetch. See studentFinance.repository.ts's findReceiptDownload.
   *
   * COST: resolveOwnStudent (one) + findReceiptDownload (one) = two.
   */
  async getReceiptDownload(
    tenantId: string,
    userId: string,
    receiptId: string
  ): Promise<ReceiptDownloadDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const row = await this.repository.findReceiptDownload(
      tenantId,
      studentId,
      receiptId
    );

    if (row === null) {
      throw new AppError(STUDENT_FINANCE_MESSAGE.RECEIPT_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    return toReceiptDownloadDto(row);
  }

  /**
   * A student's full financial position: outstanding demands (paged),
   * concessions granted, and overdue liability — see PendingFeesResult.
   *
   * `scholarshipFilters` narrows only the concession list, matching
   * ScholarshipFilters's own scope — the demand page and the fine summary have
   * no equivalent optional narrowing in README's brief and are not given one
   * here.
   *
   * COST: resolveOwnStudent (one) + findPendingFees (two) + findScholarships
   *       (one) + findFineSummary (two) = six, fixed regardless of how many
   *       demands the student has.
   */
  async getPendingFees(
    tenantId: string,
    userId: string,
    query: PendingFeeFilters,
    scholarshipFilters: ScholarshipFilters = {}
  ): Promise<PendingFeesResult> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const [demandsPage, scholarships, fineSummary] = await Promise.all([
      this.repository.findPendingFees(tenantId, studentId, query),
      this.repository.findScholarships(tenantId, studentId, scholarshipFilters),
      this.repository.findFineSummary(tenantId, studentId),
    ]);

    return {
      demands: demandsPage.rows.map(toPendingFeeDto),
      pagination: paginationOf(query.page, query.limit, demandsPage.total),
      scholarships: scholarships.map(toScholarshipDto),
      fineSummary: toFineSummaryDto(fineSummary),
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  /**
   * Resolve the caller to the Student row they own.
   *
   * Every public method above calls this FIRST and uses only the id it
   * returns — a caller-supplied studentId is never accepted anywhere in this
   * service, because no route in this module has one to accept (see the file
   * header). A caller holding a permitted role (STUDENT or UNIVERSITY_ADMIN)
   * but no Student row in this tenant is FORBIDDEN rather than served an empty
   * ledger, matching the convention result.service.ts's requireStudent()
   * already established for the identical situation.
   */
  private async resolveOwnStudent(tenantId: string, userId: string): Promise<string> {
    const own = await this.repository.findStudentByUserId(tenantId, userId);

    if (own === null) {
      throw new AppError(STUDENT_FINANCE_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    return own.id;
  }
}
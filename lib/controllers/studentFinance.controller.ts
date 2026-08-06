// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Finance — Read Layer
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates to the
//              service. No auth, no request/response handling, no business
//              logic.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • Auth/tenant resolution and param/query validation stay in the route.
//   • Error handling (AppError -> HTTP response) stays in the route.
//   • Business logic and DTO composition stay in the service.
//
// COMPOSITION ROOT
//   The service takes its repository by constructor injection so it can be
//   unit-tested against a fake with no database (see studentFinance.service.
//   test.ts). This controller is the one place the real singleton repository
//   is bound to it, so every route in this module shares one wired instance.
// ============================================================================

import { studentFinanceRepository } from "@/lib/repositories/studentFinance.repository";
import { StudentFinanceService } from "@/lib/services/studentFinance.service";
import type {
  PaymentHistoryFilters,
  PendingFeeFilters,
  ReceiptListFilters,
  ScholarshipFilters,
} from "@/lib/repositories/studentFinance.repository";

/** The single wired instance every route handler in this module delegates to. */
const studentFinanceService = new StudentFinanceService(studentFinanceRepository);

export class StudentFinanceController {
  /** GET /api/fees/history */
  async getPaymentHistory(tenantId: string, userId: string, query: PaymentHistoryFilters) {
    return studentFinanceService.getPaymentHistory(tenantId, userId, query);
  }

  /** GET /api/fees/receipts */
  async getReceipts(tenantId: string, userId: string, query: ReceiptListFilters) {
    return studentFinanceService.getReceipts(tenantId, userId, query);
  }

  /** GET /api/fees/receipt/[receiptId] */
  async getReceiptDetail(tenantId: string, userId: string, receiptId: string) {
    return studentFinanceService.getReceiptDetail(tenantId, userId, receiptId);
  }

  /** GET /api/fees/download/[receiptId] */
  async getReceiptDownload(tenantId: string, userId: string, receiptId: string) {
    return studentFinanceService.getReceiptDownload(tenantId, userId, receiptId);
  }

  /** GET /api/fees/pending */
  async getPendingFees(
    tenantId: string,
    userId: string,
    query: PendingFeeFilters,
    scholarshipFilters?: ScholarshipFilters
  ) {
    return studentFinanceService.getPendingFees(tenantId, userId, query, scholarshipFilters);
  }
}

export const studentFinanceController = new StudentFinanceController();
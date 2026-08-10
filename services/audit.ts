// ============================================================================
// MODULE : Services — Audit Log (WP-2, PRD §47)
// PURPOSE: Read the audit trail. There is no write here, and there is no write
//          endpoint to call: audit records are produced server-side inside the
//          transaction of the change they describe.
// ============================================================================

import type { ApiResponse, ListParams, PaginatedResult } from "@/types";
import type { AuditStatus } from "@/app/generated/prisma/enums";
import { apiRequest } from "./client";

/** What the LIST returns — snapshots are omitted; see the route header. */
export interface AuditEntryRow {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userId: string | null;
  status: AuditStatus;
  correlationId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

/** One entry read in full, including the sensitive snapshots. */
export interface AuditEntryDetail extends AuditEntryRow {
  before: unknown;
  after: unknown;
  userAgent: string | null;
}

/**
 * Filters GET /api/audit-logs genuinely applies.
 *
 * Each maps to a WHERE clause. There is no free-text search because `before`
 * and `after` are Json columns Postgres cannot index for substring search at
 * this scale — so the UI offers no search box rather than one that does
 * nothing.
 */
export interface AuditFilters extends ListParams {
  action?: string;
  resource?: string;
  resourceId?: string;
  status?: AuditStatus;
  userId?: string;
  /** YYYY-MM-DD. Inclusive of the whole end day — the route advances it. */
  from?: string;
  to?: string;
}

export async function listAuditLogs(
  filters: AuditFilters = {}
): Promise<ApiResponse<PaginatedResult<AuditEntryRow>>> {
  const result = await apiRequest<{
    entries: AuditEntryRow[];
    pagination: PaginatedResult<AuditEntryRow>["pagination"];
  }>("/api/audit-logs", { params: filters });

  if (!result.success) return result;

  return {
    success: true,
    data: { items: result.data.entries, pagination: result.data.pagination },
  };
}

export async function getAuditLog(id: string): Promise<ApiResponse<AuditEntryDetail>> {
  return apiRequest<AuditEntryDetail>(`/api/audit-logs/${id}`);
}

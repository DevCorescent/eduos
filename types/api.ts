// ============================================================================
// MODULE : Shared Types — API Transport
// PURPOSE: The pagination contract and the list-envelope shapes that sit
//          between the routes under app/api and the service layer.
//
//          The success envelope itself (ApiResponse, ok, fail) lives in
//          types/index.ts and is NOT redefined here — that module is imported
//          by every backend route, so it stays the single definition.
// ============================================================================

import type { ApiResponse } from "./index";

/** Page metadata returned by every collection endpoint. */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * The raw `data` object a collection endpoint returns.
 *
 * The rows sit under a key named for the entity — `students`, `tenants`,
 * `campuses` — rather than a generic `items`, so the key is a type parameter
 * here. This models the backend exactly as written; the service layer is what
 * normalises it to PaginatedResult, so no page ever has to know the key.
 *
 * @example ListEnvelope<"students", Student>
 *          // -> { students: Student[]; pagination: Pagination }
 */
export type ListEnvelope<K extends string, T> = {
  [P in K]: T[];
} & { pagination: Pagination };

/**
 * The normalised page of rows the service layer hands to the UI.
 *
 * Collapsing every entity key to `items` is what lets one <DataTable> and one
 * <Pagination> serve all thirty-odd list screens. The un-normalised key stays
 * confined to the service that knows it.
 */
export interface PaginatedResult<T> {
  items: T[];
  pagination: Pagination;
}

/** Query params accepted by every collection endpoint. */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

/**
 * Search and filter params applied on top of pagination.
 *
 * `q` and the filter keys are honoured by the mock layer today. No backend
 * collection endpoint implements search yet — every route's VALIDATION note
 * says so explicitly — so the live client sends them and the backend ignores
 * them until those params are added. Nothing breaks either way: an unknown
 * search param is dropped by Zod's object parsing, not rejected.
 */
export interface ListParams extends PaginationParams {
  q?: string;
  [filter: string]: string | number | boolean | undefined;
}

/** Convenience alias: the envelope wrapping a normalised page of rows. */
export type PaginatedResponse<T> = ApiResponse<PaginatedResult<T>>;

/** The error codes the backend emits in `fail(error, code)`. */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TENANT_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";

/** An empty page — the shape a list service returns when a fetch fails. */
export function emptyPage<T>(params?: PaginationParams): PaginatedResult<T> {
  return {
    items: [],
    pagination: {
      page: params?.page ?? 1,
      limit: params?.limit ?? 20,
      total: 0,
      totalPages: 0,
    },
  };
}

/**
 * The largest `limit` any collection endpoint accepts.
 *
 * Mirrors MAX_PAGE_SIZE in lib/validations/pagination.ts, which every route's
 * query schema enforces with `.max()`. Asking for more is not clamped — it is a
 * 400 VALIDATION_ERROR, and the screen renders an error for a request that
 * looked reasonable.
 *
 * Named here so a caller wanting "as much as one page allows" can say so
 * instead of writing a number that silently becomes wrong if the ceiling moves.
 */
export const MAX_LIST_LIMIT = 100;

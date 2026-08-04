// ============================================================================
// MODULE : Mock — Fixture Helpers
// PURPOSE: Turns a plain in-memory array into something that behaves like a
//          real collection endpoint: latency, search, filtering and paging.
//
//          Every mock service shares these so all thirty-odd list screens are
//          exercised against identical semantics. The point is not the data —
//          it is that a page written against the mock needs no change when the
//          live client replaces it.
// ============================================================================

import type { ApiResponse } from "@/types";
import type { ListParams, PaginatedResult, Pagination } from "@/types/api";
import { MOCK_LATENCY_MS } from "@/services/config";

/** Resolve after the configured mock latency, so loading states stay visible. */
export function delay(ms: number = MOCK_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wrap a value in the success envelope, after simulated latency. */
export async function mockOk<T>(data: T, message?: string): Promise<ApiResponse<T>> {
  await delay();
  return { success: true, data, message };
}

/** Wrap an error in the failure envelope, after simulated latency. */
export async function mockFail<T = never>(
  error: string,
  code = "NOT_FOUND"
): Promise<ApiResponse<T>> {
  await delay();
  return { success: false, error, code };
}

/**
 * Case-insensitive substring match across the named fields of a row.
 *
 * Fields are read through a Record cast because the caller supplies them as
 * plain keys of T; non-string values are skipped rather than stringified, so a
 * search for "2" cannot accidentally match an id or a credit count.
 */
export function matchesQuery<T>(row: T, query: string, fields: (keyof T)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return fields.some((field) => {
    const value = (row as Record<keyof T, unknown>)[field];
    return typeof value === "string" && value.toLowerCase().includes(needle);
  });
}

/**
 * Apply exact-match filters drawn from list params.
 *
 * INPUT   : the row, the params object, and the params keys that map to fields
 *           of the same name on T (e.g. "status", "programmeId").
 * RULES   : a key absent from params, or set to "" or "all", is not a filter —
 *           those are what an untouched or explicitly-cleared <Select> sends,
 *           and must widen the result rather than narrow it to nothing.
 */
export function matchesFilters<T>(
  row: T,
  params: ListParams | undefined,
  keys: (keyof T & string)[]
): boolean {
  if (!params) return true;

  return keys.every((key) => {
    const wanted = params[key];
    if (wanted === undefined || wanted === "" || wanted === "all") return true;
    return String((row as Record<string, unknown>)[key]) === String(wanted);
  });
}

/** Build the page metadata for a result set of `total` rows. */
export function buildPagination(total: number, page: number, limit: number): Pagination {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/**
 * Slice one page out of an already-filtered array.
 *
 * The page is clamped into range rather than trusted. A caller can arrive with
 * ?page=99 from a stale link or a hand-edited URL; returning the last page
 * beats returning an empty table that looks like "no results".
 */
export function paginate<T>(rows: T[], params?: ListParams): PaginatedResult<T> {
  const limit = Math.max(1, Number(params?.limit) || 20);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number(params?.page) || 1), totalPages);
  const start = (page - 1) * limit;

  return {
    items: rows.slice(start, start + limit),
    pagination: buildPagination(total, page, limit),
  };
}

/**
 * The full mock list pipeline: search → filter → sort → paginate → envelope.
 *
 * @example
 * return mockList(STUDENTS, params, {
 *   searchFields: ["enrollmentNo"],
 *   filterKeys: ["status", "batchId"],
 * })
 */
export async function mockList<T>(
  rows: T[],
  params: ListParams | undefined,
  options: {
    searchFields?: (keyof T)[];
    filterKeys?: (keyof T & string)[];
    /** Applied after filtering, before paging. */
    sort?: (a: T, b: T) => number;
  } = {}
): Promise<ApiResponse<PaginatedResult<T>>> {
  const { searchFields = [], filterKeys = [], sort } = options;
  const query = typeof params?.q === "string" ? params.q : "";

  let result = rows.filter(
    (row) =>
      (searchFields.length === 0 || matchesQuery(row, query, searchFields)) &&
      matchesFilters(row, params, filterKeys)
  );

  // Copied before sorting — sort() mutates in place, and `rows` is the shared
  // fixture array that every other call reads.
  if (sort) result = [...result].sort(sort);

  return mockOk(paginate(result, params));
}

/**
 * Deterministic pseudo-random number in [0, 1) from a string seed.
 *
 * Fixtures are generated at module load. Math.random() would reshuffle them on
 * every server render, so a row could change between the page's fetch and a
 * subsequent one — and any screenshot or test would be unreproducible. This
 * (an FNV-1a hash scaled to a unit interval) gives stable values per seed.
 */
export function seededRandom(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/** Pick a deterministic element of `options`, keyed by `seed`. */
export function seededPick<T>(options: readonly T[], seed: string): T {
  return options[Math.floor(seededRandom(seed) * options.length)];
}

/** Deterministic integer in [min, max]. */
export function seededInt(min: number, max: number, seed: string): number {
  return min + Math.floor(seededRandom(seed) * (max - min + 1));
}

/**
 * An ISO timestamp `daysAgo` days before the fixed reference date.
 *
 * Anchored to a constant rather than Date.now() for the same reason as
 * seededRandom: a fixture built from the current time changes on every render,
 * which makes "created 3 days ago" drift and defeats reproducibility.
 */
const FIXTURE_EPOCH = Date.UTC(2026, 6, 1); // 2026-07-01

export function daysAgo(days: number): string {
  return new Date(FIXTURE_EPOCH - days * 86_400_000).toISOString();
}

export function daysAhead(days: number): string {
  return new Date(FIXTURE_EPOCH + days * 86_400_000).toISOString();
}

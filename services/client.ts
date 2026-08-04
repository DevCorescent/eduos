// ============================================================================
// MODULE : Services — HTTP Client
// PURPOSE: The only place in the frontend that calls fetch(). Every service
//          goes through it, so retry, auth-redirect and error-shaping policy
//          have exactly one implementation.
//
//          The client never throws. Routes already answer in the
//          { success, data, error } envelope, and a network failure or a
//          non-JSON body is turned into the same failure envelope here. That
//          means a caller handles one shape for every outcome — transport
//          errors included — and a page can never crash on an unhandled
//          rejection from a data fetch.
// ============================================================================

import type { ApiResponse } from "@/types";
import { fail } from "@/types";
import type { ApiErrorCode, ListEnvelope, ListParams, PaginatedResult } from "@/types/api";
import { API_BASE_URL } from "./config";

/** HTTP verbs the API exposes. */
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  method?: Method;
  /** Serialized as a JSON body. Omit for GET and DELETE. */
  body?: unknown;
  /** Appended as a query string; undefined and empty-string values are dropped. */
  params?: ListParams;
  /**
   * Next.js caching mode. Defaults to "no-store" — every endpoint here is
   * tenant-scoped and session-dependent, so a cached response could serve one
   * tenant's rows to another.
   */
  cache?: RequestCache;
  /** Cache tags for on-demand revalidation, once mutations move to Server Actions. */
  tags?: string[];
}

/**
 * Build a query string, dropping empty params.
 *
 * `undefined` and `""` are skipped rather than sent: `?q=` reads as "search for
 * the empty string" to a backend that supports search, which is not what an
 * untouched search box means.
 */
function buildQuery(params?: ListParams): string {
  if (!params) return "";

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}

/** Map a transport/HTTP failure onto the same code vocabulary the routes use. */
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    default:
      return "SERVER_ERROR";
  }
}

/**
 * Issue one request and return the envelope.
 *
 * INPUT   : an API path beginning with "/api", plus method/body/params.
 * RETURNS : the route's own { success, data } on success. On any failure —
 *           HTTP error, malformed JSON, DNS failure, abort — a
 *           { success: false, error, code } built here.
 *
 * @example
 * const res = await apiRequest<Student>(`/api/students/${id}`)
 * if (!res.success) return <Alert variant="error">{res.error}</Alert>
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = "GET", body, params, cache = "no-store", tags } = options;

  try {
    const response = await fetch(`${API_BASE_URL}${path}${buildQuery(params)}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache,
      next: tags ? { tags } : undefined,
      // Sends the httpOnly session cookie on client-side calls. Server-side
      // fetches are unaffected by this flag.
      credentials: "include",
    });

    // A 401/403 body is still the standard envelope, so it is parsed below
    // rather than short-circuited — the caller decides whether to redirect.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // An HTML error page or an empty 204. Neither is JSON, and neither can
      // be reported as a parse error to a user, so it becomes a status-derived
      // failure instead.
      return fail(
        response.ok ? "The server returned an unreadable response." : response.statusText,
        codeForStatus(response.status)
      );
    }

    // Trust the envelope when the route produced one — it carries a more
    // specific message than any status mapping could.
    if (payload && typeof payload === "object" && "success" in payload) {
      return payload as ApiResponse<T>;
    }

    return fail("Unexpected response from the server.", "SERVER_ERROR");
  } catch {
    // fetch() rejects only on a transport-level failure: offline, DNS, CORS,
    // abort. There is no response and therefore no status to map.
    return fail(
      "Could not reach the server. Check your connection and try again.",
      "NETWORK_ERROR"
    );
  }
}

/**
 * Fetch one page of a collection and normalise it to `{ items, pagination }`.
 *
 * INPUT   : the collection path, plus the key the route nests its rows under —
 *           "students", "tenants", "campuses" and so on. That key is the part
 *           of the backend contract this function exists to absorb.
 * RETURNS : an envelope whose data is a PaginatedResult, so every list screen
 *           reads `data.items` regardless of which endpoint it came from.
 *
 * @example
 * // GET /api/students -> { data: { students: [...], pagination } }
 * const res = await apiList<Student>("/api/students", "students", { page: 2 })
 * // res.data.items is Student[]
 */
export async function apiList<T>(
  path: string,
  key: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<T>>> {
  const response = await apiRequest<ListEnvelope<string, T>>(path, { params });

  if (!response.success) return response;

  const envelope = response.data;
  const items = envelope[key];

  // The key is a string, not a checked type, so a rename on the backend would
  // otherwise surface as `undefined.map is not a function` inside a component.
  // Failing here names the actual problem.
  if (!Array.isArray(items)) {
    return fail(
      `Malformed list response: expected an array under "${key}".`,
      "SERVER_ERROR"
    );
  }

  return {
    success: true,
    data: { items, pagination: envelope.pagination },
  };
}

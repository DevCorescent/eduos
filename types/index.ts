// ============================================================================
// MODULE : Shared Types — Response Envelope
// PURPOSE: The success/failure envelope every route under app/api replies with,
//          plus the two constructors that build it.
//
//          Imported by all 55 backend routes as `@/types`. The envelope and the
//          ok()/fail() helpers below are the backend's contract and must not
//          change shape. The re-exports at the foot of the file are additive —
//          they let the frontend reach the domain types through the same
//          specifier without touching anything the routes depend on.
// ============================================================================

export type ApiResponse<T = unknown> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; code?: string };

export function ok<T>(data: T, message?: string): ApiResponse<T> {
  return { success: true, data, message };
}

export function fail(error: string, code?: string): ApiResponse<never> {
  return { success: false, error, code };
}

// --- Frontend surface -------------------------------------------------------
// Domain enums, wire entities and the pagination contract, re-exported so a
// page can write `import type { Student, StudentStatus } from "@/types"` rather
// than reaching into three separate modules. `./api` imports ApiResponse from
// this file, but only as a type, so the cycle is erased at compile time and
// never exists at runtime.

export * from "./enums";
export * from "./entities";
export * from "./api";

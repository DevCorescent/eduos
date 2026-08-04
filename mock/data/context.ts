// ============================================================================
// MODULE : Mock Data — Tenant Context
// PURPOSE: The tenant id every fixture inside the university portal belongs to.
//
//          Matches the tenantId that services/session.ts puts on the
//          development session. That agreement is what makes the fixtures
//          coherent: a page reading session.tenantId and a fixture carrying
//          tenantId are talking about the same institution, so tenant-scoped
//          filtering behaves exactly as it will against the real API.
// ============================================================================

/** Mirrors DEFAULT_MOCK_SESSION.tenantId in services/session.ts. */
export const MOCK_TENANT_ID = "mock-tenant-1";

/**
 * Stable id builder: `stu_0042` rather than a random string.
 *
 * Padded so ids sort lexicographically in the same order they were generated,
 * which keeps fixture output readable and diffs stable.
 */
export function mockId(prefix: string, index: number, width = 3): string {
  return `${prefix}_${String(index).padStart(width, "0")}`;
}

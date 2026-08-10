// ============================================================================
// OWNER      : Gauransh
// MODULE     : Audit & Governance Foundation (WP-2, PRD §47)
// LAYER      : Service
// PURPOSE    : One entry point every module records evidence through, so what
//              gets logged, what never gets logged, and when a failure is
//              recorded are decided once.
//
// THE TWO TRANSACTION SEMANTICS, AND WHY THERE ARE TWO
//
//   recordAudit(entry, tx)  — SUCCESS entries, inside the caller's transaction.
//     An audit row written outside the transaction survives a rollback and
//     reports a change that never happened. That is worse than no audit: it is
//     confidently wrong, and an investigator has no way to tell.
//
//   recordAuditFailure(entry) — FAILURE entries, deliberately OUTSIDE it.
//     The transaction that failed is gone; anything written inside it went with
//     it. A refused privilege escalation that leaves no trace is exactly the
//     event PRD §47 "Failed action logs" exists to capture, so this one writes
//     on its own connection and is the ONE place that must not join a caller's
//     transaction.
//
// FAILING TO AUDIT MUST NOT FAIL THE REQUEST — EXCEPT WHEN IT MUST
//   recordAuditFailure swallows its own errors: it runs on a path where
//   something has already gone wrong, and turning a 403 into a 500 because the
//   log write also failed helps nobody. recordAudit does NOT swallow — it runs
//   inside the caller's transaction, so if the audit row cannot be written the
//   business change must roll back with it. An operation that succeeded with no
//   evidence is precisely what this module exists to prevent.
//
// WHAT IS NEVER RECORDED
//   Passwords, hashes, JWTs, refresh tokens, cookies, API keys. The redaction
//   below is a backstop, not the primary defence — callers pass explicit,
//   narrow snapshots rather than whole request bodies. It exists because a
//   backstop that is never needed costs nothing, and one that is missing when
//   it is needed writes a credential to a table built to be read by auditors.
// ============================================================================

import { auditLogRepository, type DbClient } from "@/lib/repositories/auditLog.repository";
import type { AuditAction, AuditResource } from "@/lib/constants/audit";

/** The caller and their origin, as far as the request can establish it. */
export interface AuditActor {
  /** null for an unauthenticated event — a failed login has no user yet. */
  readonly userId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** Ties every entry from one request together. */
  readonly correlationId?: string | null;
}

export interface AuditEntry {
  readonly tenantId: string;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  readonly resource: AuditResource;
  readonly resourceId?: string | null;
  /** Prior state. Omit for a creation — there was none. */
  readonly before?: unknown;
  /** New state, or the event's context where there is no "state". */
  readonly after?: unknown;
}

/**
 * Keys whose values are replaced before storage, whatever their nesting.
 *
 * Matched case-insensitively on a substring, so `passwordHash`,
 * `newPassword` and `refresh_token` are all caught by three entries.
 */
const REDACTED_KEYS = [
  "password",
  "hash",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
];

const REDACTED = "[redacted]";

/**
 * Replace credential-shaped values anywhere in a snapshot.
 *
 * Depth-limited: a snapshot is a small DTO, and an object graph deep enough to
 * exhaust the stack is a bug rather than evidence worth storing. Arrays are
 * walked because a snapshot may legitimately be a list of rows.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    out[key] = REDACTED_KEYS.some((needle) => lower.includes(needle))
      ? REDACTED
      : redact(inner, depth + 1);
  }

  return out;
}

/**
 * Record a SUCCESSFUL action.
 *
 * @param client Pass the transaction handle that performed the change, so the
 *               evidence and the change commit or roll back together. Omitting
 *               it is correct only for an event that is not part of a
 *               transaction at all, such as a successful login.
 * @throws whatever the write throws — deliberately. See the module header.
 */
export async function recordAudit(entry: AuditEntry, client?: DbClient): Promise<void> {
  await auditLogRepository.record(
    {
      tenantId: entry.tenantId,
      userId: entry.actor.userId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      before: entry.before === undefined ? undefined : redact(entry.before),
      after: entry.after === undefined ? undefined : redact(entry.after),
      ipAddress: entry.actor.ipAddress,
      userAgent: entry.actor.userAgent,
      status: "SUCCESS",
      correlationId: entry.actor.correlationId ?? null,
    },
    client
  );
}

/**
 * Record a REFUSED or FAILED action.
 *
 * Never takes a transaction handle. The transaction this describes has already
 * rolled back, or never began; joining one would discard the very entry an
 * investigator needs.
 *
 * Swallows its own failure — see the module header for why this one may and
 * recordAudit may not.
 */
export async function recordAuditFailure(
  entry: AuditEntry & { readonly reason?: string }
): Promise<void> {
  try {
    await auditLogRepository.record({
      tenantId: entry.tenantId,
      userId: entry.actor.userId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      before: entry.before === undefined ? undefined : redact(entry.before),
      // The reason travels in `after` rather than a column of its own: there is
      // no "after state" for something that did not happen, and adding a column
      // the PRD does not name to hold one string is not a trade worth making.
      //
      // The spread comes LAST deliberately. Written the other way round, an
      // undefined `entry.reason` overwrites a reason the caller had already put
      // inside `after`, and JSON.stringify then drops the key entirely — the
      // failure is recorded with no explanation of why it failed. Live testing
      // caught exactly that.
      after: redact({
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.after as object | undefined),
      }),
      ipAddress: entry.actor.ipAddress,
      userAgent: entry.actor.userAgent,
      status: "FAILURE",
      correlationId: entry.actor.correlationId ?? null,
    });
  } catch (err) {
    // Logged, not rethrown. This path already carries a failure; masking it
    // with a second one would lose the original.
    console.error("[audit] could not record a FAILURE entry", err);
  }
}

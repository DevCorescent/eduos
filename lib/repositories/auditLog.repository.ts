// ============================================================================
// OWNER      : Gauransh
// MODULE     : Core Infrastructure — Audit Log
// LAYER      : Repository
// PURPOSE    : Persist audit entries. Shared by every module that mutates
//              tenant-owned state, so the AuditLog write is defined once.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • It decides nothing: not what is auditable, not what a before/after
//     snapshot contains, not which action name applies. Those are business
//     decisions and belong to the calling service.
//
// The AuditLog model already existed and, before this module, was written by
// nothing in the application. This is the first writer, so the conventions it
// establishes — resource names, action vocabulary, snapshot shape — are set by
// each calling module's constants file, never here.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * A Prisma client or an interactive transaction handle.
 *
 * Every method accepts one so a caller can enrol the audit write in the SAME
 * transaction as the change it describes. That matters: an audit entry written
 * outside the transaction survives a rollback and reports a change that never
 * happened.
 */
export type DbClient = Prisma.TransactionClient;

/**
 * One audit entry.
 *
 * `before` and `after` are `unknown` rather than a Prisma JSON type on purpose.
 * Callers pass their own DTOs, and a TypeScript interface has no implicit index
 * signature, so it is not assignable to Prisma.InputJsonValue however
 * JSON-shaped its contents actually are. Accepting `unknown` here and narrowing
 * once, at the single point of storage below, keeps that cast in one reviewed
 * place instead of forcing every caller to launder its own DTO.
 *
 * Omit a snapshot rather than passing null: an omitted key leaves the column
 * SQL NULL, which is what "there was no prior state" means for a creation.
 */
export interface AuditLogEntry {
  tenantId: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  /**
   * PRD §47 "Failed action logs". Optional so the eleven modules that wrote
   * entries before WP-2 continue to compile and continue to mean what they
   * meant: the column defaults to SUCCESS, which is what those calls recorded.
   */
  status?: "SUCCESS" | "FAILURE";
  /** Ties the several entries one request produces together. */
  correlationId?: string | null;
}

export class AuditLogRepository {
  /**
   * Write one audit entry.
   *
   * COMPLEXITY : O(1) — a single INSERT, four indexes maintained
   *              (tenantId, userId, [resource, resourceId], createdAt).
   * RETURNS    : nothing. No caller needs the generated id, and selecting it
   *              would add a RETURNING clause to every mutation in the system.
   */
  async record(entry: AuditLogEntry, client: DbClient = prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        // The single narrowing described above. Both columns are nullable Json;
        // `undefined` omits the column, which is not the same as storing a JSON
        // null and is the behaviour a missing snapshot requires.
        before: entry.before as Prisma.InputJsonValue | undefined,
        after: entry.after as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        status: entry.status ?? "SUCCESS",
        correlationId: entry.correlationId ?? null,
      },
      select: { id: true },
    });
  }
}

export const auditLogRepository = new AuditLogRepository();

/**
 * The abstraction the service layer depends on.
 *
 * Declared so a service imports a CONTRACT rather than a concrete class holding
 * a live Prisma connection. The import in the service is `import type`, so it
 * is erased at compile time and the service module never pulls lib/db/prisma
 * into its runtime graph — which is what allows it to be unit-tested with no
 * database and no environment.
 */
export type AuditLogRepositoryPort = Pick<AuditLogRepository, "record">;

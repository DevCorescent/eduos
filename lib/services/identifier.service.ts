// ============================================================================
// OWNER      : Gauransh
// MODULE     : Identifier Engine (PRD §9)
// LAYER      : Service
// PURPOSE    : Issue the configured identifier for one entity, exactly once,
//              safely under concurrency, inside the caller's transaction.
//
// THE ONE THING THIS MODULE EXISTS TO GET RIGHT
//   Two admissions clerks pressing Enrol at the same instant must not receive
//   the same enrolment number. The obvious implementation — read lastSequence,
//   add one, write it back — loses that race every time both reads land before
//   either write. So the read and the write are ONE statement:
//
//     UPDATE "IdSequence" SET "lastSequence" = <reset? 1 : lastSequence + 1>
//      WHERE ... RETURNING "lastSequence", ...
//
//   Postgres takes a row lock for the duration of that UPDATE. The second
//   request blocks on it, then reads the value the first one wrote. No
//   application-level lock, no retry loop, no counter in memory. The unique
//   index on (tenantId, entityType, scopeKey) is what guarantees there is
//   exactly one row to contend on.
//
// THE CLOCK COMES FROM THE DATABASE, NOT THE SERVER
//   The reset decision and the {YEAR} token both read EXTRACT(... FROM now())
//   inside that same statement. Two application servers with drifting clocks
//   would otherwise disagree about when a yearly counter rolls over, and could
//   stamp 2026 on a number the counter believes belongs to 2025. It also means
//   the module never calls Date.now(), which the brief forbids.
//
// TRANSACTIONS, AND WHY GAPS ARE THE RIGHT DEFAULT
//   generateIdentifier takes a Prisma client, so a caller inside
//   prisma.$transaction passes the transaction handle and the increment rolls
//   back with the entity if creation fails — no gap. A caller outside a
//   transaction keeps the increment, leaving a gap.
//
//   The PRD is SILENT on gaps, so the choice is stated rather than assumed:
//   gaps are ACCEPTABLE. The alternative — guaranteeing dense numbering — needs
//   the row lock held across the whole entity-creation transaction, which
//   serialises every admission in a tenant behind one row and turns a bulk
//   intake into a queue. A missing number in a register is an administrative
//   curiosity; a duplicate is a data-integrity incident, and this design
//   removes the second at the cost of the first.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
//   It does not create configuration. A missing sequence is an error, never an
//   invented default: silently generating "STU-2026-0001" for a university that
//   never configured a format would put an identifier the registrar did not
//   choose onto a student record, permanently.
// ============================================================================

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/AppError";
import {
  formatIdentifier,
  needsReset,
  type FormatContext,
} from "@/lib/domain/identifier/format";
import { recordAudit, type AuditActor } from "@/lib/services/audit.service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";

/**
 * The entities the engine issues for.
 *
 * A closed union rather than a free string: `entityType` is part of a unique
 * index, and a typo would silently create a SECOND counter for the same entity
 * which would then issue numbers already in use. Only entities with a real
 * consumer appear here — PRD §9.1 lists 23 identifier types, and the rest are
 * recorded in the completion matrix rather than declared with nothing behind
 * them.
 */
export const IDENTIFIER_ENTITIES = [
  "STUDENT",
  "FACULTY",
  "EMPLOYEE",
  "CERTIFICATE",
  // W3 — PRD §9.1 names "Applicant ID" and "Application number" among its
  // supported IDs, and §8.2 requires an "Auto-generated application number".
  // Added here rather than in a second numbering service: the reset cycles,
  // padding, prefixes, scoping, locking and audit already live in this engine,
  // and a parallel generator would eventually disagree with it about all of
  // them. Both now have a real consumer, which is the bar this list sets.
  "APPLICANT",
  "APPLICATION",
] as const;

export type IdentifierEntity = (typeof IDENTIFIER_ENTITIES)[number];

/** Anything that can run a query — the base client or a transaction handle. */
export type PrismaLike = Pick<Prisma.TransactionClient, "$queryRaw"> & {
  idSequence?: unknown;
};

export interface GenerateInput {
  readonly tenantId: string;
  readonly entityType: IdentifierEntity;
  /**
   * The sub-tenant counter dimension — a campus id, a programme id, or "".
   *
   * Must match the configured row exactly. Passing a campus id when the tenant
   * configured one unscoped sequence finds no row and raises, rather than
   * quietly falling back to the unscoped counter and issuing a number from the
   * wrong series.
   */
  readonly scopeKey?: string;
  /** Codes the format may reference. See FormatContext. */
  readonly context?: Omit<FormatContext, "year" | "month">;
  /**
   * Who is issuing, for the audit trail (PRD §9.3 "Generation audit log",
   * deferred by WP-1 and delivered in WP-2).
   *
   * OPTIONAL, and its absence means no audit entry rather than an entry with an
   * unknown actor. Some callers legitimately have no request context — a
   * migration, a test — and an evidence row attributing an issue to nobody is
   * worse than none: it looks like the system issued it by itself.
   */
  readonly actor?: AuditActor;
}

/** One row of the atomic issue statement. */
interface IssuedRow {
  lastSequence: number;
  prefix: string | null;
  suffix: string | null;
  format: string;
  padding: number;
  year: number;
  month: number;
}

/**
 * Issue the next identifier for one entity.
 *
 * @param client Pass a transaction handle to tie the increment to the caller's
 *               transaction; omit it and the increment stands on its own.
 * @throws AppError 409 when no active sequence is configured — a conflict
 *         rather than a 404, because the request is well-formed and the
 *         institution's setup is what is incomplete.
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const enrollmentNo = await generateIdentifier({ tenantId, entityType: "STUDENT" }, tx)
 *   return tx.student.create({ data: { enrollmentNo, … } })
 * })
 */
export async function generateIdentifier(
  input: GenerateInput,
  client: PrismaLike = defaultClient
): Promise<string> {
  const scopeKey = input.scopeKey ?? "";

  // Read the configuration and the database clock together, so the reset
  // decision below is made against the same instant the UPDATE will stamp.
  const configRows = await client.$queryRaw<
    Array<{
      resetCycle: string;
      lastResetYear: number | null;
      lastResetMonth: number | null;
      year: number;
      month: number;
    }>
  >`
    SELECT s."resetCycle"::text        AS "resetCycle",
           s."lastResetYear"           AS "lastResetYear",
           s."lastResetMonth"          AS "lastResetMonth",
           EXTRACT(YEAR  FROM now())::int AS "year",
           EXTRACT(MONTH FROM now())::int AS "month"
      FROM "IdSequence" s
     WHERE s."tenantId"   = ${input.tenantId}
       AND s."entityType" = ${input.entityType}
       AND s."scopeKey"   = ${scopeKey}
       AND s."isActive"   = true
  `;

  const config = configRows[0];
  if (!config) {
    throw new AppError(
      `No active ${input.entityType} identifier sequence is configured for this institution.`,
      409,
      "CONFLICT"
    );
  }

  const reset = needsReset(
    config.resetCycle as "NEVER" | "YEARLY" | "MONTHLY" | "SEMESTERLY",
    config.lastResetYear,
    config.lastResetMonth,
    { year: config.year, month: config.month }
  );

  // THE ATOMIC ISSUE. Read-and-write in one statement, so two concurrent
  // callers serialise on the row lock rather than both reading the same value.
  // The reset flag is computed above but APPLIED here, inside the locked
  // statement, so the losing request of a race still increments from whatever
  // the winner left rather than resetting a second time.
  const issued = await client.$queryRaw<IssuedRow[]>`
    UPDATE "IdSequence"
       SET "lastSequence"   = CASE
                                WHEN ${reset} AND "lastResetYear" IS DISTINCT FROM EXTRACT(YEAR FROM now())::int
                                  THEN 1
                                WHEN ${reset} AND "lastResetMonth" IS DISTINCT FROM EXTRACT(MONTH FROM now())::int
                                  THEN 1
                                ELSE "lastSequence" + 1
                              END,
           "lastResetYear"  = EXTRACT(YEAR  FROM now())::int,
           "lastResetMonth" = EXTRACT(MONTH FROM now())::int,
           "updatedAt"      = now()
     WHERE "tenantId"   = ${input.tenantId}
       AND "entityType" = ${input.entityType}
       AND "scopeKey"   = ${scopeKey}
       AND "isActive"   = true
    RETURNING "lastSequence", "prefix", "suffix", "format", "padding",
              EXTRACT(YEAR  FROM now())::int AS "year",
              EXTRACT(MONTH FROM now())::int AS "month"
  `;

  const row = issued[0];
  if (!row) {
    // The sequence was deactivated or deleted between the two statements.
    // Reported rather than retried: a configuration that changed mid-request
    // is a decision somebody just made, and issuing anyway would override it.
    throw new AppError(
      `The ${input.entityType} identifier sequence changed while issuing. Try again.`,
      409,
      "CONFLICT"
    );
  }

  const identifier = formatIdentifier(
    {
      prefix: row.prefix,
      suffix: row.suffix,
      format: row.format,
      padding: row.padding,
    },
    row.lastSequence,
    { ...input.context, year: row.year, month: row.month }
  );

  // PRD §9.3 "Generation audit log". Written with the SAME client the number
  // was issued on, so the evidence and the increment share one fate: a rolled
  // back entity creation takes both with it, and there is no orphan row
  // claiming an identifier was issued for a record that does not exist.
  //
  // recordAudit deliberately does not swallow — if the evidence cannot be
  // written the whole issue rolls back, because an identifier that exists with
  // no record of who issued it is the gap this work package closes.
  if (input.actor) {
    await recordAudit(
      {
        tenantId: input.tenantId,
        actor: input.actor,
        action: AUDIT_ACTIONS.IDENTIFIER_ISSUED,
        resource: AUDIT_RESOURCES.ID_SEQUENCE,
        resourceId: input.entityType,
        // The issued value, the counter behind it and the scope. Enough to
        // answer "who issued this number and from which series", which is the
        // question an auditor asks. No personal data: the entity it was
        // attached to is audited by that entity's own creation entry, tied to
        // this one through the correlation id.
        after: {
          identifierType: input.entityType,
          identifier,
          sequence: row.lastSequence,
          scopeKey,
        },
      },
      client as Parameters<typeof recordAudit>[1]
    );
  }

  return identifier;
}

/**
 * Whether an active sequence exists, without issuing a number.
 *
 * Lets a caller decide between generating and accepting a client-supplied
 * value, which is what keeps the existing create endpoints backward compatible
 * for institutions that have not configured the engine.
 */
export async function hasActiveSequence(
  tenantId: string,
  entityType: IdentifierEntity,
  scopeKey = "",
  client: PrismaLike = defaultClient
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM "IdSequence"
     WHERE "tenantId"   = ${tenantId}
       AND "entityType" = ${entityType}
       AND "scopeKey"   = ${scopeKey}
       AND "isActive"   = true
     LIMIT 1
  `;

  return rows.length > 0;
}

/**
 * Render what the NEXT identifier would look like, changing nothing.
 *
 * Deliberately not a dry run of the generator: it must not increment, and it
 * must not lock the row. It shows `lastSequence + 1` (or 1 across a reset
 * boundary) through the same formatter the generator uses, so what an
 * administrator previews is what the register will contain — as long as nobody
 * else issues one first, which is why the copy calls it a preview.
 */
export async function previewIdentifier(
  input: GenerateInput,
  client: PrismaLike = defaultClient
): Promise<{ preview: string; nextSequence: number; willReset: boolean }> {
  const scopeKey = input.scopeKey ?? "";

  const rows = await client.$queryRaw<
    Array<
      IssuedRow & {
        resetCycle: string;
        lastResetYear: number | null;
        lastResetMonth: number | null;
      }
    >
  >`
    SELECT s."lastSequence", s."prefix", s."suffix", s."format", s."padding",
           s."resetCycle"::text AS "resetCycle",
           s."lastResetYear", s."lastResetMonth",
           EXTRACT(YEAR  FROM now())::int AS "year",
           EXTRACT(MONTH FROM now())::int AS "month"
      FROM "IdSequence" s
     WHERE s."tenantId"   = ${input.tenantId}
       AND s."entityType" = ${input.entityType}
       AND s."scopeKey"   = ${scopeKey}
  `;

  const row = rows[0];
  if (!row) {
    throw new AppError(
      `No ${input.entityType} identifier sequence is configured for this institution.`,
      404,
      "NOT_FOUND"
    );
  }

  const willReset = needsReset(
    row.resetCycle as "NEVER" | "YEARLY" | "MONTHLY" | "SEMESTERLY",
    row.lastResetYear,
    row.lastResetMonth,
    { year: row.year, month: row.month }
  );

  const nextSequence = willReset ? 1 : row.lastSequence + 1;

  return {
    preview: formatIdentifier(
      { prefix: row.prefix, suffix: row.suffix, format: row.format, padding: row.padding },
      nextSequence,
      { ...input.context, year: row.year, month: row.month }
    ),
    nextSequence,
    willReset,
  };
}

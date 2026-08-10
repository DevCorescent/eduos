-- WP-2 Audit & Governance Foundation (PRD §47)
--
-- PURELY ADDITIVE. One enum, two nullable-or-defaulted columns, two indexes.
-- No column is dropped, no type changes, no row is written or deleted.
--
-- HAND-WRITTEN FOR THE SAME REASON AS WP-1
--   `prisma migrate dev` reports drift against a `playing_with_neon` table that
--   exists in the database but in no migration, and proposes `migrate reset` —
--   which drops everything. The statements below are the exact diff it would
--   have produced.
--
-- EXISTING ROWS: every AuditLog row already written keeps its meaning. `status`
-- defaults to SUCCESS, which is what those rows recorded — the repository had
-- no failure path, so nothing already stored describes a failed action.

CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- PRD §47 "Failed action logs". Defaulted rather than nullable: an entry with
-- no outcome is not evidence of anything.
ALTER TABLE "AuditLog" ADD COLUMN "status" "AuditStatus" NOT NULL DEFAULT 'SUCCESS';

-- Ties the several entries one request produces together.
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;

-- The viewer's default read: one tenant, newest first. The existing
-- single-column tenantId and createdAt indexes cannot serve it as one scan.
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

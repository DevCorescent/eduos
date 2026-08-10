-- WP-1 Identifier Engine (PRD section 9)
--
-- PURELY ADDITIVE. Two nullable-with-default columns and one widened unique
-- index. No column is dropped, no type changes, no data is written or deleted.
--
-- WHY THIS FILE IS HAND-WRITTEN
--   `prisma migrate dev` refuses to run against this database: it detects a
--   `playing_with_neon` table that exists in the database but in no migration
--   (a Neon sample table created at provisioning), reports drift, and proposes
--   `migrate reset` — which would drop every table. The drift is real but
--   harmless, and resetting a database to add two columns is not a trade worth
--   making. The statements below are the exact diff `migrate dev` would have
--   produced, written out so they can be read before they are run.
--
-- ROW COUNT AT TIME OF WRITING: IdSequence holds 0 rows, so the index swap
-- cannot fail on existing data and the defaults backfill nothing.

-- PRD 9.3 "Reset sequence by campus" / "by programme". Empty string, never
-- NULL: Postgres treats NULLs as distinct in a unique index, so a nullable
-- column here would let two unscoped sequences coexist for one entity and each
-- would hand out the same numbers.
ALTER TABLE "IdSequence" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT '';

-- A retired sequence stops issuing without being deleted. Deleting one loses
-- lastSequence, and a sequence recreated at zero reissues numbers already
-- printed on certificates.
ALTER TABLE "IdSequence" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- The counter identity gains its third dimension. Created BEFORE the old index
-- is dropped so the table is never momentarily unconstrained.
CREATE UNIQUE INDEX "IdSequence_tenantId_entityType_scopeKey_key"
  ON "IdSequence"("tenantId", "entityType", "scopeKey");

DROP INDEX "IdSequence_tenantId_entityType_key";

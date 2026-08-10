-- W1.3 Platform Users
--
-- PURELY ADDITIVE. One nullable-by-default boolean on an existing table.
-- No DROP, no DELETE, no TRUNCATE, no new table, no change to any other column.
--
-- WHY THE DEFAULT IS false AND NOT true
--   Backfilling true would lock every EXISTING platform operator — including
--   the one that migrated in W1.2 — out of the console until they changed a
--   password they chose themselves. The flag means "somebody else set this
--   password", which is not true of any row that exists before this migration.
--
-- HAND-WRITTEN, for the same reason as 20260814000000_w12_platform_identity:
-- `prisma migrate dev` reports drift against the `playing_with_neon` table and
-- proposes `migrate reset`, which drops every table on the shared Neon database.

ALTER TABLE "PlatformUser"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

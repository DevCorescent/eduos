-- W1.4 University Provisioning
--
-- PURELY ADDITIVE. One column on an existing table.
-- No DROP, no DELETE, no TRUNCATE, no new table, no change to any other column.
--
-- NO NEW MODEL IS CREATED BY THIS WORK PACKAGE, DELIBERATELY
--   Tenant, User, Role, UserRole, Subscription and Domain already express
--   everything a provisioned university needs. W1.4 composes them inside one
--   transaction; it does not model them again. The only thing the schema could
--   not already say is "this password was set by somebody else", which is what
--   the column below records — mirroring PlatformUser.mustChangePassword from
--   W1.3 rather than inventing a second forced-change mechanism.
--
-- WHY THE DEFAULT IS false AND NOT true
--   Backfilling true would lock every existing tenant user out of every tenant
--   API until they changed a password they chose themselves. The flag means
--   "somebody else set this password", which is not true of any row that exists
--   before this migration.
--
-- HAND-WRITTEN, for the same reason as the two migrations before it:
-- `prisma migrate dev` reports drift against the `playing_with_neon` table and
-- proposes `migrate reset`, which drops every table on the shared Neon database.

ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

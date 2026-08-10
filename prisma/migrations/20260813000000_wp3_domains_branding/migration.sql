-- WP-3 Tenant Domains + Branding (PRD §5.2, §45)
--
-- PURELY ADDITIVE. Two columns and one partial unique index.
-- No DROP, no DELETE, no TRUNCATE, no type change, no FK change.
--
-- HAND-WRITTEN: `prisma migrate dev` still reports drift against the
-- `playing_with_neon` table and proposes `migrate reset`, which drops
-- everything. These are the exact statements it would otherwise produce.
--
-- ROW COUNT AT TIME OF WRITING: Domain holds 0 rows. Both defaults therefore
-- backfill nothing and the new index cannot fail on existing data.

-- A retired domain stops resolving without freeing its hostname for another
-- tenant to claim.
ALTER TABLE "Domain" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Prisma's @updatedAt is written by the client; the default covers rows the
-- client did not create.
ALTER TABLE "Domain" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- PRD §5.2 "Canonical domain configuration": at most ONE primary per tenant.
--
-- PARTIAL, on purpose. A plain unique on (tenantId, isPrimary) would also
-- forbid a tenant having two NON-primary domains, which is the ordinary case
-- multi-domain support exists for. The WHERE clause constrains only the rows
-- that claim to be canonical.
--
-- Enforced here rather than in the service because two concurrent "make this
-- primary" requests both read one primary and both write another; no amount of
-- careful application logic closes that window, and a database constraint
-- closes it completely.
CREATE UNIQUE INDEX "Domain_tenantId_primary_key"
  ON "Domain"("tenantId") WHERE "isPrimary";

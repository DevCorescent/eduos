-- W1.5 completion — modules, billing basis, archival (PRD §2.1, §5.1, §5.3, §57)
--
-- PURELY ADDITIVE. One enum added, one enum VALUE added, four columns.
-- No DROP, no DELETE, no TRUNCATE. Every added column is nullable or carries a
-- default equal to the behaviour that already applied, so no stored row changes
-- meaning and no backfill is needed.
--
-- WHAT THE PRD ACTUALLY DEFINES, AND WHAT IT DOES NOT
--
--   GAP-01 modules — RESOLVED IN PART.
--     §2.1 lists "Module allocation" as a platform-owner control, §5.1 says
--     "Assign enabled modules", and §57 lists "Modules" in the Central Super
--     Admin navigation AND enumerates the University Administration areas. That
--     enumeration is the catalogue, and it lives in application code
--     (lib/constants/modules.ts) rather than in the database: it is a fixed list
--     from a document, not tenant data, and a table would invite rows the PRD
--     never named. Selection continues to live in Subscription.features, which
--     is the existing architecture and is now constrained to catalogue keys.
--     ENFORCEMENT remains a gap: the PRD nowhere says what a disabled module
--     DOES, so no 403, 404 or redirect behaviour has been invented.
--
--   GAP-02 payment terms — RESOLVED IN PART.
--     §5.3 defines pricing BASES ("Module-based", "Per-student",
--     "Per-active-user", "Per-course", "Storage-based", plus plan-based) and
--     "Auto-renewal management". Those are added below. It defines no due day,
--     no net period, no advance payment and no grace, so none is modelled.
--
--   GAP-03 archival — RESOLVED IN PART, NON-DESTRUCTIVELY.
--     §5.1 says "Tenant deletion and data archival"; §46.3 names
--     "Data-retention policies" and "Data-deletion workflows" without defining
--     either; §54's "Legacy Archival" is a step in DATA MIGRATION, not tenant
--     deletion. So the ARCHIVED status below stops the university serving
--     traffic and keeps every row. No hard-delete endpoint exists, and no
--     retention period or restore procedure has been invented.
--
-- HAND-WRITTEN, for the same reason as the four migrations before it:
-- `prisma migrate dev` reports drift against the `playing_with_neon` table and
-- proposes `migrate reset`, which drops every table on the shared Neon database.

-- Postgres allows ADD VALUE on an existing enum; no table is rewritten.
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- PRD §5.3 pricing bases.
CREATE TYPE "PricingModel" AS ENUM (
  'FLAT_PLAN',
  'MODULE_BASED',
  'PER_STUDENT',
  'PER_ACTIVE_USER',
  'PER_COURSE',
  'STORAGE_BASED'
);

-- FLAT_PLAN is what every existing row already is, so the default preserves
-- current meaning rather than reinterpreting stored data.
ALTER TABLE "Subscription" ADD COLUMN "pricingModel" "PricingModel" NOT NULL DEFAULT 'FLAT_PLAN';
ALTER TABLE "Subscription" ADD COLUMN "autoRenew"    BOOLEAN        NOT NULL DEFAULT true;

ALTER TABLE "Tenant" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "archivedBy" TEXT;

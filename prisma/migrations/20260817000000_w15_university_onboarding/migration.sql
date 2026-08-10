-- W1.5 University Onboarding (PRD §5.1, §49.1)
--
-- PURELY ADDITIVE. One enum, one table, three columns on existing tables.
-- No DROP, no DELETE, no TRUNCATE, no change to any existing column's type,
-- nullability or default. Every added column is nullable, so every existing
-- row remains valid without a backfill.
--
-- WHY SO LITTLE NEW SCHEMA FOR TWENTY-ONE PRD CAPABILITIES
--   Most of §5.1 was already representable. Tenant carries the legal and
--   accreditation columns, Domain carries §5.2, Campus and School carry
--   "campuses and affiliated colleges", AcademicYear carries "configure
--   academic year", Subscription carries plan and limits, and W1.4 already
--   creates the tenant and its first administrator. What was genuinely absent
--   is below, and nothing else was added.
--
--   Tenant."supportManagerId"      §5.1 "Assign support manager"
--   Subscription."maxCourses"      §5.1 "Set limits for users, storage and
--                                  courses" — users and storage had columns,
--                                  courses did not
--   "OnboardingStage" + the table  §5.1 "Track onboarding progress" and
--                                  "University readiness checklist", whose
--                                  stages are PRD §49.1's arrow-chain verbatim
--
-- DELIBERATELY NOT ADDED — reported as gaps rather than invented:
--   GAP-01 module catalogue      — Subscription.features is preserved as-is
--   GAP-02 payment-term fields   — §5.1 names the capability, defines no field
--   GAP-03 archival semantics    — §54 names Legacy Archival in the migration
--                                  process; tenant-deletion archival format,
--                                  retention and restore are undefined
--
-- HAND-WRITTEN, for the same reason as the three migrations before it:
-- `prisma migrate dev` reports drift against the `playing_with_neon` table and
-- proposes `migrate reset`, which drops every table on the shared Neon database.

-- PRD §49.1, in the PRD's own order.
CREATE TYPE "OnboardingStage" AS ENUM (
  'UNIVERSITY_ENQUIRY',
  'COMMERCIAL_APPROVAL',
  'TENANT_CREATION',
  'DOMAIN_CONFIGURATION',
  'BRANDING_CONFIGURATION',
  'MODULE_SELECTION',
  'ACADEMIC_SETUP',
  'DATA_IMPORT',
  'USER_CREATION',
  'TRAINING',
  'UAT',
  'GO_LIVE'
);

ALTER TABLE "Tenant"       ADD COLUMN "supportManagerId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "maxCourses"       INTEGER;

CREATE TABLE "TenantOnboardingStep" (
    "tenantId"    TEXT NOT NULL,
    "stage"       "OnboardingStage" NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedBy" TEXT,
    "note"        TEXT,
    CONSTRAINT "TenantOnboardingStep_pkey" PRIMARY KEY ("tenantId","stage")
);

CREATE INDEX "TenantOnboardingStep_tenantId_idx" ON "TenantOnboardingStep"("tenantId");
CREATE INDEX "Tenant_supportManagerId_idx"       ON "Tenant"("supportManagerId");

-- CASCADE: a deleted tenant's onboarding record has nothing left to describe.
ALTER TABLE "TenantOnboardingStep"
  ADD CONSTRAINT "TenantOnboardingStep_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: an operator leaving the platform must not take their
-- universities with them.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_supportManagerId_fkey"
  FOREIGN KEY ("supportManagerId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

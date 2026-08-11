-- W4c — Website CMS: site-wide typography, and template-owned site chrome.
--
-- HAND-WRITTEN RATHER THAN DIFFED, DELIBERATELY
--   `prisma migrate diff` against this database emits two statements that
--   belong to nobody's work package — an ALTER on "Domain"."updatedAt" and a
--   DROP of the "playing_with_neon" scratch table — and a migration that
--   carries unrelated drift is a migration nobody can review. Every column
--   below is additive and nullable, so the SQL is short enough to write by
--   hand and read in full.
--
-- SAFE ON A LIVE DATABASE
--   No column is dropped, no type is changed, and nothing is NOT NULL, so this
--   applies to a table with rows in it and every existing row stays valid.
--   NULL means "no opinion": the renderer falls back to the design system's own
--   type, and onboarding falls back to the seeder's default chrome.

-- The institution's own typography, overridden per section by a block's `style`.
ALTER TABLE "CmsSite" ADD COLUMN "typography" JSONB;

-- The chrome a new university starts from, alongside the blocks it starts from.
-- Same schemas as the CmsSite columns of the same names, so onboarding copies
-- them across with no translation step.
ALTER TABLE "CmsTemplate" ADD COLUMN "navItems" JSONB;
ALTER TABLE "CmsTemplate" ADD COLUMN "footerColumns" JSONB;
ALTER TABLE "CmsTemplate" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "CmsTemplate" ADD COLUMN "typography" JSONB;

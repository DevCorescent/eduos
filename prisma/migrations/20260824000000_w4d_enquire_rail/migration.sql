-- W4d — Optional enquire dock on CmsSite / CmsTemplate.
--
-- ADDITIVE AND NULLABLE. Existing rows stay valid; null means the dock is off,
-- which is what parseEnquireRail already treats as the empty default.

ALTER TABLE "CmsSite" ADD COLUMN "enquireRail" JSONB;
ALTER TABLE "CmsTemplate" ADD COLUMN "enquireRail" JSONB;

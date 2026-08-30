-- Certificate template versioning, and immutability for issued certificates.
--
-- ADDITIVE AND SAFE. Every column is nullable or defaulted, so existing rows
-- stay valid with no backfill:
--   * every existing template becomes version 1 with no parent, which is
--     exactly what it is;
--   * every existing certificate keeps a null snapshot and continues to render
--     from its template, which is the behaviour it already had.
--
-- No column, index or constraint is altered or dropped.
ALTER TABLE "CertificateTemplate" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CertificateTemplate" ADD COLUMN IF NOT EXISTS "parentTemplateId" TEXT;
ALTER TABLE "CertificateTemplate" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CertificateTemplate_parentTemplateId_idx"
  ON "CertificateTemplate"("parentTemplateId");

ALTER TABLE "Certificate" ADD COLUMN IF NOT EXISTS "templateSnapshot" JSONB;

-- W4b - Website CMS site chrome (PRD 7.1). Additive only: one new table.
--
-- As with 20260821000000_w4_website_cms, two statements the generated diff
-- produced are NOT included here, because they are pre-existing drift rather
-- than this migration's work:
--   ALTER TABLE "Domain" ALTER COLUMN "updatedAt" DROP DEFAULT;
--   DROP TABLE "playing_with_neon";
-- Both remain outstanding and deliberately unapplied.

-- CreateTable
CREATE TABLE "CmsSite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "navItems" JSONB NOT NULL,
    "footerColumns" JSONB NOT NULL,
    "socialLinks" JSONB NOT NULL,
    "contactAddress" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "CmsSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsSite_tenantId_key" ON "CmsSite"("tenantId");

-- AddForeignKey
ALTER TABLE "CmsSite" ADD CONSTRAINT "CmsSite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

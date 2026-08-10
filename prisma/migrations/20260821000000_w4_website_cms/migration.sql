-- W4 — Website CMS (PRD §7). Additive only: three new tables and one enum.
--
-- TWO STATEMENTS WERE REMOVED FROM THE GENERATED DIFF BY HAND, DELIBERATELY.
--   `prisma migrate diff --from-config-datasource` diffs the LIVE DATABASE
--   against the schema, so it reports every pre-existing drift as though this
--   migration caused it. Two such statements appeared and are not this work
--   package's to make:
--
--     ALTER TABLE "Domain" ALTER COLUMN "updatedAt" DROP DEFAULT;
--       Drift between the recorded migrations and the live column. Unrelated to
--       the CMS, and correcting it inside a feature migration would hide it.
--
--     DROP TABLE "playing_with_neon";
--       Neon's sample table. Dropping somebody's table as a side effect of
--       adding a CMS is precisely the kind of change that must be a decision,
--       not a diff artefact.
--
--   Both remain outstanding and are recorded here rather than silently applied.

-- CreateEnum
CREATE TYPE "CmsPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "CmsTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blocks" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CmsPageStatus" NOT NULL DEFAULT 'DRAFT',
    "draftBlocks" JSONB NOT NULL,
    "publishedBlocks" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "ogImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "blocks" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsTemplate_key_key" ON "CmsTemplate"("key");

-- CreateIndex
CREATE INDEX "CmsPage_tenantId_status_idx" ON "CmsPage"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_tenantId_path_key" ON "CmsPage"("tenantId", "path");

-- CreateIndex
CREATE INDEX "CmsPageVersion_tenantId_idx" ON "CmsPageVersion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPageVersion_pageId_versionNo_key" ON "CmsPageVersion"("pageId", "versionNo");

-- AddForeignKey
ALTER TABLE "CmsTemplate" ADD CONSTRAINT "CmsTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPageVersion" ADD CONSTRAINT "CmsPageVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPageVersion" ADD CONSTRAINT "CmsPageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CmsPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

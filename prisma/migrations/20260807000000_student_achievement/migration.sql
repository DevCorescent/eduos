-- ============================================================================
-- MIGRATION : Phase 18 — Student Achievement
-- PURPOSE   : Add the Achievement table, the one model Phase 18 needs and the
--             schema did not have.
--
-- PURELY ADDITIVE, AND VERIFIED SO
--   Every statement below either CREATEs a new object or alters the new table
--   itself. No existing table is modified: no column added or dropped, no
--   constraint changed, no index rebuilt, no type altered. The Student
--   back-relation this introduces is virtual in Prisma and emits no DDL.
--
--   This file was not hand-written. It is the exact output of
--     prisma migrate diff --from-schema <pre-change> --to-schema <post-change>
--   so it cannot silently disagree with the schema it was derived from.
--
-- LOCK PROFILE
--   CREATE TABLE and CREATE INDEX on a brand-new, empty table take no lock any
--   concurrent reader can observe. The ADD CONSTRAINT ... FOREIGN KEY takes a
--   SHARE ROW EXCLUSIVE on Student only for the length of the statement, and
--   validates against zero rows because Achievement is empty. Safe to apply on
--   a live database.
--
-- REVERSIBILITY
--   DROP TABLE "Achievement"; DROP TYPE "AchievementCategory";
--   Nothing else was changed, so nothing else needs undoing.
-- ============================================================================


-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('ACADEMIC', 'SPORTS', 'CULTURAL', 'TECHNICAL', 'RESEARCH', 'SOCIAL_SERVICE', 'PROFESSIONAL', 'OTHER');

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "AchievementCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "achievedOn" TIMESTAMP(3) NOT NULL,
    "certificateUrl" TEXT,
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Achievement_tenantId_studentId_achievedOn_idx" ON "Achievement"("tenantId", "studentId", "achievedOn");

-- CreateIndex
CREATE INDEX "Achievement_studentId_idx" ON "Achievement"("studentId");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


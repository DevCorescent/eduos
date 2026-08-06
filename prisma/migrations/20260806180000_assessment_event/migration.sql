-- Phase 16 — Component 6.1: Assessment Event
--
-- One SITTING of one evaluation component, with the locking and publication
-- workflow that governs whether its marks may be written or seen.
--
-- PURELY ADDITIVE. One table, one enum, three indexes, five foreign keys.
-- Audited: no DROP TABLE, no DROP COLUMN, no ALTER COLUMN, no DROP
-- CONSTRAINT, no data movement.

Loaded Prisma config from prisma.config.ts.

-- CreateEnum
CREATE TYPE "AssessmentEventStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "AssessmentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evaluationComponentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "sectionId" TEXT,
    "title" TEXT NOT NULL,
    "maxMarks" DECIMAL(6,2) NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" TIMESTAMP(3),
    "conductedById" TEXT,
    "status" "AssessmentEventStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentEvent_tenantId_semesterId_courseId_idx" ON "AssessmentEvent"("tenantId", "semesterId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvent_evaluationComponentId_courseId_semesterId_s_key" ON "AssessmentEvent"("evaluationComponentId", "courseId", "semesterId", "sectionId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvent_tenantId_id_key" ON "AssessmentEvent"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_tenantId_evaluationComponentId_fkey" FOREIGN KEY ("tenantId", "evaluationComponentId") REFERENCES "EvaluationComponent"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "FacultyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


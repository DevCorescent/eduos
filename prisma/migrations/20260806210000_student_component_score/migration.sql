-- Phase 16 — Component 6.2: Student Component Score
--
-- The only marks table. Every mark cites an ASSESSMENT EVENT and a COURSE
-- REGISTRATION, never a student — which is what carries the attempt number,
-- the credits and the immutable regulation the mark is graded under.
--
-- PURELY ADDITIVE. One table, one enum, two indexes, two composite foreign
-- keys. Audited: no DROP TABLE, no DROP COLUMN, no ALTER COLUMN, no DROP
-- CONSTRAINT, no data movement.



-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('RECORDED', 'ABSENT', 'WITHHELD');

-- CreateTable
CREATE TABLE "StudentComponentScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentEventId" TEXT NOT NULL,
    "courseRegistrationId" TEXT NOT NULL,
    "marksObtained" DECIMAL(6,2),
    "status" "MarkStatus" NOT NULL DEFAULT 'RECORDED',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentComponentScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentComponentScore_tenantId_courseRegistrationId_idx" ON "StudentComponentScore"("tenantId", "courseRegistrationId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentComponentScore_assessmentEventId_courseRegistrationI_key" ON "StudentComponentScore"("assessmentEventId", "courseRegistrationId");

-- AddForeignKey
ALTER TABLE "StudentComponentScore" ADD CONSTRAINT "StudentComponentScore_tenantId_assessmentEventId_fkey" FOREIGN KEY ("tenantId", "assessmentEventId") REFERENCES "AssessmentEvent"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudentComponentScore" ADD CONSTRAINT "StudentComponentScore_tenantId_courseRegistrationId_fkey" FOREIGN KEY ("tenantId", "courseRegistrationId") REFERENCES "CourseRegistration"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


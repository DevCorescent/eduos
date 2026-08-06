-- Phase 16 — Component 5.5: Course Registration
--
-- The immutable academic contract between a student and a course. Every
-- downstream engine resolves rosters, attempts and the governing regulation
-- from this table instead of deriving them from Student.sectionId, which is
-- overwritten when a student advances and therefore loses history.
--
-- PURELY ADDITIVE. One table, two enums, three indexes, six foreign keys.
-- Audited: no DROP TABLE, no DROP COLUMN, no ALTER COLUMN, no DROP
-- CONSTRAINT, no data movement. No existing table is altered, so this cannot
-- fail on populated data and needs no backfill.

-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('REGULAR', 'ELECTIVE', 'OPEN_ELECTIVE', 'AUDIT', 'BACKLOG', 'IMPROVEMENT', 'REPEAT', 'CREDIT_TRANSFER');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'CONFIRMED', 'DROPPED', 'WITHDRAWN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CourseRegistration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "sectionId" TEXT,
    "programmeId" TEXT,
    "evaluationSchemeId" TEXT NOT NULL,
    "credits" DECIMAL(4,2) NOT NULL,
    "registrationType" "RegistrationType" NOT NULL DEFAULT 'REGULAR',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseRegistration_tenantId_semesterId_courseId_idx" ON "CourseRegistration"("tenantId", "semesterId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRegistration_studentId_courseId_attemptNumber_key" ON "CourseRegistration"("studentId", "courseId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRegistration_tenantId_id_key" ON "CourseRegistration"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_tenantId_evaluationSchemeId_fkey" FOREIGN KEY ("tenantId", "evaluationSchemeId") REFERENCES "EvaluationScheme"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


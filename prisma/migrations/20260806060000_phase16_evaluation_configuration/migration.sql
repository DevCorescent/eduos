-- Phase 16 — Evaluation Configuration (C1–C5)
--
-- GradeScale + GradeBand, EvaluationScheme, EvaluationComponent,
-- EvaluationRule, PassingCriterion, and their enums.
--
-- PURELY ADDITIVE. Generated with:
--   prisma migrate diff --from-schema <pre-phase-16> --to-schema prisma/schema.prisma --script
-- and audited: no DROP TABLE, no DROP COLUMN, no ALTER COLUMN, no DROP
-- CONSTRAINT, no data movement. Nothing existing is touched, so this cannot
-- fail on populated data and needs no backfill.

-- CreateEnum
CREATE TYPE "EvaluationSchemeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptPolicy" AS ENUM ('BEST_ATTEMPT', 'LATEST_ATTEMPT', 'FIRST_ATTEMPT', 'ALL_ATTEMPTS');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'FLOOR', 'CEILING');

-- CreateEnum
CREATE TYPE "EvaluationComponentType" AS ENUM ('THEORY', 'PRACTICAL', 'VIVA', 'LAB', 'ASSIGNMENT', 'QUIZ', 'ATTENDANCE', 'PROJECT', 'SEMINAR', 'PRESENTATION', 'INTERNAL', 'EXTERNAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ComponentAggregation" AS ENUM ('SUM', 'AVERAGE', 'BEST_N', 'DROP_LOWEST_N', 'MAX', 'LATEST');

-- CreateEnum
CREATE TYPE "ComponentRollup" AS ENUM ('WEIGHTED_SUM', 'SUM', 'AVERAGE');

-- CreateEnum
CREATE TYPE "PassingMetric" AS ENUM ('COMPONENT_SCORE', 'ATTENDANCE_PERCENT', 'SEMESTER_CREDITS_EARNED');

-- CreateEnum
CREATE TYPE "ThresholdUnit" AS ENUM ('MARKS', 'PERCENT', 'CREDITS');

-- CreateEnum
CREATE TYPE "CriterionOutcome" AS ENUM ('FAIL', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "RulePhase" AS ENUM ('SESSION_ADJUSTMENT', 'COMPONENT_ADJUSTMENT', 'COURSE_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RuleOperation" AS ENUM ('ADD_CONSTANT', 'ADD_PERCENTAGE', 'SCALE', 'CAP', 'FLOOR', 'GRACE', 'MODERATION', 'CURVE', 'CUSTOM_FORMULA');

-- CreateEnum
CREATE TYPE "ComponentSource" AS ENUM ('MANUAL_ENTRY', 'ATTENDANCE_DERIVED', 'ASSIGNMENT_DERIVED', 'COMPUTED');

-- CreateEnum
CREATE TYPE "GradeScaleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GradeCalculationMethod" AS ENUM ('ABSOLUTE', 'RELATIVE');

-- CreateEnum
CREATE TYPE "ResultPublicationStatus" AS ENUM ('DRAFT', 'VERIFIED', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('GENERATED', 'VERIFIED', 'ISSUED');

-- CreateTable
CREATE TABLE "GradeScale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "GradeScaleStatus" NOT NULL DEFAULT 'DRAFT',
    "method" "GradeCalculationMethod" NOT NULL DEFAULT 'ABSOLUTE',
    "methodConfig" JSONB,
    "maxGradePoint" DECIMAL(4,2) NOT NULL,
    "supersededById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gradeScaleId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "label" TEXT,
    "minPercent" DECIMAL(5,2) NOT NULL,
    "maxPercent" DECIMAL(5,2) NOT NULL,
    "gradePoint" DECIMAL(4,2) NOT NULL,
    "isPass" BOOLEAN NOT NULL DEFAULT true,
    "countsForGpa" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationScheme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "EvaluationSchemeStatus" NOT NULL DEFAULT 'DRAFT',
    "gradeScaleId" TEXT NOT NULL,
    "attemptPolicy" "AttemptPolicy" NOT NULL DEFAULT 'LATEST_ATTEMPT',
    "marksRounding" "RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "marksPrecision" INTEGER NOT NULL DEFAULT 2,
    "gpaRounding" "RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "gpaPrecision" INTEGER NOT NULL DEFAULT 2,
    "supersededById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationComponent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "parentComponentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "EvaluationComponentType" NOT NULL,
    "sourceType" "ComponentSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "maxMarks" DECIMAL(6,2) NOT NULL,
    "weightage" DECIMAL(5,2) NOT NULL,
    "aggregation" "ComponentAggregation",
    "rollup" "ComponentRollup",
    "ruleConfig" JSONB,
    "sequence" INTEGER NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "componentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "phase" "RulePhase" NOT NULL,
    "operation" "RuleOperation" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "config" JSONB,
    "condition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassingCriterion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "componentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric" "PassingMetric" NOT NULL,
    "threshold" DECIMAL(6,2) NOT NULL,
    "unit" "ThresholdUnit" NOT NULL,
    "failureOutcome" "CriterionOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassingCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeScale_tenantId_status_idx" ON "GradeScale"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GradeScale_tenantId_supersededById_idx" ON "GradeScale"("tenantId", "supersededById");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScale_tenantId_code_version_key" ON "GradeScale"("tenantId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScale_tenantId_id_key" ON "GradeScale"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_gradeScaleId_grade_key" ON "GradeBand"("gradeScaleId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_gradeScaleId_sequence_key" ON "GradeBand"("gradeScaleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_tenantId_id_key" ON "GradeBand"("tenantId", "id");

-- CreateIndex
CREATE INDEX "EvaluationScheme_tenantId_status_idx" ON "EvaluationScheme"("tenantId", "status");

-- CreateIndex
CREATE INDEX "EvaluationScheme_tenantId_supersededById_idx" ON "EvaluationScheme"("tenantId", "supersededById");

-- CreateIndex
CREATE INDEX "EvaluationScheme_tenantId_gradeScaleId_idx" ON "EvaluationScheme"("tenantId", "gradeScaleId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationScheme_tenantId_code_version_key" ON "EvaluationScheme"("tenantId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationScheme_tenantId_id_key" ON "EvaluationScheme"("tenantId", "id");

-- CreateIndex
CREATE INDEX "EvaluationComponent_tenantId_schemeId_idx" ON "EvaluationComponent"("tenantId", "schemeId");

-- CreateIndex
CREATE INDEX "EvaluationComponent_tenantId_parentComponentId_idx" ON "EvaluationComponent"("tenantId", "parentComponentId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationComponent_schemeId_code_key" ON "EvaluationComponent"("schemeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationComponent_schemeId_parentComponentId_sequence_key" ON "EvaluationComponent"("schemeId", "parentComponentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationComponent_tenantId_id_key" ON "EvaluationComponent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationComponent_tenantId_schemeId_id_key" ON "EvaluationComponent"("tenantId", "schemeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRule_schemeId_code_key" ON "EvaluationRule"("schemeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRule_schemeId_componentId_phase_sequence_key" ON "EvaluationRule"("schemeId", "componentId", "phase", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRule_tenantId_id_key" ON "EvaluationRule"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PassingCriterion_schemeId_componentId_idx" ON "PassingCriterion"("schemeId", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX "PassingCriterion_schemeId_code_key" ON "PassingCriterion"("schemeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PassingCriterion_tenantId_id_key" ON "PassingCriterion"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_tenantId_supersededById_fkey" FOREIGN KEY ("tenantId", "supersededById") REFERENCES "GradeScale"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_tenantId_gradeScaleId_fkey" FOREIGN KEY ("tenantId", "gradeScaleId") REFERENCES "GradeScale"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationScheme" ADD CONSTRAINT "EvaluationScheme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationScheme" ADD CONSTRAINT "EvaluationScheme_tenantId_gradeScaleId_fkey" FOREIGN KEY ("tenantId", "gradeScaleId") REFERENCES "GradeScale"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EvaluationScheme" ADD CONSTRAINT "EvaluationScheme_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationScheme" ADD CONSTRAINT "EvaluationScheme_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationScheme" ADD CONSTRAINT "EvaluationScheme_tenantId_supersededById_fkey" FOREIGN KEY ("tenantId", "supersededById") REFERENCES "EvaluationScheme"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EvaluationComponent" ADD CONSTRAINT "EvaluationComponent_tenantId_schemeId_fkey" FOREIGN KEY ("tenantId", "schemeId") REFERENCES "EvaluationScheme"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationComponent" ADD CONSTRAINT "EvaluationComponent_tenantId_schemeId_parentComponentId_fkey" FOREIGN KEY ("tenantId", "schemeId", "parentComponentId") REFERENCES "EvaluationComponent"("tenantId", "schemeId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_tenantId_schemeId_fkey" FOREIGN KEY ("tenantId", "schemeId") REFERENCES "EvaluationScheme"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_tenantId_schemeId_componentId_fkey" FOREIGN KEY ("tenantId", "schemeId", "componentId") REFERENCES "EvaluationComponent"("tenantId", "schemeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassingCriterion" ADD CONSTRAINT "PassingCriterion_tenantId_schemeId_fkey" FOREIGN KEY ("tenantId", "schemeId") REFERENCES "EvaluationScheme"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassingCriterion" ADD CONSTRAINT "PassingCriterion_tenantId_schemeId_componentId_fkey" FOREIGN KEY ("tenantId", "schemeId", "componentId") REFERENCES "EvaluationComponent"("tenantId", "schemeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- MIGRATION : Phases 21-27
--             Student Permissions · Attendance Lock & Audit · Faculty Profile
--             & Analytics · Assignment Enhancement · AI Internal Assessment ·
--             Exam Resource Repository · Notification Center & Announcements
--
-- PURPOSE   : Add nine tables and six enums, and extend exactly two existing
--             tables with nullable columns.
--
-- GENERATED, NOT HAND-WRITTEN
--   Produced by `prisma migrate diff --from-schema <HEAD> --to-schema <new>`,
--   so it cannot disagree with the schema it was derived from. Only the header
--   and the single pre-flight UPDATE described below were added by hand.
--
-- WHAT IT TOUCHES OUTSIDE PHASES 21-27, AND WHY
--   Two tables, both additively:
--
--     FacultyMember  ADD COLUMN "photoUrl"    (nullable)
--     Notification   ADD COLUMN "archivedAt"  (nullable)
--                    ADD COLUMN "category"    (nullable)
--                    ADD COLUMN "deletedAt"   (nullable)
--                    ADD CONSTRAINT ... FOREIGN KEY ("userId")
--                    CREATE INDEX on (userId, deletedAt, archivedAt, createdAt)
--
--   Machine-checked before this file was written:
--     grep '^ALTER TABLE' | grep -v <the nine new tables>   ->  3 lines, above
--     grep -cE '^(DROP|ALTER TABLE .* DROP)'                ->  0
--
--   No existing column changes type, nullability or default. No existing index
--   or constraint is dropped or rebuilt. Every Phase 1-20 write path continues
--   to write exactly the columns it wrote before, and reads back the same
--   shape. The back-relations added to User, Student, Course, Section,
--   Semester, Department, Batch and AssignmentSubmission are virtual in Prisma
--   and emit no DDL at all — which is why they do not appear here.
--
-- THE ONE HAND-ADDED STATEMENT: NULLING DANGLING Notification.userId
--   Notification.userId has been a bare unconstrained string since the initial
--   migration — no foreign key, no validation (the TD-C / TD-C41 family). Phase
--   27 adds the missing constraint, and PostgreSQL validates a new FOREIGN KEY
--   against every existing row: one notification whose userId names a user that
--   was since hard-deleted by DELETE /api/users/[id] would abort the entire
--   migration.
--
--   The UPDATE below sets such orphans to NULL first. It is deliberately
--   narrow — it touches ONLY rows whose userId already references nothing, and
--   a value referencing nothing is precisely a row the Notification Center
--   could never deliver to anyone. No row with a resolvable recipient is
--   modified, and no other column is written. NULL is also the column's
--   pre-existing meaning for "no specific recipient", so nothing gains a
--   meaning it did not have.
--
--   Ordering matters: the UPDATE must run BEFORE the ADD CONSTRAINT, or the
--   constraint fails on exactly the rows the UPDATE exists to clear.
--
-- LOCK PROFILE
--   CREATE TABLE / CREATE INDEX on the nine brand-new empty tables take no lock
--   a concurrent reader can observe. ADD COLUMN ... NULL with no default is a
--   catalogue-only change in PostgreSQL 11+ and does not rewrite the table.
--   Each ADD CONSTRAINT ... FOREIGN KEY takes a SHARE ROW EXCLUSIVE on the
--   referenced table for the length of the statement. The one statement worth
--   noting is the Notification foreign key, which validates against every
--   existing Notification row — on a large table that is a full scan, so apply
--   it during a quiet window.
--
-- REVERSIBILITY
--   ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
--   DROP INDEX "Notification_userId_deletedAt_archivedAt_createdAt_idx";
--   ALTER TABLE "Notification"  DROP COLUMN "category",
--                               DROP COLUMN "archivedAt",
--                               DROP COLUMN "deletedAt";
--   ALTER TABLE "FacultyMember" DROP COLUMN "photoUrl";
--   DROP TABLE "AnnouncementRead", "Announcement", "ExamResource",
--              "InternalAssessmentSuggestion", "AssignmentSubmissionVersion",
--              "FacultyEducation", "FacultyCertification",
--              "FacultyPublication", "AttendanceLock";
--   DROP TYPE  "AnnouncementStatus", "AnnouncementAudience",
--              "NotificationCategory", "ExamResourceStatus",
--              "ExamResourceType", "AttendanceLockStatus";
--
--   The nulled Notification.userId values are NOT recoverable by this rollback.
--   They referenced deleted users and were already unresolvable.
-- ============================================================================


-- CreateEnum
CREATE TYPE "AttendanceLockStatus" AS ENUM ('LOCKED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "ExamResourceType" AS ENUM ('QUESTION_PAPER', 'SOLUTION', 'MARKING_SCHEME', 'ANSWER_KEY', 'REFERENCE_MATERIAL', 'FORMULA_SHEET');

-- CreateEnum
CREATE TYPE "ExamResourceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ACADEMIC', 'ATTENDANCE', 'ASSIGNMENT', 'RESULT', 'FEE', 'CERTIFICATE', 'TIMETABLE', 'AI', 'FINANCE', 'ANNOUNCEMENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('INSTITUTION', 'DEPARTMENT', 'BATCH', 'SECTION');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "FacultyMember" ADD COLUMN     "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "category" "NotificationCategory",
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AttendanceLock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "status" "AttendanceLockStatus" NOT NULL DEFAULT 'LOCKED',
    "reason" TEXT,
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "unlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPublication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "identifier" TEXT,
    "url" TEXT,
    "publishedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyCertification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "url" TEXT,
    "issuedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyEducation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "fieldOfStudy" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "grade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmissionVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL,
    "attachments" JSONB,
    "submittedAt" TIMESTAMP(3),
    "marks" INTEGER,
    "feedback" TEXT,
    "gradedAt" TIMESTAMP(3),
    "gradedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentSubmissionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalAssessmentSuggestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "suggestedMarks" DECIMAL(6,2),
    "confidence" DECIMAL(4,3),
    "factors" JSONB,
    "rationale" TEXT,
    "aiModel" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalMarks" DECIMAL(6,2),
    "overrideReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalAssessmentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "departmentId" TEXT,
    "examinationId" TEXT,
    "type" "ExamResourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "academicYear" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "status" "ExamResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledPublishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL DEFAULT 'ANNOUNCEMENT',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'INSTITUTION',
    "departmentId" TEXT,
    "batchId" TEXT,
    "sectionId" TEXT,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceLock_tenantId_status_idx" ON "AttendanceLock"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AttendanceLock_courseId_idx" ON "AttendanceLock"("courseId");

-- CreateIndex
CREATE INDEX "AttendanceLock_sectionId_idx" ON "AttendanceLock"("sectionId");

-- CreateIndex
CREATE INDEX "AttendanceLock_semesterId_idx" ON "AttendanceLock"("semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLock_tenantId_courseId_sectionId_semesterId_key" ON "AttendanceLock"("tenantId", "courseId", "sectionId", "semesterId");

-- CreateIndex
CREATE INDEX "FacultyPublication_tenantId_facultyId_publishedOn_idx" ON "FacultyPublication"("tenantId", "facultyId", "publishedOn");

-- CreateIndex
CREATE INDEX "FacultyPublication_facultyId_idx" ON "FacultyPublication"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyCertification_tenantId_facultyId_issuedOn_idx" ON "FacultyCertification"("tenantId", "facultyId", "issuedOn");

-- CreateIndex
CREATE INDEX "FacultyCertification_facultyId_idx" ON "FacultyCertification"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyEducation_tenantId_facultyId_endYear_idx" ON "FacultyEducation"("tenantId", "facultyId", "endYear");

-- CreateIndex
CREATE INDEX "FacultyEducation_facultyId_idx" ON "FacultyEducation"("facultyId");

-- CreateIndex
CREATE INDEX "AssignmentSubmissionVersion_submissionId_idx" ON "AssignmentSubmissionVersion"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmissionVersion_submissionId_attempt_key" ON "AssignmentSubmissionVersion"("submissionId", "attempt");

-- CreateIndex
CREATE INDEX "InternalAssessmentSuggestion_tenantId_courseId_semesterId_idx" ON "InternalAssessmentSuggestion"("tenantId", "courseId", "semesterId");

-- CreateIndex
CREATE INDEX "InternalAssessmentSuggestion_studentId_idx" ON "InternalAssessmentSuggestion"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalAssessmentSuggestion_tenantId_studentId_courseId_se_key" ON "InternalAssessmentSuggestion"("tenantId", "studentId", "courseId", "semesterId", "componentId");

-- CreateIndex
CREATE INDEX "ExamResource_tenantId_status_courseId_semesterId_idx" ON "ExamResource"("tenantId", "status", "courseId", "semesterId");

-- CreateIndex
CREATE INDEX "ExamResource_tenantId_departmentId_status_idx" ON "ExamResource"("tenantId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "ExamResource_tenantId_academicYear_idx" ON "ExamResource"("tenantId", "academicYear");

-- CreateIndex
CREATE INDEX "ExamResource_courseId_idx" ON "ExamResource"("courseId");

-- CreateIndex
CREATE INDEX "ExamResource_semesterId_idx" ON "ExamResource"("semesterId");

-- CreateIndex
CREATE INDEX "ExamResource_uploadedById_idx" ON "ExamResource"("uploadedById");

-- CreateIndex
CREATE INDEX "Announcement_tenantId_status_isPinned_publishAt_idx" ON "Announcement"("tenantId", "status", "isPinned", "publishAt");

-- CreateIndex
CREATE INDEX "Announcement_departmentId_idx" ON "Announcement"("departmentId");

-- CreateIndex
CREATE INDEX "Announcement_batchId_idx" ON "Announcement"("batchId");

-- CreateIndex
CREATE INDEX "Announcement_sectionId_idx" ON "Announcement"("sectionId");

-- CreateIndex
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "Notification_userId_deletedAt_archivedAt_createdAt_idx" ON "Notification"("userId", "deletedAt", "archivedAt", "createdAt");

-- PreFlight (hand-added; see the header for the full rationale)
-- Clear Notification.userId values that reference no User, so the foreign
-- key below can be validated. Touches only already-dangling rows.
UPDATE "Notification" n
   SET "userId" = NULL
 WHERE n."userId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = n."userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLock" ADD CONSTRAINT "AttendanceLock_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLock" ADD CONSTRAINT "AttendanceLock_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLock" ADD CONSTRAINT "AttendanceLock_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLock" ADD CONSTRAINT "AttendanceLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLock" ADD CONSTRAINT "AttendanceLock_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPublication" ADD CONSTRAINT "FacultyPublication_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "FacultyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyCertification" ADD CONSTRAINT "FacultyCertification_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "FacultyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyEducation" ADD CONSTRAINT "FacultyEducation_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "FacultyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmissionVersion" ADD CONSTRAINT "AssignmentSubmissionVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAssessmentSuggestion" ADD CONSTRAINT "InternalAssessmentSuggestion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAssessmentSuggestion" ADD CONSTRAINT "InternalAssessmentSuggestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAssessmentSuggestion" ADD CONSTRAINT "InternalAssessmentSuggestion_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAssessmentSuggestion" ADD CONSTRAINT "InternalAssessmentSuggestion_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAssessmentSuggestion" ADD CONSTRAINT "InternalAssessmentSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResource" ADD CONSTRAINT "ExamResource_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResource" ADD CONSTRAINT "ExamResource_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResource" ADD CONSTRAINT "ExamResource_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResource" ADD CONSTRAINT "ExamResource_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResource" ADD CONSTRAINT "ExamResource_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


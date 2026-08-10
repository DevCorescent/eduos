-- W3 Admissions (PRD §8.2, §8.5, §9.1, §49.2)
--
-- PURELY ADDITIVE. One enum, two tables, their indexes and foreign keys.
-- No DROP, no DELETE, no TRUNCATE, no change to any existing table's columns.
-- The two back-relations added to Programme, Tenant and Student are virtual —
-- Prisma emits no DDL for them.
--
-- WHY A NEW MODEL IS CORRECT HERE
--   An Application describes somebody who is NOT yet a student. Student
--   requires a userId and an enrollmentNo; an applicant has neither and may
--   never have either. Reusing Student would mean creating accounts and
--   enrolment numbers for people who have not been admitted, which is the
--   opposite of what §8.5 describes — conversion is the moment those come into
--   existence. Nothing here duplicates Student, User or Parent.
--
-- THE STAGE LIST IS PRD §49.2's, VERBATIM
--   "Lead → Counselling → Application → Document Verification → Eligibility
--   Check → Entrance Examination → Merit or Selection → Offer Letter → Fee
--   Payment → Student ID Generation → Course Allocation → Portal Activation".
--   §8 defines no status vocabulary of its own, so no other value exists.
--
-- IDENTIFIERS ARE THE ENGINE'S
--   applicantNo and applicationNo carry NO default and no autoincrement. PRD
--   §9.1 names "Applicant ID" and "Application number", and the existing WP-1
--   identifier engine issues both. A database default would be a second
--   numbering system.
--
-- WHAT IS DELIBERATELY ABSENT
--   No payment, document-verification, merit, seat, category, hostel or
--   transport column. §8 names those capabilities and defines no mechanism for
--   any of them, so nothing models them. Recorded in TECHNICAL_DEBT.md.
--
-- HAND-WRITTEN, for the same reason as the six migrations before it:
-- `prisma migrate dev` reports drift against the `playing_with_neon` table and
-- proposes `migrate reset`, which drops every table on the shared Neon database.

CREATE TYPE "AdmissionStage" AS ENUM (
  'LEAD',
  'COUNSELLING',
  'APPLICATION',
  'DOCUMENT_VERIFICATION',
  'ELIGIBILITY_CHECK',
  'ENTRANCE_EXAMINATION',
  'MERIT_OR_SELECTION',
  'OFFER_LETTER',
  'FEE_PAYMENT',
  'STUDENT_ID_GENERATION',
  'COURSE_ALLOCATION',
  'PORTAL_ACTIVATION'
);

CREATE TABLE "Application" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "applicantNo"      TEXT NOT NULL,
    "applicationNo"    TEXT NOT NULL,
    "firstName"        TEXT NOT NULL,
    "lastName"         TEXT NOT NULL,
    "email"            TEXT NOT NULL,
    "phone"            TEXT,
    "dateOfBirth"      TIMESTAMP(3),
    "guardianName"     TEXT,
    "guardianRelation" TEXT,
    "guardianPhone"    TEXT,
    "guardianEmail"    TEXT,
    "educationHistory" JSONB,
    "workHistory"      JSONB,
    "stage"            "AdmissionStage" NOT NULL DEFAULT 'LEAD',
    "studentId"        TEXT,
    "convertedAt"      TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationPreference" (
    "applicationId" TEXT NOT NULL,
    "programmeId"   TEXT NOT NULL,
    "priority"      INTEGER NOT NULL,
    CONSTRAINT "ApplicationPreference_pkey" PRIMARY KEY ("applicationId","programmeId")
);

-- One student per application, enforced by the database rather than by a
-- service check: this is what makes duplicate conversion impossible.
CREATE UNIQUE INDEX "Application_studentId_key" ON "Application"("studentId");

-- Both identifiers unique per tenant, matching every other identifier here.
-- The email too — §8.3 "Duplicate application detection".
CREATE UNIQUE INDEX "Application_tenantId_applicationNo_key" ON "Application"("tenantId","applicationNo");
CREATE UNIQUE INDEX "Application_tenantId_applicantNo_key"   ON "Application"("tenantId","applicantNo");
CREATE UNIQUE INDEX "Application_tenantId_email_key"         ON "Application"("tenantId","email");

CREATE INDEX "Application_tenantId_idx"            ON "Application"("tenantId");
CREATE INDEX "Application_tenantId_stage_idx"      ON "Application"("tenantId","stage");
CREATE INDEX "ApplicationPreference_applicationId_idx" ON "ApplicationPreference"("applicationId");

-- CASCADE from Tenant: a deleted university's applications have nothing left to
-- describe. RESTRICT-by-default from Student: an application must not be able
-- to delete the student it produced.
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Application"
  ADD CONSTRAINT "Application_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApplicationPreference"
  ADD CONSTRAINT "ApplicationPreference_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationPreference"
  ADD CONSTRAINT "ApplicationPreference_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

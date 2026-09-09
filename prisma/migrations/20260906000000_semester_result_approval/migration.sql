-- Semester Result Approval — PRD §17.4 "Result approval" · §49.4 stage 8.
--
-- PURELY ADDITIVE. One table, two lookup indexes, one unique index and two
-- foreign keys. No existing column is altered or dropped, no existing row is
-- touched, and no enum is created. Rolling back is a single DROP TABLE of
-- something nothing else references.
--
-- NO "CreateEnum" STATEMENT, DELIBERATELY
--   "ResultPublicationStatus" ('DRAFT','VERIFIED','APPROVED','PUBLISHED') was
--   already created by 20260806060000_phase16_evaluation_configuration and has
--   sat in the database ever since with NO column using it — verified against
--   the live schema: information_schema.columns returns zero rows for that
--   udt_name. This migration is what finally attaches it to a table. Creating
--   it again here would fail with 42710 on every existing database.
--
-- WHY A TABLE AT ALL, WHEN PUBLICATION GOT NONE
--   lib/constants/result.ts records that publication "DELIBERATELY GETS NO NEW
--   TABLE" because it is DERIVABLE: a result is publishable exactly when every
--   sitting feeding it is PUBLISHED, so the state is read from AssessmentEvent
--   rather than copied into a second source that could disagree.
--
--   Approval is not derivable. It is an act by a named person at a point in
--   time, and WHO and WHEN are precisely the facts a sign-off exists to record.
--   No arrangement of marks can be recomputed into them. A semester result is
--   itself computed on every request and persists nothing, so before this table
--   there was no row anywhere that could carry the decision.
--
-- ONE ROW PER (tenantId, semesterId)
--   Approval is a statement about a COHORT, not about a student or a paper.
--   The unique index is also the lookup the results page makes on every read,
--   so no second index is created for it.
--
--   Absence of a row means DRAFT. Nothing pre-creates rows: a semester nobody
--   has approved is indistinguishable from one explicitly marked DRAFT, and
--   seeding one row per semester would be state with no decision behind it.
--
-- ON DELETE
--   semesterId  NO ACTION — a semester whose results have been signed off must
--               not be deletable out from under that sign-off. Matches
--               AssessmentEvent's treatment of the same column.
--   approvedById SET NULL — DELETE /api/users/[id] is a hard delete that a
--               RESTRICT here would start rejecting. AuditLog carries the
--               actor record that must outlive the user row.
--
-- HAND-WRITTEN, like every migration in this project since W1.2: `prisma
-- migrate dev` reports drift against the `playing_with_neon` table and proposes
-- `migrate reset`, which would drop every table on the shared Neon database.

CREATE TABLE "SemesterResultApproval" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "semesterId"   TEXT NOT NULL,
    "status"       "ResultPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt"   TIMESTAMP(3),
    "approvedById" TEXT,
    "remarks"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemesterResultApproval_pkey" PRIMARY KEY ("id")
);

-- One sign-off per cohort. This is both the invariant and the read path: the
-- Semester Results page looks the row up by exactly this pair.
CREATE UNIQUE INDEX "SemesterResultApproval_tenantId_semesterId_key"
    ON "SemesterResultApproval"("tenantId", "semesterId");

-- "Which semesters has this university approved" — the examination office's
-- own worklist.
CREATE INDEX "SemesterResultApproval_tenantId_status_idx"
    ON "SemesterResultApproval"("tenantId", "status");

CREATE INDEX "SemesterResultApproval_approvedById_idx"
    ON "SemesterResultApproval"("approvedById");

ALTER TABLE "SemesterResultApproval"
    ADD CONSTRAINT "SemesterResultApproval_semesterId_fkey"
    FOREIGN KEY ("semesterId") REFERENCES "Semester"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "SemesterResultApproval"
    ADD CONSTRAINT "SemesterResultApproval_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

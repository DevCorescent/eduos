-- Attendance correction requests — PRD §13.2
--   "Attendance correction requests" · "Faculty approval" · "Academic admin approval"
--
-- PURELY ADDITIVE. One enum, one table, three lookup indexes, one PARTIAL unique
-- index and three foreign keys. No existing column is altered or dropped and no
-- existing row is touched. Rolling back is a DROP TABLE plus DROP TYPE of things
-- nothing else references.
--
-- WHY A REQUEST TABLE RATHER THAN A PATCH HANDLER
--   Attendance has no updatedAt column, and markedAt/markedBy describe the
--   ORIGINAL mark. Editing a row in place would silently rewrite who recorded
--   what and when — the exact history an attendance dispute turns on. The
--   request records the change as its own fact and leaves the register's
--   provenance intact.
--
-- THE PARTIAL UNIQUE INDEX IS THE POINT
--   "One unresolved request per attendance record" is a rule about PENDING rows
--   only. A plain UNIQUE on attendanceId would forbid a second correction after
--   the first was decided, which is wrong — a register may legitimately be
--   corrected more than once over a term.
--
--   Prisma's schema language cannot express a partial unique index, so it is
--   created here and the service catches the resulting 23505 as a conflict. The
--   database is the guarantee; the service's pre-check only produces a readable
--   message.
--
-- ON DELETE
--   attendanceId CASCADEs: a correction request for a record that no longer
--   exists describes nothing, and the AuditLog carries the history that must
--   outlive the row.
--   requestedById / reviewedById SET NULL: deleting a user account must never
--   delete the evidence that a correction was requested or decided.
--
-- HAND-WRITTEN, like every migration in this project since W1.2: `prisma
-- migrate dev` reports drift against the `playing_with_neon` table and proposes
-- `migrate reset`, which would drop every table on the shared Neon database.

CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "AttendanceCorrectionRequest" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "attendanceId"    TEXT NOT NULL,
    "currentStatus"   "AttendanceStatus" NOT NULL,
    "requestedStatus" "AttendanceStatus" NOT NULL,
    "reason"          TEXT NOT NULL,
    "status"          "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById"   TEXT,
    "requestedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById"    TEXT,
    "reviewedAt"      TIMESTAMP(3),
    "reviewNote"      TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCorrectionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceCorrectionRequest_tenantId_status_idx"
    ON "AttendanceCorrectionRequest"("tenantId", "status");
CREATE INDEX "AttendanceCorrectionRequest_attendanceId_idx"
    ON "AttendanceCorrectionRequest"("attendanceId");
CREATE INDEX "AttendanceCorrectionRequest_requestedById_idx"
    ON "AttendanceCorrectionRequest"("requestedById");

-- At most ONE unresolved request per attendance record. Decided rows are
-- excluded, so the same record may be corrected again later.
CREATE UNIQUE INDEX "AttendanceCorrectionRequest_one_pending_per_record"
    ON "AttendanceCorrectionRequest"("attendanceId")
    WHERE "status" = 'PENDING';

ALTER TABLE "AttendanceCorrectionRequest"
    ADD CONSTRAINT "AttendanceCorrectionRequest_attendanceId_fkey"
    FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceCorrectionRequest"
    ADD CONSTRAINT "AttendanceCorrectionRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttendanceCorrectionRequest"
    ADD CONSTRAINT "AttendanceCorrectionRequest_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

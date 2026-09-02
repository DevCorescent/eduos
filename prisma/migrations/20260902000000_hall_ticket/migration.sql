-- Hall Ticket — PRD §17.2 "Hall-ticket generation", §19.1 "Examination hall ticket"
--
-- PURELY ADDITIVE. One new table, two unique indexes, three lookup indexes and
-- two foreign keys. No column on any existing table is altered, dropped or
-- backfilled, and no existing row is touched. Rolling this back is a DROP TABLE
-- of a table nothing else references.
--
-- WHY A TABLE AND NOT A DERIVED VIEW
--   Examination eligibility IS derived — it is recomputed from the enrolment
--   and the attendance register every time it is asked for, and storing it
--   would be a cache that could disagree with its inputs. A hall ticket is the
--   opposite: it records that a document WAS ISSUED, to whom, and when. That
--   fact is not recoverable from anything else, so it is stored.
--
-- WHY NOT THE Certificate TABLE
--   Certificate requires a templateId and carries no examination column. A hall
--   ticket must cite the examination whose venue, date and time it prints and
--   must be unique per (examination, student); through Certificate that would
--   be an examinationId inside an unqueryable Json column with no foreign key
--   and no uniqueness constraint.
--
-- ON DELETE
--   examinationId CASCADEs: a hall ticket for an examination that no longer
--   exists is meaningless, and leaving orphans would let a re-created
--   examination inherit stale tickets.
--   studentId RESTRICTs (the default): a student with issued tickets must not
--   be deleted out from under the examination record.
--
-- HAND-WRITTEN, like every migration in this project since W1.2: `prisma
-- migrate dev` reports drift against the `playing_with_neon` table and proposes
-- `migrate reset`, which would drop every table on the shared Neon database.

CREATE TABLE "HallTicket" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "examinationId" TEXT NOT NULL,
    "studentId"     TEXT NOT NULL,
    "ticketNo"      TEXT NOT NULL,
    "seatNo"        TEXT,
    "issuedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById"    TEXT,

    CONSTRAINT "HallTicket_pkey" PRIMARY KEY ("id")
);

-- One ticket per student per examination. This is what makes generation
-- idempotent: a re-run updates rather than issuing a duplicate.
CREATE UNIQUE INDEX "HallTicket_examinationId_studentId_key"
    ON "HallTicket"("examinationId", "studentId");

-- The printed identity, unique within the university.
CREATE UNIQUE INDEX "HallTicket_tenantId_ticketNo_key"
    ON "HallTicket"("tenantId", "ticketNo");

CREATE INDEX "HallTicket_tenantId_idx" ON "HallTicket"("tenantId");
CREATE INDEX "HallTicket_studentId_idx" ON "HallTicket"("studentId");
CREATE INDEX "HallTicket_examinationId_idx" ON "HallTicket"("examinationId");

ALTER TABLE "HallTicket"
    ADD CONSTRAINT "HallTicket_examinationId_fkey"
    FOREIGN KEY ("examinationId") REFERENCES "Examination"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HallTicket"
    ADD CONSTRAINT "HallTicket_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- HOD → Department link (department-scoped authorization)
--
-- PURELY ADDITIVE. One nullable column, one unique index, one foreign key.
-- No DROP, no DELETE, no TRUNCATE, no backfill, no change to any existing
-- column. Every Department row that exists today remains valid with the new
-- column NULL.
--
-- WHY THIS EXISTS
--   Department-scoped authorization has to answer, on the server, "which
--   department does this authenticated user head?". The only thing linking a
--   head to a department was `Department.hodName`, which is free text: it
--   matches no row, it is not unique, and it is client-supplied. Authorization
--   cannot be built on it. This column is the authoritative link.
--
-- WHY NULLABLE
--   Making it NOT NULL would require every existing department to already have
--   a head, which none of them do — the migration would fail on the first row.
--   Nullable is also the correct domain model: a department between heads is an
--   ordinary state. A HOD whose department is unset is REFUSED by the scope
--   guard rather than defaulting to "every department"; the application fails
--   closed so the nullable column cannot become an escalation.
--
-- WHY UNIQUE
--   MVP is ONE HOD → ONE DEPARTMENT. The index is that rule, enforced by the
--   database rather than by a service check that a second code path could miss.
--   It also lets the scope lookup be a findUnique. Widening to multi-department
--   headship later means dropping this index, not redesigning the relation.
--
-- ON DELETE SET NULL
--   Deleting a user account must not cascade away a department, its programmes
--   and its students. The department simply loses its head.
--
-- HAND-WRITTEN, like every migration in this project since W1.2: `prisma
-- migrate dev` reports drift against the `playing_with_neon` table and proposes
-- `migrate reset`, which would drop every table on the shared Neon database.

ALTER TABLE "Department" ADD COLUMN "hodUserId" TEXT;

CREATE UNIQUE INDEX "Department_hodUserId_key" ON "Department"("hodUserId");

ALTER TABLE "Department"
  ADD CONSTRAINT "Department_hodUserId_fkey"
  FOREIGN KEY ("hodUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

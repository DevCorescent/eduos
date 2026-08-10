-- W2 Parent Portal — the account link (PRD §32)
--
-- PURELY ADDITIVE. One nullable column, one unique index, one foreign key.
-- No DROP, no DELETE, no TRUNCATE, no change to any existing column.
--
-- WHY THIS COLUMN IS THE WHOLE OF W2'S SCHEMA CHANGE
--   §32 asks for a Parent and Guardian Portal, which requires a parent to sign
--   in. `Parent` had no link to `User` at all: `User` declared `student`,
--   `faculty` and `employee` and nothing else, so there was no path from an
--   authenticated session to a Parent row, and therefore none to
--   StudentParent → Student. The authorization chain could not be evaluated.
--
--   Everything else W2 needs already exists. StudentParent is the parent-child
--   relationship and is reused unchanged — no second relationship model is
--   introduced, and because it is many-to-many one Parent row serves several
--   children.
--
-- NULLABLE, DELIBERATELY
--   Parent is also a CONTACT record. Every row that exists today was created as
--   guardian information against a student, with no account behind it. A NOT
--   NULL column would invalidate all of them, so accounts are opt-in and the
--   contact rows keep working exactly as before.
--
-- UNIQUE, AND NOT email
--   One account is one parent, mirroring Student.userId, FacultyMember.userId
--   and Employee.userId. Parent.email is optional AND non-unique, so it could
--   never decide who a signed-in parent is; this column is the only source of
--   truth for parent authorization.
--
-- ON DELETE SET NULL
--   Deleting a User must not delete the guardian's contact record off the
--   student. The account goes; the contact information stays.
--
-- HAND-WRITTEN, for the same reason as the five migrations before it:
-- `prisma migrate dev` reports drift against the `playing_with_neon` table and
-- proposes `migrate reset`, which drops every table on the shared Neon database.

ALTER TABLE "Parent" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "Parent_userId_key" ON "Parent"("userId");

ALTER TABLE "Parent"
  ADD CONSTRAINT "Parent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

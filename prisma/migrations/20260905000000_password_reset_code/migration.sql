-- Password reset codes — tester issue #15, README "POST /api/auth/forgot-password".
--
-- PURELY ADDITIVE. One table, three lookup indexes and two foreign keys. No
-- existing column is altered or dropped and no existing row is touched.
-- Rolling back is a single DROP TABLE of something nothing else references.
--
-- WHY A TABLE RATHER THAN COLUMNS ON "User"
--   A reset is an event with a lifetime — issued, expiring, consumed — not a
--   property of the account. As columns those facts would have no history, and
--   "has this code already been used" would become unanswerable the moment the
--   next code was issued.
--
-- ONLY THE HASH IS STORED
--   "codeHash" holds a bcrypt hash of the six digits, written with the same
--   helper the password column uses. A plaintext column would let anyone who
--   can read this table take over any account, which is precisely what a reset
--   flow must not permit.
--
-- TENANT AND USER BOTH
--   userId alone identifies the account, but every lookup in this codebase is
--   tenant-scoped and two universities can hold the same email address. The
--   tenant column is what stops a code being checkable across institutions.
--
-- ON DELETE CASCADE on both foreign keys: an outstanding reset code for a
-- deleted user, or a deleted university, is meaningless and must not outlive
-- the row it belongs to.

CREATE TABLE "PasswordResetCode" (
    "id"          TEXT         NOT NULL,
    "tenantId"    TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "codeHash"    TEXT         NOT NULL,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "consumedAt"  TIMESTAMP(3),
    "requestedIp" TEXT,
    "userAgent"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetCode_pkey" PRIMARY KEY ("id")
);

-- The lookup the reset endpoint performs: this user's live codes, newest first.
CREATE INDEX "PasswordResetCode_userId_consumedAt_idx"
    ON "PasswordResetCode"("userId", "consumedAt");

-- Tenant-scoped cleanup and reporting.
CREATE INDEX "PasswordResetCode_tenantId_idx"
    ON "PasswordResetCode"("tenantId");

-- Expiry sweeps.
CREATE INDEX "PasswordResetCode_expiresAt_idx"
    ON "PasswordResetCode"("expiresAt");

ALTER TABLE "PasswordResetCode"
    ADD CONSTRAINT "PasswordResetCode_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PasswordResetCode"
    ADD CONSTRAINT "PasswordResetCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

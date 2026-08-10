-- W1.2 Platform Identity (security fix for the W1.1 escalation finding)
--
-- PURELY ADDITIVE. Three new tables, their indexes and foreign keys.
-- No DROP, no DELETE, no TRUNCATE, no change to any existing table.
--
-- The DATA migration — moving superadmin@eduos.local onto PlatformUser and
-- removing the tenant SUPER_ADMIN grants — is deliberately NOT in this file.
-- It reads existing rows, reuses a password hash, and must be verifiable step
-- by step; it runs as a separate reviewed script so its effect can be inspected
-- before and after. A migration that silently deletes role grants is exactly
-- the kind of change that should not be buried in DDL.
--
-- HAND-WRITTEN: `prisma migrate dev` still reports drift against the
-- `playing_with_neon` table and proposes `migrate reset`, which drops every
-- table on the shared Neon database.

CREATE TABLE "PlatformUser" (
    "id"           TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName"    TEXT NOT NULL,
    "lastName"     TEXT NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformRole" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformUserRole" (
    "platformUserId" TEXT NOT NULL,
    "platformRoleId" TEXT NOT NULL,
    "grantedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformUserRole_pkey" PRIMARY KEY ("platformUserId","platformRoleId")
);

-- One platform identity per address, and one role per name. Both are what stop
-- a duplicate identity being created alongside a legitimate one.
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");
CREATE INDEX        "PlatformUser_email_idx" ON "PlatformUser"("email");
CREATE UNIQUE INDEX "PlatformRole_name_key"  ON "PlatformRole"("name");
CREATE INDEX "PlatformUserRole_platformUserId_idx" ON "PlatformUserRole"("platformUserId");

ALTER TABLE "PlatformUserRole"
  ADD CONSTRAINT "PlatformUserRole_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformUserRole"
  ADD CONSTRAINT "PlatformUserRole_platformRoleId_fkey"
  FOREIGN KEY ("platformRoleId") REFERENCES "PlatformRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

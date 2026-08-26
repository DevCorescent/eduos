// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Users (W1.3)
// LAYER  : Service — the only module that reads or writes PlatformUser.
// ACCESS : Called exclusively from routes that have already run
//          requirePlatformAdmin(). Nothing here re-checks authorization, and
//          nothing here may be imported by a client component.
//
// WHY THERE IS A SERVICE HERE WHEN THE TENANT ROUTES CALL PRISMA DIRECTLY
//   Three of the five routes must do the same two delicate things: generate a
//   credential and store only its hash. Duplicating that across POST /users and
//   POST /users/[id]/reset-password is how one of the two copies eventually
//   logs the plaintext, or hashes with a different cost. It lives once, here.
//
// THE PASSWORD HASH NEVER LEAVES THIS MODULE
//   Every read below selects an explicit column list that omits passwordHash.
//   That is not tidiness: `findMany()` with no select returns it, and the route
//   above serialises whatever it is handed straight into the response body.
// ============================================================================

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type {
  CreatePlatformUserInput,
  ListPlatformUsersQuery,
  UpdatePlatformUserInput,
} from "@/lib/validations/platform";

/**
 * The columns a platform user is ever exposed through.
 *
 * passwordHash is absent by construction rather than deleted afterwards — a
 * delete-after-read leaks the moment somebody adds a second return path.
 */
const platformUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  isActive: true,
  mustChangePassword: true,
  accentColor: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  platformUserRoles: {
    select: { platformRole: { select: { name: true } } },
  },
} as const;

/** A platform user as every caller outside this module sees one. */
export interface PlatformUserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  /** Raw column. Callers normalise with resolveAccent(); null = product default. */
  accentColor: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Granted PlatformRole names. W1.3 grants exactly one: PLATFORM_ADMIN. */
  roles: string[];
}

/** Row shape returned by the select above, before the roles are flattened. */
type PlatformUserRow = Omit<PlatformUserRecord, "roles"> & {
  platformUserRoles: { platformRole: { name: string } }[];
};

/**
 * Flatten the join rows to plain role names.
 *
 * The nested shape is a Prisma detail; letting it reach a page would mean every
 * consumer walking `platformUserRoles[0].platformRole.name` and each deciding
 * for itself what an empty array renders as.
 */
function toRecord(row: PlatformUserRow): PlatformUserRecord {
  const { platformUserRoles, ...user } = row;
  return { ...user, roles: platformUserRoles.map((r) => r.platformRole.name) };
}

/**
 * Failure modes a route has to answer differently. Returned rather than thrown:
 * these are expected outcomes of valid requests, and a thrown exception would
 * be indistinguishable from a genuine fault in the route's catch block.
 */
export type PlatformUserError =
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  /** The PLATFORM_ADMIN row is missing from PlatformRole — a setup fault. */
  | "ROLE_UNAVAILABLE";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: PlatformUserError };

// --- Evidence ---------------------------------------------------------------

/**
 * Record that one operator changed another operator's account.
 *
 * NOT AuditLog. That table's tenantId is required and foreign-keyed to Tenant,
 * so a platform event has nowhere of its own to live, and writing it against an
 * arbitrary tenant would file platform activity inside a university's readable
 * audit trail. The platform login route made the same call for the same reason;
 * the gap is recorded in TECHNICAL_DEBT.md and closing it means making
 * AuditLog.tenantId nullable, which is a change to a table eleven modules
 * already write to.
 *
 * Ids and an action only. Never a password, never a hash — including on the
 * reset path, where the plaintext is in scope at the call site.
 */
export function logPlatformUserEvent(
  action: "created" | "updated" | "activated" | "deactivated" | "password-reset",
  actorId: string,
  subjectId: string
): void {
  console.warn(`[platform-users] ${action} actor=${actorId} subject=${subjectId}`);
}

// --- Temporary passwords ----------------------------------------------------

/**
 * Alphabet for a generated password.
 *
 * O/0, I/l/1 and similar are omitted on purpose: this string gets read aloud
 * over a call or copied off a screen, and a character pair that cannot be told
 * apart turns into a support ticket that looks exactly like a wrong password.
 * The cost is ~0.2 bits per character, which the length below more than repays.
 */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 16 characters over a 55-symbol alphabet — about 92 bits. */
const TEMP_PASSWORD_LENGTH = 16;

/**
 * A single-use password for an account somebody else is setting up.
 *
 * randomInt from node:crypto, NOT Math.random: this value is a credential, and
 * Math.random is seeded predictably enough that generated passwords could be
 * reconstructed from a couple of known ones. randomInt is also rejection-
 * sampled internally, so the distribution is uniform rather than skewed toward
 * the start of the alphabet the way `% length` would make it.
 */
export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

// --- Reads ------------------------------------------------------------------

/**
 * One page of platform users, with the total for the same filter.
 *
 * `q` matches email, firstName and lastName case-insensitively as a substring.
 * Substring rather than prefix because operators search for the part they
 * remember — a surname, or the bit before the @ — and a prefix match silently
 * returns nothing for both.
 *
 * The count applies the SAME where clause as the rows. A total taken over the
 * whole table would render "page 1 of 4" above a single search hit.
 */
export async function listPlatformUsers(
  query: ListPlatformUsersQuery
): Promise<{ users: PlatformUserRecord[]; total: number }> {
  const { page, limit, q } = query;

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  // Paired in one transaction so the total cannot shift between the two reads
  // and leave the page metadata inconsistent with the rows returned. The
  // explicit ordering is required for correctness, not presentation: offset
  // pagination over an unordered result can repeat or skip rows.
  const [rows, total] = await prisma.$transaction([
    prisma.platformUser.findMany({
      where,
      select: platformUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.platformUser.count({ where }),
  ]);

  return { users: rows.map(toRecord), total };
}

export async function getPlatformUser(id: string): Promise<PlatformUserRecord | null> {
  const row = await prisma.platformUser.findUnique({ where: { id }, select: platformUserSelect });
  return row ? toRecord(row) : null;
}

// --- Writes -----------------------------------------------------------------

/**
 * Create an operator and grant them their role, returning the one-time password.
 *
 * THE PLAINTEXT IS RETURNED, NEVER STORED
 *   It exists in memory for the length of this call and in the response the
 *   creating operator sees once. Only the bcrypt hash reaches the database, and
 *   mustChangePassword is set so the account cannot do anything but replace it.
 *
 * THE ROLE IS RESOLVED, NOT CREATED
 *   A missing PLATFORM_ADMIN row is a deployment that has not been seeded, and
 *   creating it here would mean this endpoint quietly defining the platform's
 *   authorization model as a side effect of adding a user.
 *
 * The user and the grant are written in ONE transaction — via a nested create,
 * so an operator can never exist with no role, which would be an account that
 * authenticates and is then refused by every guard.
 */
export async function createPlatformUser(
  input: CreatePlatformUserInput
): Promise<ServiceResult<{ user: PlatformUserRecord; temporaryPassword: string }>> {
  const role = await prisma.platformRole.findUnique({
    where: { name: input.role },
    select: { id: true },
  });
  if (!role) return { ok: false, error: "ROLE_UNAVAILABLE" };

  const existing = await prisma.platformUser.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "EMAIL_TAKEN" };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const row = await prisma.platformUser.create({
    data: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      mustChangePassword: true,
      platformUserRoles: { create: { platformRoleId: role.id } },
    },
    select: platformUserSelect,
  });

  return { ok: true, value: { user: toRecord(row), temporaryPassword } };
}

/**
 * Apply a partial update, including activation and deactivation.
 *
 * DEACTIVATION IS THIS FUNCTION, NOT A DELETE
 *   `isActive: false` is the whole mechanism: the login route refuses an
 *   inactive account and requirePlatformAdmin re-reads the column on every
 *   request, so an operator loses access immediately rather than when their
 *   token expires. Deleting the row would cascade their PlatformUserRole grants
 *   away and destroy the only record that the account ever existed.
 *
 * THE ROLE CHANGE IS A REPLACEMENT, NOT AN ADD
 *   W1.3 defines one role, so "change role" means the set of grants becomes
 *   exactly the one named. Adding without removing would accumulate grants that
 *   no screen shows and nothing ever revokes.
 */
export async function updatePlatformUser(
  id: string,
  // Widened by the one column the self-service route may write. Kept as an
  // intersection rather than folded into UpdatePlatformUserInput so the
  // administrative schema stays exactly as narrow as it is.
  input: UpdatePlatformUserInput & { accentColor?: string }
): Promise<ServiceResult<PlatformUserRecord>> {
  const existing = await prisma.platformUser.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  // Only re-checked for an address that is actually changing — resubmitting the
  // account's own current email is not a conflict with itself.
  if (input.email !== undefined && input.email !== existing.email) {
    const clash = await prisma.platformUser.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (clash) return { ok: false, error: "EMAIL_TAKEN" };
  }

  let roleId: string | null = null;
  if (input.role !== undefined) {
    const role = await prisma.platformRole.findUnique({
      where: { name: input.role },
      select: { id: true },
    });
    if (!role) return { ok: false, error: "ROLE_UNAVAILABLE" };
    roleId = role.id;
  }

  // `role` is not a PlatformUser column — it is a grant on PlatformUserRole,
  // handled below — so it is dropped before the update data is assembled.
  const scalars = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    isActive: input.isActive,
    // Self-service only in practice. updatePlatformUserSchema — the schema the
    // administrative route parses with — is .strict() and declares no
    // accentColor, so an administrator editing somebody else can never produce
    // this key; only updateOwnPlatformProfileSchema can, and that route acts on
    // the caller alone. One update function rather than two.
    accentColor: input.accentColor,
  };

  // One transaction, because a role replacement is a delete followed by a
  // create: interrupted between the two, the operator would hold no role at all
  // and be locked out of the console by a request that reported success.
  const row = await prisma.$transaction(async (tx) => {
    if (roleId) {
      await tx.platformUserRole.deleteMany({ where: { platformUserId: id } });
      await tx.platformUserRole.create({
        data: { platformUserId: id, platformRoleId: roleId },
      });
    }

    return tx.platformUser.update({
      where: { id },
      data: scalars,
      select: platformUserSelect,
    });
  });

  return { ok: true, value: toRecord(row) };
}

/**
 * Issue a new temporary password for an existing operator.
 *
 * mustChangePassword is set for the same reason as on creation: a second person
 * has now seen the plaintext, so it is a shared secret until its owner replaces
 * it. Existing platform sessions are NOT revoked here — the platform token is
 * stateless and short-lived (1h), and the account is in any case reduced to
 * "change your password" by the guard from this moment on.
 */
export async function resetPlatformUserPassword(
  id: string
): Promise<ServiceResult<{ user: PlatformUserRecord; temporaryPassword: string }>> {
  const existing = await prisma.platformUser.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const row = await prisma.platformUser.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
    select: platformUserSelect,
  });

  return { ok: true, value: { user: toRecord(row), temporaryPassword } };
}

/**
 * Replace an operator's OWN password, clearing the forced-change flag.
 *
 * Separate from resetPlatformUserPassword because the two are different acts:
 * this one is performed by the account's owner, proves knowledge of the current
 * password, and ends the forced-change state. The other is performed by a
 * different operator and begins it.
 *
 * Returns false when the account is gone or the current password does not
 * match, so the route can answer 401 without this module knowing about HTTP.
 * The two are not distinguished — a session whose account no longer exists and
 * a wrong password are both "you may not do this".
 */
export async function changeOwnPlatformPassword(
  id: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const existing = await prisma.platformUser.findUnique({
    where: { id },
    select: { passwordHash: true },
  });
  if (!existing) return false;

  if (!(await verifyPassword(currentPassword, existing.passwordHash))) return false;

  await prisma.platformUser.update({
    where: { id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  return true;
}

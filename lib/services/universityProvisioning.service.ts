// ============================================================================
// OWNER  : Gauransh
// MODULE : University Provisioning (W1.4)
// LAYER  : Service — composes EXISTING models; defines no new one.
// ACCESS : Called exclusively from routes that have already run
//          requirePlatformAdmin(). Nothing here re-checks authorization, and
//          nothing here may be imported by a client component.
//
// WHAT THIS MODULE IS
//   Onboarding a university touches five tables that already exist — Tenant,
//   Role, User, UserRole and Subscription — and must touch them together. This
//   module is that composition and nothing else. There is no University model,
//   no Provisioning model and no second tenant system: W1.4 adds one boolean
//   column to User and otherwise writes rows the schema has always had.
//
// WHY ONE TRANSACTION IS THE WHOLE POINT
//   The failure this prevents is not theoretical. Created step by step, an
//   interrupted provision leaves a university with no administrator (nobody can
//   sign in, and the platform screen shows a healthy tenant), or an
//   administrator with no role (they authenticate and every guard then refuses
//   them). Both look like working data and are unusable. Either everything below
//   commits or none of it does.
//
// THE PASSWORD RULES ARE W1.3'S, REUSED RATHER THAN RESTATED
//   generateTemporaryPassword and the bcrypt hashing come from the platform
//   user service and lib/auth/password. A second generator would eventually
//   disagree with the first about entropy or cost factor.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { generateTemporaryPassword } from "@/lib/services/platformUser.service";
import { INITIAL_TENANT_ROLE } from "@/lib/validations/platform";
import type { ProvisionAdminInput, ProvisionTenantInput } from "@/lib/validations/platform";
import { Prisma } from "@/app/generated/prisma/client";

/** Prisma client or an interactive transaction — either can run these writes. */
type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * The columns a tenant user is ever exposed through.
 *
 * passwordHash is absent by construction rather than deleted afterwards — a
 * delete-after-read leaks the moment somebody adds a second return path.
 */
const TENANT_ADMIN_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  userRoles: { select: { role: { select: { name: true } } } },
} as const;

/** A provisioned administrator as every caller outside this module sees one. */
export interface TenantAdminRecord {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roles: string[];
}

type TenantAdminRow = Omit<TenantAdminRecord, "roles"> & {
  userRoles: { role: { name: string } }[];
};

function toAdminRecord(row: TenantAdminRow): TenantAdminRecord {
  const { userRoles, ...user } = row;
  return { ...user, roles: userRoles.map((ur) => ur.role.name) };
}

/**
 * Failure modes a route answers differently. Returned rather than thrown: these
 * are expected outcomes of valid requests, and an exception would be
 * indistinguishable from a genuine fault in the route's catch block.
 */
export type ProvisioningError = "TENANT_NOT_FOUND" | "SLUG_TAKEN" | "ADMIN_EMAIL_TAKEN";

export type ProvisioningResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProvisioningError };

/**
 * Create a University Admin inside an existing tenant.
 *
 * THE ROLE IS UPSERTED PER TENANT, NOT LOOKED UP GLOBALLY
 *   Role is @@unique([tenantId, name]) — role names are per-tenant rows, so a
 *   brand-new university has no UNIVERSITY_ADMIN row until one is made. It is
 *   marked isSystem, matching what prisma/seed.ts creates, so a tenant admin
 *   screen shows it as built-in rather than as something they authored.
 *
 * THE ROLE NAME IS A CONSTANT, NEVER AN ARGUMENT
 *   Nothing the caller sends reaches this string. That is what makes
 *   "provisioning cannot mint a SUPER_ADMIN" a property of the code rather than
 *   a validation rule that a later caller might route around.
 *
 * `tx` is required, not optional: every caller of this function is already
 * inside a transaction, and an administrator half-created outside one is the
 * exact failure the module header describes.
 */
async function createTenantAdmin(
  tx: DbClient,
  tenantId: string,
  input: ProvisionAdminInput
): Promise<{ admin: TenantAdminRecord; temporaryPassword: string }> {
  const role = await tx.role.upsert({
    where: { tenantId_name: { tenantId, name: INITIAL_TENANT_ROLE } },
    update: {},
    create: { tenantId, name: INITIAL_TENANT_ROLE, isSystem: true },
    select: { id: true },
  });

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const row = await tx.user.create({
    data: {
      tenantId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      // The platform operator who provisioned this account has seen the
      // plaintext, so it is a shared secret until its owner replaces it.
      mustChangePassword: true,
      isActive: true,
      // Not isVerified. Nothing has verified the address — no mail has been
      // sent to it, because this stack has no mail transport. Setting the flag
      // would be a claim the system cannot support.
      userRoles: { create: { roleId: role.id } },
    },
    select: TENANT_ADMIN_SELECT,
  });

  return { admin: toAdminRecord(row), temporaryPassword };
}

/**
 * Provision a university: tenant, subscription and (optionally) its first
 * administrator, in one transaction.
 *
 * WHY A SUBSCRIPTION IS CREATED HERE
 *   Subscription is the existing billing model and every platform screen —
 *   /platform/subscriptions and the tenant detail's Subscription tab — reads
 *   it. A tenant provisioned without one shows "no subscription" on two screens
 *   that are not broken. The row created is the schema's own defaults (STARTER,
 *   TRIAL, MONTHLY) with startDate set to now; nothing about pricing or limits
 *   is invented, because the PRD defines none for onboarding.
 *
 * NO DOMAIN ROW IS CREATED
 *   Every tenant already reaches its console at <slug>.<root-domain> through
 *   the platform-subdomain path in lib/services/tenant.ts, with no Domain row
 *   needed. A Domain row is for a CUSTOM hostname the institution proves it
 *   controls, which is exactly what the existing
 *   /platform/tenants/[id]/domains screen is for. Writing an unverified one
 *   here would create a row that does not resolve, on a screen that would then
 *   show a domain the university never asked for.
 */
export async function provisionUniversity(
  input: ProvisionTenantInput
): Promise<
  ProvisioningResult<{
    tenant: { id: string; slug: string; name: string; status: string };
    admin: TenantAdminRecord | null;
    temporaryPassword: string | null;
  }>
> {
  const { address, settings, admin, ...scalars } = input;

  // Fast-path guards outside the transaction. The real guarantees are the
  // unique constraints, which are re-checked by the caller's P2002 handling —
  // these exist so the common case answers 409 with a message naming the field
  // rather than surfacing a constraint name.
  const slugClash = await prisma.tenant.findUnique({
    where: { slug: scalars.slug },
    select: { id: true },
  });
  if (slugClash) return { ok: false, error: "SLUG_TAKEN" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          ...scalars,
          // Cast at this boundary because Zod infers unknown-valued records,
          // which Prisma's InputJsonValue does not accept directly. Omitted
          // keys stay undefined so the column default applies, not a null.
          address: address as Prisma.InputJsonValue | undefined,
          settings: settings as Prisma.InputJsonValue | undefined,
        },
        select: { id: true, slug: true, name: true, status: true },
      });

      await tx.subscription.create({
        data: { tenantId: tenant.id, startDate: new Date() },
      });

      if (!admin) return { tenant, admin: null, temporaryPassword: null };

      const created = await createTenantAdmin(tx, tenant.id, admin);
      return { tenant, admin: created.admin, temporaryPassword: created.temporaryPassword };
    });

    return { ok: true, value: result };
  } catch (err) {
    // A concurrent request took the slug between the check and the insert. The
    // administrator's address cannot clash here: the tenant is new, and User is
    // unique per (tenantId, email).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    throw err;
  }
}

/**
 * Provision a University Admin for a tenant that already exists.
 *
 * Needed because five tenants predate W1.4 and because a university can lose
 * its only administrator. Runs the same createTenantAdmin as onboarding, so the
 * role grant, the generated password and the forced-change flag cannot drift
 * between the two paths.
 */
export async function provisionTenantAdmin(
  tenantId: string,
  input: ProvisionAdminInput
): Promise<ProvisioningResult<{ admin: TenantAdminRecord; temporaryPassword: string }>> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { ok: false, error: "TENANT_NOT_FOUND" };

  const clash = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: input.email } },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "ADMIN_EMAIL_TAKEN" };

  try {
    // The role upsert, the user insert and the grant are three writes; an
    // administrator created without their role authenticates and is then
    // refused by every guard, which is worse than not being created.
    const created = await prisma.$transaction((tx) => createTenantAdmin(tx, tenantId, input));
    return { ok: true, value: created };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "ADMIN_EMAIL_TAKEN" };
    }
    throw err;
  }
}

/**
 * The administrators of one tenant.
 *
 * Filtered by the role NAME rather than by a role id, because Role ids are
 * per-tenant cuids while the name is the stable identifier across tenants —
 * the same rule requireRole follows. Scoped by tenantId, so this can never
 * return a user belonging to another university.
 */
export async function listTenantAdmins(tenantId: string): Promise<TenantAdminRecord[]> {
  const rows = await prisma.user.findMany({
    where: {
      tenantId,
      userRoles: { some: { role: { name: INITIAL_TENANT_ROLE, tenantId } } },
    },
    select: TENANT_ADMIN_SELECT,
    orderBy: { createdAt: "asc" },
  });

  return rows.map(toAdminRecord);
}

/**
 * Record a provisioning act.
 *
 * NOT AuditLog — and this one is a closer call than W1.3's, because a tenant
 * DOES exist here and AuditLog.tenantId could be satisfied. It is still
 * declined: AuditLog is the university's own trail, readable through
 * /governance/audit by that university's admins, and "the platform created your
 * administrator account" is a platform act about a tenant, not a tenant act.
 * Filing it there would also let a university infer platform operator ids from
 * the actor column. Recorded as TD-W14-1 rather than guessed at.
 *
 * Ids and an action only. Never a password, never a hash.
 */
export function logProvisioningEvent(
  action:
    | "university-provisioned"
    | "admin-provisioned"
    | "status-changed"
    // W1.5 — PRD §5.1 onboarding and configuration acts.
    | "onboarding-stage-marked"
    | "onboarding-stage-cleared"
    | "branding-configured"
    | "campus-added"
    | "academic-year-added"
    | "modules-assigned"
    | "tenant-archived"
    | "tenant-restored",
  actorPlatformUserId: string,
  tenantId: string,
  subjectId?: string
): void {
  console.warn(
    `[provisioning] ${action} actor=${actorPlatformUserId} tenant=${tenantId}` +
      (subjectId ? ` subject=${subjectId}` : "")
  );
}

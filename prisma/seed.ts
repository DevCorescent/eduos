// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Phase 2 Verification Seed
// FLOW   : Refuses to run outside development, then upserts one tenant, the
//          roles, users and role assignments needed to exercise the Platform
//          APIs, plus one subscription for the subscription update endpoint.
// ACCESS : Development only — guarded on NODE_ENV.
// BACKEND: Writes ONLY existing models: Tenant, Role, User, UserRole,
//          Subscription. No schema change, no migration.
// PURPOSE: Provide a signed-in SUPER_ADMIN (and a deliberately unprivileged
//          user) so every Phase 2 endpoint can be verified end to end rather
//          than assumed from a clean compile.
// ============================================================================

// dotenv must load before lib/db/prisma, which reads DATABASE_URL when it
// constructs the Neon adapter at module scope.
import "dotenv/config";

import { prisma } from "../lib/db/prisma";
import { hashPassword } from "../lib/auth/password";

/** Fixed, recognisable identifiers so seeded rows are easy to spot and remove. */
const TENANT_SLUG = "verify-university";
const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
const STAFF_ROLE = "UNIVERSITY_ADMIN";
const SUPER_ADMIN_EMAIL = "superadmin@verify.test";
const STAFF_EMAIL = "staff@verify.test";
const PASSWORD = "VerifyPass123!";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production.");
  }

  // Every write is an upsert keyed on an existing unique constraint, so the
  // seed can be re-run without creating duplicates.
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { status: "ACTIVE" },
    create: {
      slug: TENANT_SLUG,
      name: "Verify University",
      status: "ACTIVE",
    },
  });

  const superAdminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: SUPER_ADMIN_ROLE } },
    update: {},
    create: { tenantId: tenant.id, name: SUPER_ADMIN_ROLE, isSystem: true },
  });

  // Exists solely so a 403 can be produced: an authenticated caller who does
  // not hold SUPER_ADMIN. An anonymous caller yields 401, never 403.
  const staffRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: STAFF_ROLE } },
    update: {},
    create: { tenantId: tenant.id, name: STAFF_ROLE, isSystem: true },
  });

  const passwordHash = await hashPassword(PASSWORD);

  const superAdmin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: SUPER_ADMIN_EMAIL } },
    update: { passwordHash, isActive: true },
    create: {
      tenantId: tenant.id,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      firstName: "Super",
      lastName: "Admin",
      isActive: true,
      isVerified: true,
    },
  });

  const staff = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: STAFF_EMAIL } },
    update: { passwordHash, isActive: true },
    create: {
      tenantId: tenant.id,
      email: STAFF_EMAIL,
      passwordHash,
      firstName: "Staff",
      lastName: "Member",
      isActive: true,
      isVerified: true,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: superAdmin.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: superAdmin.id, roleId: superAdminRole.id },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: staff.id, roleId: staffRole.id } },
    update: {},
    create: { userId: staff.id, roleId: staffRole.id },
  });

  // Subscription has no unique constraint beyond its primary key, so it cannot
  // be upserted by a natural key — find first, create only if absent. Carries a
  // BigInt maxStorage and a Decimal pricePerMonth so the serializer is
  // exercised against real database values rather than constructed ones.
  let subscription = await prisma.subscription.findFirst({
    where: { tenantId: tenant.id },
  });

  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        plan: "STARTER",
        status: "TRIAL",
        billingCycle: "MONTHLY",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        maxStudents: 500,
        maxFaculty: 50,
        maxStorage: BigInt("53687091200"),
        pricePerMonth: "1499.50",
        currency: "INR",
      },
    });
  }

  // No Session row is seeded: /api/auth/login creates one bound to the access
  // token it issues, and requireAuth matches the live cookie against that row.
  // A pre-seeded session would hold a token no client possesses.
  console.log(
    JSON.stringify(
      {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        superAdminEmail: SUPER_ADMIN_EMAIL,
        staffEmail: STAFF_EMAIL,
        password: PASSWORD,
        subscriptionId: subscription.id,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

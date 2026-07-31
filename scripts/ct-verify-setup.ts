// TEMPORARY verification fixtures for /api/certificate-templates. Deleted after use.
// Kept to a handful of round-trips and wrapped in retries: the Neon WebSocket has
// been dropping mid-run, which is an infrastructure fault rather than a route one.
import "dotenv/config";
import { prisma } from "../lib/db/prisma";

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.error(`retry ${label} ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

async function build(slug: string, tag: string) {
  const tenant = await retry("tenant", () =>
    prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } }));

  // Start from a known-empty template set in this tenant so counts are exact.
  await retry("del certs", () => prisma.certificate.deleteMany({ where: { tenantId: tenant.id } }));
  await retry("del templates", () => prisma.certificateTemplate.deleteMany({ where: { tenantId: tenant.id } }));

  // 25 rows so pagination has more than one page at the default limit of 20.
  // Deliberately duplicated names and types, and 25 simultaneously ACTIVE
  // templates of the same type, to prove nothing enforces uniqueness. Written by
  // one createMany so seeding costs a single round-trip.
  const SEEDED = 25;
  await retry("seed", () =>
    prisma.certificateTemplate.createMany({
      data: Array.from({ length: SEEDED }, (_, i) => ({
        tenantId: tenant.id,
        name: `CT ${tag} shared name`,
        type: "DEGREE" as const,
        htmlTemplate: `<p>seed ${tag} ${i + 1}</p>`,
        isActive: true,
      })),
    }));

  // Read back in the route's own ordering so newest/oldest are the route's newest
  // and oldest, not an assumption about insertion order.
  const rows = await retry("read back", () =>
    prisma.certificateTemplate.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }));

  const roles = await retry("roles", () =>
    prisma.userRole.findMany({
      where: { user: { tenantId: tenant.id } },
      select: { role: { select: { name: true } }, user: { select: { email: true } } },
    }));

  return {
    slug,
    tenantId: tenant.id,
    seededCount: rows.length,
    newestId: rows[0].id,
    oldestId: rows[rows.length - 1].id,
    roles: roles.map((r) => `${r.user.email}=${r.role.name}`).sort(),
  };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing: NODE_ENV is production.");
  const a = await build("verify-university", "a");
  const b = await build("verify-university-b", "b");
  console.log("FIXTURES " + JSON.stringify({ a, b }));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

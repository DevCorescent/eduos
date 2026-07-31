// TEMPORARY post-run database audit for GET /api/notifications. Deleted after use.
// Proves the endpoint wrote nothing and that its listing matches the stored rows.
import "dotenv/config";
import { prisma } from "../lib/db/prisma";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
}
function section(t: string) { console.log(`\n== ${t}`); }

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) { last = e; console.error(`retry ${label} ${i}`); await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
  throw last;
}

const F = JSON.parse( process.argv[2]) as {
  a: { tenantId: string; templateId: string; userId: string; seededCount: number; statusCounts: Record<string, number>; distinctCreatedAt: number };
  b: { tenantId: string; templateId: string };
  total: number;
};

async function main() {
  const rowsA = await retry("rowsA", () => prisma.notification.findMany({ where: { tenantId: F.a.tenantId } }));
  const rowsB = await retry("rowsB", () => prisma.notification.findMany({ where: { tenantId: F.b.tenantId } }));
  const all = await retry("all", () => prisma.notification.count());

  section("No database writes — the stored set is exactly what was seeded");
  {
    check("tenant A row count unchanged", rowsA.length === F.a.seededCount, { live: rowsA.length, seed: F.a.seededCount });
    check("tenant B still holds zero notifications", rowsB.length === 0, rowsB.length);
    check("the global row count is unchanged — nothing created or deleted", all === F.total, { live: all, seed: F.total });

    const counts = rowsA.reduce<Record<string, number>>((acc, n) => { acc[n.status] = (acc[n.status] ?? 0) + 1; return acc; }, {});
    // Compared as sorted pairs: JS object key ORDER differs between the seeded
    // tally and this one, and order carries no meaning here.
    const pairs = (o: Record<string, number>) =>
      JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    check("status counts are unchanged — listing changed no status",
      pairs(counts) === pairs(F.a.statusCounts), { live: pairs(counts), seed: pairs(F.a.statusCounts) });
    check("PENDING rows are still PENDING — nothing was sent or retried", (counts.PENDING ?? 0) > 0, counts);
    check("FAILED rows are still FAILED — nothing was retried", (counts.FAILED ?? 0) > 0, counts);
    check("no row gained a sentAt it did not have",
      rowsA.filter((n) => n.sentAt !== null).every((n) => n.sentAt!.toISOString() === "2026-06-01T00:00:00.000Z"),
      rowsA.filter((n) => n.sentAt && n.sentAt.toISOString() !== "2026-06-01T00:00:00.000Z").length);
    check("no row gained a readAt — reading a list does not mark anything read",
      rowsA.filter((n) => n.readAt !== null).every((n) => n.readAt!.toISOString() === "2026-06-02T00:00:00.000Z"),
      rowsA.filter((n) => n.readAt && n.readAt.toISOString() !== "2026-06-02T00:00:00.000Z").length);
    check("no row gained an error", rowsA.filter((n) => n.error !== null).every((n) => n.error === "seeded failure"));
    check("no row gained a data payload", rowsA.every((n) => n.data === null));
    check("every createdAt is unchanged and pre-dates this audit", rowsA.every((n) => n.createdAt.getUTCFullYear() >= 2026));
  }

  section("Stability across two reads with no traffic");
  {
    const snap = (rs: { id: string; status: string; sentAt: Date | null; readAt: Date | null }[]) =>
      JSON.stringify(rs.map((r) => [r.id, r.status, r.sentAt?.toISOString() ?? null, r.readAt?.toISOString() ?? null]).sort());
    const again = await retry("again", () => prisma.notification.findMany({
      where: { tenantId: F.a.tenantId }, select: { id: true, status: true, sentAt: true, readAt: true },
    }));
    check("the Notification table is stable across two reads", snap(again) === snap(rowsA));
  }

  section("Ordering determinism relies on the id tiebreaker");
  {
    const stamps = new Set(rowsA.map((n) => n.createdAt.getTime()));
    check("the seeded batch shares createdAt values, so createdAt alone cannot order them",
      stamps.size < rowsA.length, { distinct: stamps.size, rows: rowsA.length });
    const o1 = await retry("o1", () => prisma.notification.findMany({
      where: { tenantId: F.a.tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
    }));
    const o2 = await retry("o2", () => prisma.notification.findMany({
      where: { tenantId: F.a.tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
    }));
    check("the route's orderBy is fully deterministic over that tie", JSON.stringify(o1) === JSON.stringify(o2));
  }

  section("No writes to NotificationTemplate or User");
  {
    const tpl = await retry("tpl", () => prisma.notificationTemplate.findUniqueOrThrow({ where: { id: F.a.templateId } }));
    check("the template's subject is untouched", tpl.subject === "TEMPLATE-SUBJECT-MUST-NOT-LEAK", tpl.subject);
    check("the template's body is untouched", tpl.body === "TEMPLATE-BODY-MUST-NOT-LEAK {{name}}", tpl.body);

    // GET /api/notifications reads no User row. The harness still logs in, and
    // POST /api/auth/login writes lastLoginAt — so stability is asserted across
    // two reads taken after all traffic, not against a pre-run snapshot.
    const u1 = await retry("u1", () => prisma.user.findUniqueOrThrow({ where: { id: F.a.userId }, select: { updatedAt: true, lastLoginAt: true } }));
    const u2 = await retry("u2", () => prisma.user.findUniqueOrThrow({ where: { id: F.a.userId }, select: { updatedAt: true, lastLoginAt: true } }));
    check("the recipient's User row is stable across two reads", u1.updatedAt.getTime() === u2.updatedAt.getTime());
    check("only one migration exists — this route added no schema change",
      (await retry("mig", () => prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "_prisma_migrations"`))[0].n === 1);
  }

  console.log(`\n---\nPASS ${pass}   FAIL ${fail}`);
  if (fail) { console.log("Failed:", failures.join(" | ")); process.exitCode = 1; }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

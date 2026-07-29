import "dotenv/config";
import { prisma } from "./lib/db/prisma";
const [action, arg1] = process.argv.slice(2);
const OTHER = "other-university";
async function main() {
  if (action === "setup") {
    const t = await prisma.tenant.upsert({ where: { slug: OTHER }, update: { status: "ACTIVE" },
      create: { slug: OTHER, name: "Other University", status: "ACTIVE" } });
    let ay = await prisma.academicYear.findFirst({ where: { tenantId: t.id } });
    if (!ay) ay = await prisma.academicYear.create({ data: { tenantId: t.id, name: "OTHER-AY-2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    console.log(`OTHER_AY=${ay.id}`);
  } else if (action === "sem-add") {
    const ay = await prisma.academicYear.findUnique({ where: { id: arg1 }, select: { tenantId: true } });
    const s = await prisma.semester.create({ data: { tenantId: ay!.tenantId, academicYearId: arg1, name: "Probe Sem", semesterNumber: 1, startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30") } });
    console.log(`SEM=${s.id}`);
  } else if (action === "sem-purge") {
    const n = await prisma.semester.deleteMany({ where: { academicYearId: arg1 } });
    console.log(`purged=${n.count}`);
  } else {
    const t = await prisma.tenant.findUnique({ where: { slug: OTHER } });
    if (t) {
      await prisma.semester.deleteMany({ where: { tenantId: t.id } });
      await prisma.academicYear.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.delete({ where: { id: t.id } });
    }
    console.log("teardown-ok");
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());

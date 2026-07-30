import { prisma } from "@/lib/db/prisma";
import { CourseType } from "@/app/generated/prisma/client";
import {
  courseQuerySchema,
  courseIdParamSchema,
  createCourseSchema,
  updateCourseSchema,
} from "@/lib/validations/course";

const TENANT = "cms5vpz1b0000y0u7kjp9uwwx";
let pass = 0;
let fail = 0;

function t(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const good = a === e;
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"} | ${label.padEnd(48)} | got=${a}${good ? "" : ` want=${e}`}`);
}

function okOf<T>(r: { success: boolean; data?: T }) {
  return r.success;
}

async function main() {
  console.log("=== courseQuerySchema (shared pagination contract) ===");
  t("defaults", courseQuerySchema.safeParse({}).data, { page: 1, limit: 20 });
  t("coerces strings", courseQuerySchema.safeParse({ page: "3", limit: "50" }).data, { page: 3, limit: 50 });
  t("page=0 rejected", okOf(courseQuerySchema.safeParse({ page: "0" })), false);
  t("limit=101 rejected", okOf(courseQuerySchema.safeParse({ limit: "101" })), false);
  t("limit=100 allowed", okOf(courseQuerySchema.safeParse({ limit: "100" })), true);
  t("unknown query key stripped", courseQuerySchema.safeParse({ isActive: "true" }).data, { page: 1, limit: 20 });

  console.log("\n=== courseIdParamSchema ===");
  t("cuid accepted", courseIdParamSchema.safeParse({ id: "cms5vpz1b0000y0u7kjp9uwwx" }).data?.id, "cms5vpz1b0000y0u7kjp9uwwx");
  t("trims", courseIdParamSchema.safeParse({ id: "  abc  " }).data?.id, "abc");
  t("empty rejected", okOf(courseIdParamSchema.safeParse({ id: "" })), false);
  t("whitespace-only rejected", okOf(courseIdParamSchema.safeParse({ id: "   " })), false);
  t("non-uuid NOT rejected", okOf(courseIdParamSchema.safeParse({ id: "not-a-uuid" })), true);

  console.log("\n=== createCourseSchema ===");
  t("minimal (name+code only)", createCourseSchema.safeParse({ name: "Algorithms", code: "CS101" }).data, {
    name: "Algorithms",
    code: "CS101",
  });
  t("missing name rejected", okOf(createCourseSchema.safeParse({ code: "CS101" })), false);
  t("missing code rejected", okOf(createCourseSchema.safeParse({ name: "Algorithms" })), false);
  t("blank name rejected", okOf(createCourseSchema.safeParse({ name: "   ", code: "CS101" })), false);
  t("blank code rejected", okOf(createCourseSchema.safeParse({ name: "A", code: "   " })), false);
  t("trims name and code", createCourseSchema.safeParse({ name: "  A  ", code: "  C1  " }).data, {
    name: "A",
    code: "C1",
  });

  const all = Object.values(CourseType);
  t("all 6 CourseType members accepted", all.filter((v) => okOf(createCourseSchema.safeParse({ name: "A", code: "C", type: v }))).length, all.length);
  t("CourseType members", all, ["CORE", "ELECTIVE", "AUDIT", "LAB", "PROJECT", "SEMINAR"]);
  t("bad type rejected", okOf(createCourseSchema.safeParse({ name: "A", code: "C", type: "PRACTICAL" })), false);
  t("lowercase type rejected", okOf(createCourseSchema.safeParse({ name: "A", code: "C", type: "core" })), false);

  t("integer credits accepted", createCourseSchema.safeParse({ name: "A", code: "C", credits: 4 }).data?.credits, 4);
  t("non-integer credits rejected", okOf(createCourseSchema.safeParse({ name: "A", code: "C", credits: 3.5 })), false);
  t("numeric string credits rejected (no coercion)", okOf(createCourseSchema.safeParse({ name: "A", code: "C", credits: "3" })), false);
  t("credits=0 ACCEPTED (unbounded)", createCourseSchema.safeParse({ name: "A", code: "C", credits: 0 }).data?.credits, 0);
  t("credits=-5 ACCEPTED (unbounded)", createCourseSchema.safeParse({ name: "A", code: "C", credits: -5 }).data?.credits, -5);

  t("isActive boolean accepted", createCourseSchema.safeParse({ name: "A", code: "C", isActive: false }).data?.isActive, false);
  t("isActive string rejected", okOf(createCourseSchema.safeParse({ name: "A", code: "C", isActive: "false" })), false);
  t("blank departmentId rejected", okOf(createCourseSchema.safeParse({ name: "A", code: "C", departmentId: "  " })), false);

  const injected = createCourseSchema.safeParse({
    name: "Injected",
    code: "INJ1",
    tenantId: "OTHER-TENANT",
    id: "forced-id",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    curriculumSubjects: [{ id: "x" }],
  });
  t("server fields STRIPPED, not rejected", injected.data, { name: "Injected", code: "INJ1" });
  t("  → tenantId absent from output", "tenantId" in (injected.data ?? {}), false);
  t("  → id absent from output", "id" in (injected.data ?? {}), false);

  console.log("\n=== updateCourseSchema ===");
  t("empty body REJECTED", okOf(updateCourseSchema.safeParse({})), false);
  t("single field allowed", updateCourseSchema.safeParse({ credits: 2 }).data, { credits: 2 });
  t("code MUTABLE", updateCourseSchema.safeParse({ code: "CS999" }).data, { code: "CS999" });
  t("name alone allowed", updateCourseSchema.safeParse({ name: "Renamed" }).data, { name: "Renamed" });
  t("isActive alone allowed", updateCourseSchema.safeParse({ isActive: false }).data, { isActive: false });
  t("inherits enum rule", okOf(updateCourseSchema.safeParse({ type: "PRACTICAL" })), false);
  t("inherits integer rule", okOf(updateCourseSchema.safeParse({ credits: 1.5 })), false);
  t("inherits trim rule", updateCourseSchema.safeParse({ name: "  X  " }).data, { name: "X" });
  t("inherits blank rejection", okOf(updateCourseSchema.safeParse({ code: "   " })), false);
  t("tenantId cannot be introduced", updateCourseSchema.safeParse({ name: "X", tenantId: "OTHER" }).data, { name: "X" });
  t("tenantId ALONE is empty after strip → rejected", okOf(updateCourseSchema.safeParse({ tenantId: "OTHER" })), false);
  t("all 8 columns at once", Object.keys(
    updateCourseSchema.safeParse({
      departmentId: "d",
      name: "n",
      code: "c",
      type: "LAB",
      credits: 1,
      description: "d",
      syllabus: "s",
      isActive: true,
    }).data ?? {}
  ).length, 8);

  console.log("\n=== DATABASE ROUND-TRIP: do the omitted keys really take schema defaults? ===");
  const dept = await prisma.department.findFirst({ where: { tenantId: TENANT }, select: { id: true } });
  console.log(`  department in tenant: ${dept?.id ?? "NONE"}`);

  const minimalInput = createCourseSchema.parse({
    name: "Verify Minimal",
    code: "VRF-MIN-1",
    tenantId: "OTHER-TENANT",
    id: "forced-id",
  });
  const created = await prisma.course.create({
    data: { ...minimalInput, tenantId: TENANT },
    select: {
      id: true,
      tenantId: true,
      departmentId: true,
      name: true,
      code: true,
      type: true,
      credits: true,
      description: true,
      syllabus: true,
      isActive: true,
    },
  });
  t("default type = CORE", created.type, "CORE");
  t("default credits = 3", created.credits, 3);
  t("default isActive = true", created.isActive, true);
  t("departmentId null when omitted", created.departmentId, null);
  t("tenantId is resolved tenant, NOT body value", created.tenantId, TENANT);
  t("id generated, NOT forced", created.id === "forced-id", false);

  const fullInput = createCourseSchema.parse({
    departmentId: dept?.id,
    name: "Verify Full",
    code: "VRF-FULL-1",
    type: "LAB",
    credits: 0,
    description: "desc",
    syllabus: "syl",
    isActive: false,
  });
  const createdFull = await prisma.course.create({
    data: { ...fullInput, tenantId: TENANT },
    select: { id: true, type: true, credits: true, isActive: true, departmentId: true },
  });
  t("explicit type LAB applied", createdFull.type, "LAB");
  t("credits=0 PERSISTED by the database", createdFull.credits, 0);
  t("explicit isActive=false applied", createdFull.isActive, false);
  t("departmentId persisted", createdFull.departmentId, dept?.id ?? null);

  // Does the tenant-scoped unique index behave as the doc comment claims?
  let dupCode: string | null = null;
  try {
    await prisma.course.create({ data: { name: "Dup", code: "VRF-MIN-1", tenantId: TENANT } });
  } catch (e: unknown) {
    dupCode = (e as { code?: string }).code ?? "UNKNOWN";
  }
  t("same code, same tenant → P2002", dupCode, "P2002");

  // Only one tenant exists in the dev database, so the "same code under a
  // different tenant" claim is proven against the index itself using a second
  // tenantId value. That is possible precisely because Course.tenantId carries no
  // foreign key — which the assertion below this one demonstrates independently.
  const otherTenantCount = await prisma.tenant.count({ where: { id: { not: TENANT } } });
  console.log(`  other tenants present: ${otherTenantCount}`);
  let crossId: string | null = null;
  let crossErr: string | null = null;
  try {
    const c = await prisma.course.create({
      data: { name: "Dup Second Tenant", code: "VRF-MIN-1", tenantId: "second-tenant-id" },
      select: { id: true },
    });
    crossId = c.id;
  } catch (e: unknown) {
    crossErr = (e as { code?: string }).code ?? "UNKNOWN";
  }
  t("SAME code under a DIFFERENT tenantId → allowed", crossErr, null);
  t("  → index is scoped by tenantId, not global", crossId !== null, true);

  // Course has NO foreign key: prove a nonsense departmentId is accepted by the DB.
  const dangling = await prisma.course.create({
    data: { name: "Dangling Dept", code: "VRF-DANGLE-1", tenantId: TENANT, departmentId: "no-such-department" },
    select: { id: true, departmentId: true },
  });
  t("nonexistent departmentId ACCEPTED (no FK)", dangling.departmentId, "no-such-department");

  let danglingTenant: string | null = null;
  try {
    const dt = await prisma.course.create({
      data: { name: "Dangling Tenant", code: "VRF-DANGLE-2", tenantId: "no-such-tenant" },
      select: { id: true },
    });
    danglingTenant = dt.id;
  } catch (e: unknown) {
    danglingTenant = `REJECTED:${(e as { code?: string }).code}`;
  }
  t("nonexistent tenantId ACCEPTED (no FK on tenantId either)", danglingTenant?.startsWith("REJECTED") ?? true, false);

  console.log("\n=== cleanup ===");
  const del = await prisma.course.deleteMany({ where: { code: { startsWith: "VRF-" } } });
  console.log(`  courses removed: ${del.count}`);
  const left = await prisma.course.count({ where: { code: { startsWith: "VRF-" } } });
  t("all verification rows removed", left, 0);
  console.log(`  (ids touched: ${created.id}, ${createdFull.id}, ${crossId}, ${dangling.id})`);

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main();

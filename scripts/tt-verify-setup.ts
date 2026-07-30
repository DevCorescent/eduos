// TEMPORARY verification harness for GET /api/finance/report. Deleted after use.
// Builds a matrix where the three programme paths DISAGREE, so the route's use of
// Student.programmeId as the single authority is provable.
import "dotenv/config";
import { prisma } from "../lib/db/prisma";

async function build(slug: string, tag: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const semester = await prisma.semester.findFirstOrThrow({
    where: { tenantId: tenant.id, name: `TT Semester ${tag}` }, select: { id: true },
  });
  const ay = await prisma.academicYear.findFirstOrThrow({
    where: { tenantId: tenant.id, name: `TT Year ${tag}` }, select: { id: true },
  });
  const sem2 = await prisma.semester.upsert({
    where: { academicYearId_semesterNumber: { academicYearId: ay.id, semesterNumber: 2 } },
    update: {},
    create: { tenantId: tenant.id, academicYearId: ay.id, name: `TT Semester 2 ${tag}`, semesterNumber: 2,
      startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2026-12-31T00:00:00.000Z") },
    select: { id: true },
  });

  const progA = await prisma.programme.findUniqueOrThrow({
    where: { tenantId_code: { tenantId: tenant.id, code: `TTP-${tag}` } }, select: { id: true, departmentId: true },
  });
  // A second programme so "filtered" and "unfiltered" differ.
  const progB = await prisma.programme.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: `TTP2-${tag}` } },
    update: {},
    create: { tenantId: tenant.id, departmentId: progA.departmentId, name: `TT Programme 2 ${tag}`, code: `TTP2-${tag}`, durationValue: 3 },
    select: { id: true },
  });

  const s1 = await prisma.student.findUniqueOrThrow({ where: { tenantId_enrollmentNo: { tenantId: tenant.id, enrollmentNo: `TTS-${tag}-1` } }, select: { id: true, batchId: true } });
  const s2 = await prisma.student.findUniqueOrThrow({ where: { tenantId_enrollmentNo: { tenantId: tenant.id, enrollmentNo: `TTS-${tag}-2` } }, select: { id: true } });
  const s3 = await prisma.student.findUniqueOrThrow({ where: { tenantId_enrollmentNo: { tenantId: tenant.id, enrollmentNo: `FDM-${tag}-1` } }, select: { id: true } });

  // s1 → programme A. s2 → programme B. s3 → NULL programme.
  // s1's batch belongs to programme A too; we point s2's batch at programme A while
  // its Student.programmeId is B, so the batch path and the student path DISAGREE.
  const batchA = await prisma.batch.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: `TTB-${tag}` } }, select: { id: true, programmeId: true } });
  await prisma.student.update({ where: { id: s1.id }, data: { programmeId: progA.id, batchId: batchA.id } });
  await prisma.student.update({ where: { id: s2.id }, data: { programmeId: progB.id, batchId: batchA.id } });
  await prisma.student.update({ where: { id: s3.id }, data: { programmeId: null } });

  // A fee structure scoped to programme B, used by a demand for s1 (programme A),
  // so the feeStructure path disagrees with the student path.
  await prisma.feeComponent.deleteMany({ where: { feeStructure: { tenantId: tenant.id } } });
  await prisma.feeStructure.deleteMany({ where: { tenantId: tenant.id } });
  const fsB = await prisma.feeStructure.create({
    data: { tenantId: tenant.id, name: `FS scoped to B ${tag}`, programmeId: progB.id }, select: { id: true },
  });

  await prisma.payment.deleteMany({ where: { feeDemand: { tenantId: tenant.id } } }).catch(() => {});
  await prisma.feeDemand.deleteMany({ where: { tenantId: tenant.id } });

  const due = new Date("2026-12-31T00:00:00.000Z");
  const rows = [
    // student 1 (programme A), fee structure scoped to B — path disagreement
    { studentId: s1.id, semesterId: semester.id, feeStructureId: fsB.id, dueDate: due, totalAmount: "1000.00", waivedAmount: "100.00" },
    { studentId: s1.id, semesterId: sem2.id, feeStructureId: null, dueDate: due, totalAmount: "2000.00", waivedAmount: "200.00" },
    { studentId: s1.id, semesterId: null, feeStructureId: null, dueDate: due, totalAmount: "4000.00", waivedAmount: "0" },
    // student 2 (programme B)
    { studentId: s2.id, semesterId: semester.id, feeStructureId: null, dueDate: due, totalAmount: "8000.00", waivedAmount: "800.00" },
    // student 3 (NULL programme)
    { studentId: s3.id, semesterId: semester.id, feeStructureId: null, dueDate: due, totalAmount: "16000.00", waivedAmount: "1600.00" },
  ];
  await prisma.feeDemand.createMany({ data: rows.map((r) => ({ tenantId: tenant.id, ...r })) });

  const sum = (f: (r: (typeof rows)[number]) => boolean, k: "totalAmount" | "waivedAmount") =>
    rows.filter(f).reduce((acc, r) => acc + Number(r[k]), 0);

  const isP = (r: (typeof rows)[number]) => r.studentId === s1.id; // programme A via Student.programmeId
  const isS = (r: (typeof rows)[number]) => r.semesterId === semester.id;

  return {
    tenantId: tenant.id, slug,
    adminEmail: `ttadmin-${tag}@verify.test`, teacherEmail: `ttteacher-${tag}@verify.test`,
    outsiderEmail: `ttoutsider-${tag}@verify.test`, student1Email: `ttstudent1-${tag}@verify.test`,
    programmeA: progA.id, programmeB: progB.id, batchProgramme: batchA.programmeId,
    feeStructureB: fsB.id, semesterId: semester.id, semesterId2: sem2.id,
    expected: {
      all: { count: rows.length, total: sum(() => true, "totalAmount"), waived: sum(() => true, "waivedAmount") },
      programmeA: { count: rows.filter(isP).length, total: sum(isP, "totalAmount"), waived: sum(isP, "waivedAmount") },
      semester1: { count: rows.filter(isS).length, total: sum(isS, "totalAmount"), waived: sum(isS, "waivedAmount") },
      both: {
        count: rows.filter((r) => isP(r) && isS(r)).length,
        total: sum((r) => isP(r) && isS(r), "totalAmount"),
        waived: sum((r) => isP(r) && isS(r), "waivedAmount"),
      },
    },
  };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing: NODE_ENV is production.");
  const a = await build("verify-university", "a");
  const b = await build("verify-university-b", "b");
  console.log("FIXTURES " + JSON.stringify({ password: "VerifyPass123!", a, b }));
}

main()
  .catch((e) =>{ console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Development / Postman Seed
// FLOW   : Refuses to run outside development, then upserts one demo tenant with
//          the four documented logins and the full academic spine those logins
//          need — campus, school, department, programme, academic year,
//          semester, batch, section, course, faculty member and student —
//          followed by the legacy verification tenant.
// ACCESS : Development only — guarded on NODE_ENV.
// BACKEND: Writes ONLY existing models. No schema change and no migration.
// PURPOSE: Guarantee that nothing in the Postman collection fails for want of
//          seed data. Every write is an upsert on an existing unique constraint,
//          so the seed is idempotent and safe to re-run.
// ============================================================================

// dotenv must load before lib/db/prisma, which reads DATABASE_URL when it
// constructs the Neon adapter at module scope.
import "dotenv/config";

import { prisma } from "../lib/db/prisma";
import { hashPassword } from "../lib/auth/password";

const DEMO_SLUG = "demo";

/** The four documented logins. Passwords are hashed with bcrypt, never stored raw. */
const ACCOUNTS = [
  { email: "superadmin@eduos.local", password: "SuperAdmin@123", role: "SUPER_ADMIN", firstName: "Super", lastName: "Admin" },
  { email: "admin@demo.edu", password: "Admin@123", role: "UNIVERSITY_ADMIN", firstName: "Uni", lastName: "Admin" },
  { email: "faculty@demo.edu", password: "Faculty@123", role: "FACULTY", firstName: "Demo", lastName: "Faculty" },
  { email: "student@demo.edu", password: "Student@123", role: "STUDENT", firstName: "Demo", lastName: "Student" },
] as const;

/** Every role the RBAC guards check, so a 403 is always a decision and never a missing row. */
const ALL_ROLES = ["SUPER_ADMIN", "UNIVERSITY_ADMIN", "FACULTY", "STUDENT", "PARENT"] as const;

async function seedDemoTenant() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_SLUG },
    update: { status: "ACTIVE" },
    create: {
      slug: DEMO_SLUG,
      name: "Demo University",
      type: "UNIVERSITY",
      status: "ACTIVE",
      contactEmail: "admin@demo.edu",
      establishedYear: 2001,
    },
  });

  // ---- roles -------------------------------------------------------------
  const roles = new Map<string, string>();
  for (const name of ALL_ROLES) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name, isSystem: true },
    });
    roles.set(name, role.id);
  }

  // ---- users + role assignments -----------------------------------------
  const users = new Map<string, string>();
  for (const account of ACCOUNTS) {
    // Hashed per account rather than once, so each password is independently
    // salted — reusing one hash across users would make them interchangeable.
    const passwordHash = await hashPassword(account.password);

    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: account.email } },
      // The update branch re-hashes on every run, so re-seeding repairs an
      // account whose password was changed during testing.
      update: { passwordHash, isActive: true, isVerified: true },
      create: {
        tenantId: tenant.id,
        email: account.email,
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        isActive: true,
        isVerified: true,
      },
    });
    users.set(account.role, user.id);

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roles.get(account.role)! } },
      update: {},
      create: { userId: user.id, roleId: roles.get(account.role)! },
    });
  }

  // ---- institutional hierarchy ------------------------------------------
  const campus = await prisma.campus.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } },
    update: {},
    create: { tenantId: tenant.id, name: "Main Campus", code: "MAIN", isMain: true, email: "campus@demo.edu" },
  });

  const school = await prisma.school.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "SOE" } },
    update: {},
    create: { tenantId: tenant.id, campusId: campus.id, name: "School of Engineering", code: "SOE" },
  });

  const department = await prisma.department.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "CSE" } },
    update: {},
    create: {
      tenantId: tenant.id, campusId: campus.id, schoolId: school.id,
      name: "Computer Science and Engineering", code: "CSE", hodName: "Dr. Demo HOD",
    },
  });

  const programme = await prisma.programme.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "BTECH-CSE" } },
    update: {},
    create: {
      tenantId: tenant.id, departmentId: department.id,
      name: "B.Tech Computer Science", code: "BTECH-CSE",
      type: "UNDERGRADUATE", durationValue: 4, durationUnit: "YEARS", totalCredits: 160,
    },
  });

  // ---- calendar ----------------------------------------------------------
  const academicYear = await prisma.academicYear.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "2025-2026" } },
    update: { isCurrent: true },
    create: {
      tenantId: tenant.id, name: "2025-2026", isCurrent: true,
      startDate: new Date("2025-07-01T00:00:00.000Z"),
      endDate: new Date("2026-06-30T00:00:00.000Z"),
    },
  });

  const semester = await prisma.semester.upsert({
    where: { academicYearId_semesterNumber: { academicYearId: academicYear.id, semesterNumber: 1 } },
    update: { isCurrent: true },
    create: {
      tenantId: tenant.id, academicYearId: academicYear.id,
      name: "Semester 1", semesterNumber: 1, isCurrent: true,
      startDate: new Date("2025-07-01T00:00:00.000Z"),
      endDate: new Date("2025-12-31T00:00:00.000Z"),
    },
  });

  const batch = await prisma.batch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "CSE-2025" } },
    update: {},
    create: {
      tenantId: tenant.id, programmeId: programme.id, academicYearId: academicYear.id,
      name: "CSE 2025 Intake", code: "CSE-2025", maxStrength: 120,
    },
  });

  const section = await prisma.section.upsert({
    where: { batchId_semesterId_name: { batchId: batch.id, semesterId: semester.id, name: "A" } },
    update: {},
    create: { tenantId: tenant.id, batchId: batch.id, semesterId: semester.id, name: "A", maxStrength: 60 },
  });

  const course = await prisma.course.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "CS101" } },
    update: {},
    create: {
      tenantId: tenant.id, departmentId: department.id,
      name: "Introduction to Programming", code: "CS101", type: "CORE", credits: 4,
    },
  });

  // ---- people ------------------------------------------------------------
  // userId is @unique on both, so the natural key is the tenant-scoped employee
  // id / enrollment number and the link is repaired on re-run.
  const facultyMember = await prisma.facultyMember.upsert({
    where: { tenantId_employeeId: { tenantId: tenant.id, employeeId: "EMP-001" } },
    update: { userId: users.get("FACULTY")!, departmentId: department.id, status: "ACTIVE" },
    create: {
      tenantId: tenant.id, userId: users.get("FACULTY")!, employeeId: "EMP-001",
      departmentId: department.id, designation: "Assistant Professor",
      qualification: "Ph.D.", joinDate: new Date("2020-08-01T00:00:00.000Z"), status: "ACTIVE",
    },
  });

  const student = await prisma.student.upsert({
    where: { tenantId_enrollmentNo: { tenantId: tenant.id, enrollmentNo: "STU-2025-001" } },
    update: {
      userId: users.get("STUDENT")!, programmeId: programme.id,
      batchId: batch.id, sectionId: section.id, status: "ACTIVE",
    },
    create: {
      tenantId: tenant.id, userId: users.get("STUDENT")!, enrollmentNo: "STU-2025-001",
      programmeId: programme.id, batchId: batch.id, sectionId: section.id,
      currentSemester: 1, status: "ACTIVE",
      admissionDate: new Date("2025-07-01T00:00:00.000Z"),
    },
  });

  // ---- subscription ------------------------------------------------------
  // No natural unique key, so find-then-create rather than upsert.
  let subscription = await prisma.subscription.findFirst({ where: { tenantId: tenant.id } });
  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        tenantId: tenant.id, plan: "GROWTH", status: "ACTIVE", billingCycle: "MONTHLY",
        startDate: new Date("2025-07-01T00:00:00.000Z"),
        maxStudents: 5000, maxFaculty: 500, maxStorage: BigInt("107374182400"),
        pricePerMonth: "4999.00", currency: "INR",
      },
    });
  }

  return {
    tenantId: tenant.id, tenantSlug: tenant.slug,
    campusId: campus.id, schoolId: school.id, departmentId: department.id,
    programmeId: programme.id, academicYearId: academicYear.id, semesterId: semester.id,
    batchId: batch.id, sectionId: section.id, courseId: course.id,
    facultyMemberId: facultyMember.id, studentId: student.id,
    subscriptionId: subscription.id,
    userIds: Object.fromEntries(users),
  };
}

/**
 * The original Phase 2 verification tenant, retained so anything already built
 * against `verify-university` keeps working. Two accounts, no academic data.
 */
async function seedLegacyVerificationTenant() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "verify-university" },
    update: { status: "ACTIVE" },
    create: { slug: "verify-university", name: "Verify University", status: "ACTIVE" },
  });

  const passwordHash = await hashPassword("VerifyPass123!");

  for (const [email, roleName, firstName] of [
    ["superadmin@verify.test", "SUPER_ADMIN", "Super"],
    ["staff@verify.test", "UNIVERSITY_ADMIN", "Staff"],
  ] as const) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
      update: {},
      create: { tenantId: tenant.id, name: roleName, isSystem: true },
    });
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: { passwordHash, isActive: true },
      create: {
        tenantId: tenant.id, email, passwordHash,
        firstName, lastName: "Member", isActive: true, isVerified: true,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  return { tenantId: tenant.id, tenantSlug: tenant.slug };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production.");
  }

  const demo = await seedDemoTenant();
  const legacy = await seedLegacyVerificationTenant();

  // Printed as JSON so the ids can be pasted straight into a Postman
  // environment without hunting through the database.
  console.log(
    JSON.stringify(
      {
        demo,
        legacy,
        logins: ACCOUNTS.map((a) => ({ email: a.email, password: a.password, role: a.role, tenantSlug: DEMO_SLUG })),
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

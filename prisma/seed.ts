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
import { seedCmsTemplate, seedTenantLandingPage, seedTenantSiteChrome } from "./seedCms";

const DEMO_SLUG = "demo";

/**
 * The documented logins. Passwords are hashed with bcrypt, never stored raw.
 *
 * Phase 16 adds two. Both are needed rather than decorative: the evaluation
 * configuration endpoints are gated on CONTROLLER_OF_EXAMINATION for approval
 * actions and admit DEPARTMENT_HOD for reads, and requireRole resolves roles
 * LIVE against UserRole on every request. Without a user holding each role,
 * those code paths were unreachable — every manage endpoint answered 403 to
 * everyone except UNIVERSITY_ADMIN, and no read could be exercised as an HOD.
 */
// Every password here MUST satisfy loginSchema's `min(8)`. Two of these were
// seven characters, so the accounts seeded fine and then failed at the login
// validator with "Too small" — CONTROLLER_OF_EXAMINATION and DEPARTMENT_HOD
// were unreachable, and with them every code path that only those roles can
// exercise.
const ACCOUNTS = [
  { email: "superadmin@eduos.local", password: "SuperAdmin@123", role: "SUPER_ADMIN", firstName: "Super", lastName: "Admin" },
  { email: "admin@demo.edu", password: "Admin@123", role: "UNIVERSITY_ADMIN", firstName: "Uni", lastName: "Admin" },
  { email: "coe@demo.edu", password: "Coe@12345", role: "CONTROLLER_OF_EXAMINATION", firstName: "Demo", lastName: "Controller" },
  { email: "hod@demo.edu", password: "Hod@12345", role: "DEPARTMENT_HOD", firstName: "Demo", lastName: "Hod" },
  { email: "faculty@demo.edu", password: "Faculty@123", role: "FACULTY", firstName: "Demo", lastName: "Faculty" },
  { email: "student@demo.edu", password: "Student@123", role: "STUDENT", firstName: "Demo", lastName: "Student" },
] as const;

/**
 * Every role the RBAC guards check, so a 403 is always a decision and never a
 * missing row.
 *
 * CONTROLLER_OF_EXAMINATION and DEPARTMENT_HOD are the Phase 16 additions. The
 * spelling matches constants/roles.ts exactly — requireRole compares by
 * Role.name, so a mismatch here would be an unreachable permission rather than
 * a visible error.
 *
 * The pre-existing HOD constant in constants/roles.ts is deliberately NOT
 * seeded: it predates this phase, drives frontend portal routing only, and
 * seeding both spellings would create two rows that mean the same thing.
 */
const ALL_ROLES = [
  "SUPER_ADMIN",
  "UNIVERSITY_ADMIN",
  "CONTROLLER_OF_EXAMINATION",
  "DEPARTMENT_HOD",
  "FACULTY",
  "STUDENT",
  "PARENT",
] as const;

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

  // The demo department, headed by hod@demo.edu.
  //
  // `hodUserId` is set on BOTH branches, which is the point: before this the
  // update branch was `{}`, so a re-seed left an existing CSE row with no head
  // and the DEPARTMENT_HOD account had no department at all — every
  // department-scoped request from it was refused. Setting it on update makes
  // the seed repair that, which is what every other upsert here already does
  // for passwords.
  //
  // `hodName` is kept because it is what a university prints. It is NOT what
  // authorises anything — see the schema comment on Department.hodUserId.
  const department = await prisma.department.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "CSE" } },
    update: { hodUserId: users.get("DEPARTMENT_HOD")! },
    create: {
      tenantId: tenant.id, campusId: campus.id, schoolId: school.id,
      name: "Computer Science and Engineering", code: "CSE", hodName: "Dr. Demo HOD",
      hodUserId: users.get("DEPARTMENT_HOD")!,
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

  // ---- Phase 16 evaluation configuration ---------------------------------
  // A course registration must cite an ACTIVE evaluation scheme, and an active
  // scheme needs a grade scale and a coherent component tree beneath it. The
  // whole chain is therefore seeded here — which also means the Phase 16
  // endpoints have something to read, rather than answering 404 on a fresh
  // database.
  //
  // These writes bypass the services, so the invariants those services enforce
  // are satisfied by construction below: the bands tile [0.00, 100.00] with no
  // gap, and the two root components' weightages total exactly 100.
  const gradeScale = await prisma.gradeScale.upsert({
    where: { tenantId_code_version: { tenantId: tenant.id, code: "UG-10-POINT", version: 1 } },
    update: { status: "ACTIVE" },
    create: {
      tenantId: tenant.id, code: "UG-10-POINT", name: "Undergraduate 10 Point",
      version: 1, status: "ACTIVE", method: "ABSOLUTE", maxGradePoint: 10,
      activatedAt: new Date("2025-07-01T00:00:00.000Z"),
    },
  });

  // Inclusive on both ends, tiling [0.00, 100.00] in 0.01 steps with no gap and
  // no overlap — the rule the activation validator enforces. F is the lowest
  // band and the only one that is not a pass, so its ceiling IS this
  // regulation's overall pass mark; no passing criterion restates it.
  const GRADE_BANDS = [
    { grade: "O", label: "Outstanding", min: 90, max: 100, point: 10, isPass: true, sequence: 1 },
    { grade: "A", label: "Excellent", min: 80, max: 89.99, point: 9, isPass: true, sequence: 2 },
    { grade: "B", label: "Very Good", min: 70, max: 79.99, point: 8, isPass: true, sequence: 3 },
    { grade: "C", label: "Good", min: 60, max: 69.99, point: 7, isPass: true, sequence: 4 },
    { grade: "D", label: "Average", min: 50, max: 59.99, point: 6, isPass: true, sequence: 5 },
    { grade: "E", label: "Pass", min: 40, max: 49.99, point: 5, isPass: true, sequence: 6 },
    { grade: "F", label: "Fail", min: 0, max: 39.99, point: 0, isPass: false, sequence: 7 },
  ] as const;

  for (const band of GRADE_BANDS) {
    await prisma.gradeBand.upsert({
      where: { gradeScaleId_grade: { gradeScaleId: gradeScale.id, grade: band.grade } },
      update: {},
      create: {
        tenantId: tenant.id, gradeScaleId: gradeScale.id, grade: band.grade, label: band.label,
        minPercent: band.min, maxPercent: band.max, gradePoint: band.point,
        isPass: band.isPass, countsForGpa: true, sequence: band.sequence,
      },
    });
  }

  const evaluationScheme = await prisma.evaluationScheme.upsert({
    where: { tenantId_code_version: { tenantId: tenant.id, code: "BTECH-R2025", version: 1 } },
    update: { status: "ACTIVE", gradeScaleId: gradeScale.id },
    create: {
      tenantId: tenant.id, code: "BTECH-R2025", name: "B.Tech Regulation 2025",
      description: "Internal 30 / Theory 70, minimum 21 in theory.",
      version: 1, status: "ACTIVE", gradeScaleId: gradeScale.id,
      attemptPolicy: "LATEST_ATTEMPT", activatedAt: new Date("2025-07-01T00:00:00.000Z"),
    },
  });

  // Two leaves whose weightages total exactly 100 — the "University A" shape.
  // Both are leaves, so each declares an aggregation and no rollup.
  const COMPONENTS = [
    { code: "INTERNAL", name: "Internal Assessment", type: "INTERNAL", max: 30, weight: 30, sequence: 1 },
    { code: "THEORY", name: "University Theory", type: "THEORY", max: 70, weight: 70, sequence: 2 },
  ] as const;

  for (const component of COMPONENTS) {
    await prisma.evaluationComponent.upsert({
      where: { schemeId_code: { schemeId: evaluationScheme.id, code: component.code } },
      update: {},
      create: {
        tenantId: tenant.id, schemeId: evaluationScheme.id, code: component.code,
        name: component.name, type: component.type, sourceType: "MANUAL_ENTRY",
        maxMarks: component.max, weightage: component.weight,
        aggregation: "SUM", sequence: component.sequence, isMandatory: true,
      },
    });
  }

  const theory = await prisma.evaluationComponent.findUniqueOrThrow({
    where: { schemeId_code: { schemeId: evaluationScheme.id, code: "THEORY" } },
    select: { id: true },
  });

  // "Minimum Theory = 21" — a threshold the course total cannot express, which
  // is exactly what a passing criterion is for.
  await prisma.passingCriterion.upsert({
    where: { schemeId_code: { schemeId: evaluationScheme.id, code: "MIN-THEORY" } },
    update: {},
    create: {
      tenantId: tenant.id, schemeId: evaluationScheme.id, componentId: theory.id,
      code: "MIN-THEORY", name: "Minimum theory marks",
      metric: "COMPONENT_SCORE", threshold: 21, unit: "MARKS", failureOutcome: "FAIL",
    },
  });

  // ---- course registration -----------------------------------------------
  // The academic contract every downstream engine reads. Credits and the
  // programme are SNAPSHOTS: Course.credits is editable and Student.programmeId
  // is overwritten on transfer, so both are unrecoverable later.
  await prisma.courseRegistration.upsert({
    where: {
      studentId_courseId_attemptNumber: {
        studentId: student.id, courseId: course.id, attemptNumber: 1,
      },
    },
    update: { status: "CONFIRMED" },
    create: {
      tenantId: tenant.id, studentId: student.id, courseId: course.id,
      semesterId: semester.id, sectionId: section.id, programmeId: programme.id,
      evaluationSchemeId: evaluationScheme.id, credits: course.credits,
      registrationType: "REGULAR", attemptNumber: 1, status: "CONFIRMED",
    },
  });

  // ---- assessment event --------------------------------------------------
  // One OPEN sitting of the INTERNAL component, so mark entry has a target on a
  // fresh database. OPEN is the only status that accepts marks — that single
  // predicate is what locking means — so seeding it in any other state would
  // leave the marks endpoints with nothing to write against.
  const internalComponent = await prisma.evaluationComponent.findUniqueOrThrow({
    where: { schemeId_code: { schemeId: evaluationScheme.id, code: "INTERNAL" } },
    select: { id: true, maxMarks: true },
  });

  const theoryComponent = await prisma.evaluationComponent.findUniqueOrThrow({
    where: { schemeId_code: { schemeId: evaluationScheme.id, code: "THEORY" } },
    select: { id: true, maxMarks: true },
  });

  // ONE SITTING PER COMPONENT.
  //
  // Both components are isMandatory, and a course total cannot be computed
  // while a mandatory component has no sitting to be marked against. Seeding
  // only the internal one left every SGPA, CGPA, grade and transcript line
  // null — the screens rendered, but with nothing in them.
  // conductedById is what entitles a lecturer to enter marks: the mark service
  // refuses FACULTY unless the sitting names them (FACULTY_NOT_CONDUCTOR), and
  // a sitting with no conductor accepts no faculty entry at all.
  //
  // Internal assessment IS conducted by the lecturer who teaches the course, so
  // the seeded sitting names them. The university theory paper deliberately has
  // NO conductor — the schema calls it "a university-conducted theory paper sat
  // by the whole cohort", and its marks come from the examination office
  // through the external endpoint, not from a lecturer.
  const SITTINGS = [
    {
      component: internalComponent,
      title: "Internal Assessment — Sitting 1",
      conductedById: facultyMember.id as string | null,
    },
    {
      component: theoryComponent,
      title: "University Theory Examination",
      conductedById: null,
    },
  ] as const;

  for (const sitting of SITTINGS) {
    await prisma.assessmentEvent.upsert({
      where: {
        evaluationComponentId_courseId_semesterId_sectionId_sequenceNumber: {
          evaluationComponentId: sitting.component.id,
          courseId: course.id,
          semesterId: semester.id,
          sectionId: section.id,
          sequenceNumber: 1,
        },
      },
      update: { status: "OPEN", conductedById: sitting.conductedById },
      create: {
        tenantId: tenant.id, evaluationComponentId: sitting.component.id,
        courseId: course.id, semesterId: semester.id, sectionId: section.id,
        conductedById: sitting.conductedById,
        title: sitting.title,
        // Defaulted from the component: this paper is marked out of the same
        // total the component contributes on, which is the ordinary case.
        maxMarks: sitting.component.maxMarks, sequenceNumber: 1,
        status: "OPEN",
      },
    });
  }

  // ---- teaching relationship ---------------------------------------------
  // WHY BOTH MODELS
  //   lib/services/facultyTeaching.ts accepts EITHER a Timetable slot or a
  //   FacultyCourseAssignment as proof that a lecturer teaches a (section,
  //   course) pair, and both the roster read and the attendance write consult
  //   it. Seeding both exercises both branches, and the Timetable is what the
  //   faculty schedule and attendance screens actually read to discover which
  //   classes the lecturer may open.
  //
  //   Without either row the seeded lecturer is refused by facultyMayMarkRecords
  //   and the whole teaching flow 403s on a fresh database.
  await prisma.facultyCourseAssignment.upsert({
    where: {
      facultyId_courseId_sectionId_semesterId: {
        facultyId: facultyMember.id,
        courseId: course.id,
        sectionId: section.id,
        semesterId: semester.id,
      },
    },
    update: { isActive: true },
    create: {
      tenantId: tenant.id,
      facultyId: facultyMember.id,
      courseId: course.id,
      sectionId: section.id,
      semesterId: semester.id,
      isActive: true,
    },
  });

  // Timetable has no natural unique key, so find-then-create — the same
  // pattern the subscription below uses. The (faculty, section, course, day,
  // startTime) tuple is what makes a re-run recognise its own row.
  const SLOT = {
    day: "MONDAY",
    startTime: "09:00",
    endTime: "10:00",
  } as const;

  let timetableSlot = await prisma.timetable.findFirst({
    where: {
      tenantId: tenant.id,
      facultyId: facultyMember.id,
      sectionId: section.id,
      courseId: course.id,
      day: SLOT.day,
      startTime: SLOT.startTime,
    },
    select: { id: true },
  });

  if (!timetableSlot) {
    timetableSlot = await prisma.timetable.create({
      data: {
        tenantId: tenant.id,
        semesterId: semester.id,
        sectionId: section.id,
        courseId: course.id,
        facultyId: facultyMember.id,
        day: SLOT.day,
        startTime: SLOT.startTime,
        endTime: SLOT.endTime,
        roomNo: "LH-101",
        sessionType: "LECTURE",
        isActive: true,
      },
      select: { id: true },
    });
  }

  // ---- attendance ---------------------------------------------------------
  // Five sittings of the timetabled slot, four present and one absent, so the
  // student's percentage is a real 80% rather than a vacuous 0% or 100% — the
  // shortage threshold in attendanceAnalytics is 75%, and a demo that sits
  // exactly on a boundary teaches nothing.
  //
  // The unique key is (studentId, courseId, date, sessionType), so a re-run
  // updates the same five rows rather than appending another five.
  const ATTENDANCE_DAYS: ReadonlyArray<{ date: string; status: "PRESENT" | "ABSENT" }> = [
    { date: "2025-08-04T00:00:00.000Z", status: "PRESENT" },
    { date: "2025-08-11T00:00:00.000Z", status: "PRESENT" },
    { date: "2025-08-18T00:00:00.000Z", status: "ABSENT" },
    { date: "2025-08-25T00:00:00.000Z", status: "PRESENT" },
    { date: "2025-09-01T00:00:00.000Z", status: "PRESENT" },
  ];

  for (const entry of ATTENDANCE_DAYS) {
    await prisma.attendance.upsert({
      where: {
        studentId_courseId_date_sessionType: {
          studentId: student.id,
          courseId: course.id,
          date: new Date(entry.date),
          sessionType: "LECTURE",
        },
      },
      update: { status: entry.status },
      create: {
        tenantId: tenant.id,
        studentId: student.id,
        facultyId: facultyMember.id,
        sectionId: section.id,
        courseId: course.id,
        timetableId: timetableSlot.id,
        date: new Date(entry.date),
        status: entry.status,
        sessionType: "LECTURE",
        source: "MANUAL",
        markedBy: users.get("FACULTY")!,
      },
    });
  }

  // ---- marks --------------------------------------------------------------
  // The reason every result screen was empty. Results are COMPUTED, never
  // stored, so a StudentComponentScore is the only input that turns the whole
  // engine — SGPA, CGPA, transcript, analytics, semester roll-up — from an
  // empty shell into a real answer.
  //
  // 34 of 40 on the internal sitting: a genuine pass that is not a perfect
  // score, so grade banding and the pass criteria are both exercised.
  const seededRegistration = await prisma.courseRegistration.findUniqueOrThrow({
    where: {
      studentId_courseId_attemptNumber: {
        studentId: student.id,
        courseId: course.id,
        attemptNumber: 1,
      },
    },
    select: { id: true },
  });

  // A mark per sitting. The values are deliberately ordinary: 25 of 30 internal
  // and 52 of 70 theory. Neither is a perfect score, both are within their
  // component maximum, and 52 clears the MIN-THEORY criterion of 21 — so the
  // student genuinely passes and the grade banding, the weighted roll-up and
  // the passing criterion are all exercised rather than short-circuited.
  //
  // A mark ABOVE the component maximum would be rejected by the mark service
  // and is meaningless to the engine; the earlier draft of this seed wrote 34
  // against a component whose maximum is 30, which is why nothing computed.
  const MARKS = [
    { component: internalComponent, obtained: "25.00" },
    { component: theoryComponent, obtained: "52.00" },
  ] as const;

  for (const entry of MARKS) {
    const event = await prisma.assessmentEvent.findUniqueOrThrow({
      where: {
        evaluationComponentId_courseId_semesterId_sectionId_sequenceNumber: {
          evaluationComponentId: entry.component.id,
          courseId: course.id,
          semesterId: semester.id,
          sectionId: section.id,
          sequenceNumber: 1,
        },
      },
      select: { id: true },
    });

    await prisma.studentComponentScore.upsert({
      where: {
        assessmentEventId_courseRegistrationId: {
          assessmentEventId: event.id,
          courseRegistrationId: seededRegistration.id,
        },
      },
      update: { marksObtained: entry.obtained, status: "RECORDED" },
      create: {
        tenantId: tenant.id,
        assessmentEventId: event.id,
        courseRegistrationId: seededRegistration.id,
        marksObtained: entry.obtained,
        status: "RECORDED",
        remarks: "Seeded demo mark.",
      },
    });
  }

  // ---- assignment ---------------------------------------------------------
  // PUBLISHED, so the student portal has something to see; DRAFT would be
  // invisible to them and the demo would look broken from the student side.
  // No natural unique key on Assignment, so find-then-create.
  let assignment = await prisma.assignment.findFirst({
    where: { tenantId: tenant.id, courseId: course.id, title: "Assignment 1 — Variables and Control Flow" },
    select: { id: true },
  });

  if (!assignment) {
    assignment = await prisma.assignment.create({
      data: {
        tenantId: tenant.id,
        courseId: course.id,
        sectionId: section.id,
        createdBy: users.get("FACULTY")!,
        title: "Assignment 1 — Variables and Control Flow",
        description:
          "Implement the exercises from chapters 1-3 and submit a single source file.",
        type: "HOMEWORK",
        status: "PUBLISHED",
        maxMarks: 20,
        dueDate: new Date("2025-09-15T18:00:00.000Z"),
        publishedAt: new Date("2025-09-01T09:00:00.000Z"),
      },
      select: { id: true },
    });
  }

  // ---- examination --------------------------------------------------------
  // One SCHEDULED mid-term, so the faculty Exams screen and the student
  // Examinations screen both have a real row. This seeds DATA for the existing
  // examination surface only; it introduces no workflow stage.
  let examination = await prisma.examination.findFirst({
    where: { tenantId: tenant.id, courseId: course.id, title: "CS101 Mid-Semester Examination" },
    select: { id: true },
  });

  if (!examination) {
    examination = await prisma.examination.create({
      data: {
        tenantId: tenant.id,
        semesterId: semester.id,
        courseId: course.id,
        title: "CS101 Mid-Semester Examination",
        type: "MID_TERM",
        status: "SCHEDULED",
        date: new Date("2025-10-06T00:00:00.000Z"),
        startTime: "10:00",
        endTime: "12:00",
        venue: "Examination Hall 1",
        maxMarks: 50,
        passMark: 20,
        duration: 120,
        instructions: "Answer all questions. No electronic devices permitted.",
      },
      select: { id: true },
    });
  }

  // ---- AT COE examination -------------------------------------------------
  // A second examination in the SAME semester as the seeded course
  // registration, so the eligibility roll resolves a real cohort rather than an
  // empty one. The mid-term above sits in its own semester and is left alone.
  //
  // Named "AT COE Examination" so it is identifiable in the demo tenant. No
  // natural unique key on Examination, so find-then-create.
  let coeExamination = await prisma.examination.findFirst({
    where: { tenantId: tenant.id, courseId: course.id, title: "AT COE Examination" },
    select: { id: true },
  });

  if (!coeExamination) {
    coeExamination = await prisma.examination.create({
      data: {
        tenantId: tenant.id,
        semesterId: semester.id,
        courseId: course.id,
        title: "AT COE Examination",
        type: "END_TERM",
        status: "SCHEDULED",
        date: new Date("2025-12-10T00:00:00.000Z"),
        startTime: "10:00",
        endTime: "13:00",
        venue: "AT Hall 1",
        maxMarks: 100,
        passMark: 40,
        duration: 180,
        instructions: "Answer all questions.",
      },
      select: { id: true },
    });
  }

  // NO HALL TICKET IS SEEDED, DELIBERATELY.
  //   A hall ticket records that the examination office ISSUED a document. The
  //   demo should show that act being performed, not pre-performed — and
  //   seeding one would also bypass the eligibility gate that issuing exists to
  //   apply. The COE issues them from the examination screen.

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
    timetableId: timetableSlot.id, assignmentId: assignment.id,
    examinationId: examination.id, coeExaminationId: coeExamination.id,
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

  // W4 — the platform's default landing template, and the demo tenant's own
  // page copied from it. Ordered after the tenants because the page needs a
  // tenantId, and the template needs nothing at all.
  const cmsTemplate = await seedCmsTemplate(prisma);
  const cmsPage = await seedTenantLandingPage(prisma, demo.tenantId, "Demo University");
  const cmsChrome = await seedTenantSiteChrome(prisma, demo.tenantId, "Demo University");

  // Printed as JSON so the ids can be pasted straight into a Postman
  // environment without hunting through the database.
  console.log(
    JSON.stringify(
      {
        demo,
        legacy,
        cmsTemplate,
        cmsPage,
        cmsChrome,
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

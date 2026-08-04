// ============================================================================
// MODULE : Mock Data — People
// PURPOSE: The tenant's users, and the student, faculty and employee records
//          attached to them.
//
//          Generated from name pools rather than hand-listed: two hundred rows
//          whose only interesting properties are that each references a real
//          programme, batch and section, and that the mix of statuses exercises
//          every badge and filter. Listing them by hand would be pages of noise
//          with more chance of a broken foreign key.
//
//          Generation is seeded (see seededPick / seededInt), so the output is
//          identical on every render and every process. Math.random() here would
//          reshuffle the directory between a page's fetch and the next one.
//
//          Note what the API does *not* return: Student, FacultyMember and
//          Employee carry no name — the routes select scalar columns only and
//          expand no relation. A name is reached through the linked User, which
//          is why *WithUser types exist and are composed here rather than
//          pretended into the base entity.
// ============================================================================

import type {
  Employee,
  EmployeeWithUser,
  FacultyMember,
  FacultyWithUser,
  Student,
  StudentWithUser,
  User,
} from "@/types";
import { daysAgo, seededInt, seededPick } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import {
  CURRENT_ACADEMIC_YEAR,
  MOCK_BATCHES,
  MOCK_DEPARTMENTS,
  MOCK_PROGRAMMES,
  MOCK_SECTIONS,
  MOCK_SPECIALISATIONS,
} from "./academics";

const FIRST_NAMES = [
  "Aarav", "Ananya", "Rohan", "Priya", "Vikram", "Meera", "Arjun", "Kavya",
  "Rahul", "Sneha", "Karan", "Divya", "Aditya", "Ishita", "Siddharth", "Nisha",
  "Manish", "Pooja", "Rajat", "Shreya", "Nikhil", "Anjali", "Varun", "Tanvi",
  "Harsh", "Riya", "Aman", "Neha", "Kabir", "Sanya",
];

const LAST_NAMES = [
  "Sharma", "Verma", "Patel", "Reddy", "Nair", "Iyer", "Singh", "Gupta",
  "Mehta", "Joshi", "Rao", "Desai", "Bhatt", "Kulkarni", "Chauhan", "Malhotra",
];

/** Distribution of student statuses across the directory. */
const STUDENT_STATUS_POOL: Student["status"][] = [
  // Weighted heavily to ACTIVE — a real register is mostly active students, and
  // an even spread would make the default view unrepresentative.
  "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE",
  "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE",
  "ON_LEAVE", "SUSPENDED", "WITHDRAWN", "GRADUATED", "TRANSFERRED", "INACTIVE",
];

const FACULTY_DESIGNATIONS = [
  "Professor", "Associate Professor", "Assistant Professor", "Lecturer", "Visiting Faculty",
];

const QUALIFICATIONS = ["Ph.D", "M.Tech", "M.Sc", "MBA", "M.Phil"];

const EMPLOYEE_DESIGNATIONS = [
  "Registrar", "Accounts Officer", "Librarian", "Lab Technician", "Admissions Counsellor",
  "IT Support Engineer", "Hostel Warden", "Transport Coordinator", "Office Assistant",
];

const STUDENT_COUNT = 186;
const FACULTY_COUNT = 42;
const EMPLOYEE_COUNT = 24;

function fullName(seed: string): { firstName: string; lastName: string } {
  return {
    firstName: seededPick(FIRST_NAMES, `${seed}-first`),
    lastName: seededPick(LAST_NAMES, `${seed}-last`),
  };
}

function buildUser(
  index: number,
  seed: string,
  emailDomain: string,
  prefix: string
): User {
  const { firstName, lastName } = fullName(seed);
  const createdAt = daysAgo(seededInt(30, 900, `${seed}-created`));

  return {
    id: mockId(prefix, index),
    tenantId: MOCK_TENANT_ID,
    // Local part carries the index so no two generated users collide on
    // (tenantId, email), which the schema makes unique.
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${emailDomain}`,
    phone: `+91 ${seededInt(70000, 99999, `${seed}-p1`)} ${seededInt(10000, 99999, `${seed}-p2`)}`,
    firstName,
    lastName,
    displayName: null,
    avatarUrl: null,
    // A small share are deactivated — people who have left but whose record is
    // kept. Without any, the "Inactive" badge and the status filter on the user
    // directory would have nothing to render and would ship untested.
    isActive: seededInt(0, 20, `${seed}-active`) > 1,
    isVerified: seededInt(0, 10, `${seed}-verified`) > 2,
    // Someone who has never signed in is a real and common state — a pending
    // invite — and the directory renders "Never" for it.
    lastLoginAt:
      seededInt(0, 10, `${seed}-everloggedin`) > 1
        ? daysAgo(seededInt(0, 45, `${seed}-login`))
        : null,
    createdAt,
    updatedAt: createdAt,
  };
}

// --- Students ---------------------------------------------------------------

const activeProgrammes = MOCK_PROGRAMMES.filter((p) => p.isActive);
const currentBatches = MOCK_BATCHES.filter((b) => b.academicYearId === CURRENT_ACADEMIC_YEAR.id);

export const MOCK_STUDENT_USERS: User[] = Array.from({ length: STUDENT_COUNT }, (_, i) =>
  buildUser(i + 1, `student-${i}`, "student.verify.edu", "usr_stu")
);

export const MOCK_STUDENTS: Student[] = MOCK_STUDENT_USERS.map((user, i): Student => {
  const seed = `student-${i}`;

  // The batch is chosen first, and programme is then read *from* the batch
  // rather than picked separately. Picking both independently would produce
  // students enrolled in a programme their batch does not belong to.
  const batch = seededPick(currentBatches, `${seed}-batch`);
  const programme = activeProgrammes.find((p) => p.id === batch.programmeId)!;
  const sections = MOCK_SECTIONS.filter((s) => s.batchId === batch.id);
  const specialisations = MOCK_SPECIALISATIONS.filter((s) => s.programmeId === programme.id);

  const status = seededPick(STUDENT_STATUS_POOL, `${seed}-status`);
  const admissionYear = Number(CURRENT_ACADEMIC_YEAR.name.slice(0, 4));

  return {
    id: mockId("stu", i + 1),
    tenantId: MOCK_TENANT_ID,
    userId: user.id,
    // Mirrors the configurable ID format in the product spec:
    // <programme code>/<admission year>/<serial>.
    enrollmentNo: `${programme.code}/${admissionYear}/${String(i + 1).padStart(4, "0")}`,
    programmeId: programme.id,
    batchId: batch.id,
    sectionId: sections.length > 0 ? seededPick(sections, `${seed}-section`).id : null,
    // Only some programmes offer specialisations, and a student picks one later
    // in the course — so this is null for many rows by design, not by omission.
    specialisationId:
      specialisations.length > 0 && seededInt(0, 10, `${seed}-spec`) > 4
        ? seededPick(specialisations, `${seed}-spec-pick`).id
        : null,
    currentSemester: seededInt(1, programme.durationValue * 2, `${seed}-sem`),
    status,
    admissionDate: daysAgo(seededInt(60, 400, `${seed}-admitted`)),
    graduationDate: status === "GRADUATED" ? daysAgo(seededInt(10, 50, `${seed}-grad`)) : null,
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  };
});

const STUDENT_USER_BY_ID = new Map(MOCK_STUDENT_USERS.map((u) => [u.id, u]));

/** Students joined to their User, for any screen that shows a name. */
export const MOCK_STUDENTS_WITH_USER: StudentWithUser[] = MOCK_STUDENTS.map((student) => {
  const user = STUDENT_USER_BY_ID.get(student.userId)!;
  return {
    ...student,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    fullName: `${user.firstName} ${user.lastName}`,
  };
});

// --- Faculty ----------------------------------------------------------------

export const MOCK_FACULTY_USERS: User[] = Array.from({ length: FACULTY_COUNT }, (_, i) =>
  buildUser(i + 1, `faculty-${i}`, "verify.edu", "usr_fac")
);

export const MOCK_FACULTY: FacultyMember[] = MOCK_FACULTY_USERS.map(
  (user, i): FacultyMember => {
    const seed = `faculty-${i}`;
    const department = seededPick(MOCK_DEPARTMENTS, `${seed}-dept`);
    const designation = seededPick(FACULTY_DESIGNATIONS, `${seed}-desig`);

    return {
      id: mockId("fac", i + 1),
      tenantId: MOCK_TENANT_ID,
      userId: user.id,
      employeeId: `FAC/${String(i + 1).padStart(4, "0")}`,
      departmentId: department.id,
      designation,
      qualification: seededPick(QUALIFICATIONS, `${seed}-qual`),
      specialization: department.name,
      // Experience tracks seniority rather than being independent of it — a
      // professor with two years' experience would read as fixture noise.
      experience:
        designation === "Professor"
          ? seededInt(15, 30, `${seed}-exp`)
          : designation === "Associate Professor"
            ? seededInt(8, 16, `${seed}-exp`)
            : seededInt(1, 8, `${seed}-exp`),
      status: seededInt(0, 20, `${seed}-status`) > 1 ? "ACTIVE" : "ON_LEAVE",
      joinDate: daysAgo(seededInt(120, 3000, `${seed}-joined`)),
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
    };
  }
);

const FACULTY_USER_BY_ID = new Map(MOCK_FACULTY_USERS.map((u) => [u.id, u]));

export const MOCK_FACULTY_WITH_USER: FacultyWithUser[] = MOCK_FACULTY.map((faculty) => {
  const user = FACULTY_USER_BY_ID.get(faculty.userId)!;
  return {
    ...faculty,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    fullName: `${user.firstName} ${user.lastName}`,
  };
});

// --- Employees --------------------------------------------------------------

export const MOCK_EMPLOYEE_USERS: User[] = Array.from({ length: EMPLOYEE_COUNT }, (_, i) =>
  buildUser(i + 1, `employee-${i}`, "verify.edu", "usr_emp")
);

export const MOCK_EMPLOYEES: Employee[] = MOCK_EMPLOYEE_USERS.map((user, i): Employee => {
  const seed = `employee-${i}`;
  return {
    id: mockId("emp", i + 1),
    tenantId: MOCK_TENANT_ID,
    userId: user.id,
    employeeId: `EMP/${String(i + 1).padStart(4, "0")}`,
    departmentId: seededPick(MOCK_DEPARTMENTS, `${seed}-dept`).id,
    designation: seededPick(EMPLOYEE_DESIGNATIONS, `${seed}-desig`),
    type: seededPick(
      ["NON_TEACHING", "NON_TEACHING", "NON_TEACHING", "CONTRACT", "VISITING"] as const,
      `${seed}-type`
    ),
    status: seededInt(0, 20, `${seed}-status`) > 1 ? "ACTIVE" : "ON_LEAVE",
    joinDate: daysAgo(seededInt(90, 2400, `${seed}-joined`)),
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  };
});

const EMPLOYEE_USER_BY_ID = new Map(MOCK_EMPLOYEE_USERS.map((u) => [u.id, u]));

export const MOCK_EMPLOYEES_WITH_USER: EmployeeWithUser[] = MOCK_EMPLOYEES.map((employee) => {
  const user = EMPLOYEE_USER_BY_ID.get(employee.userId)!;
  return {
    ...employee,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    fullName: `${user.firstName} ${user.lastName}`,
  };
});

/** Every user in the tenant — students, faculty and staff — for the user directory. */
export const MOCK_USERS: User[] = [
  ...MOCK_FACULTY_USERS,
  ...MOCK_EMPLOYEE_USERS,
  ...MOCK_STUDENT_USERS,
];

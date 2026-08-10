// ============================================================================
// MODULE : Constants — Initial data import catalogue (W1.6)
// SOURCE : PRD §5.1 #14 "Import initial university data", §54 "Migration
//          modules should include: … Programme and course migration …",
//          §55 Stage 3 "Data templates".
// PURPOSE: The entities a platform operator may import by CSV, and the exact
//          columns each accepts.
//
// WHERE THE COLUMNS COME FROM
//   §54 names the migration MODULES and defines no columns for any of them, so
//   every column below is a writable field of the existing Prisma model and
//   nothing else. No field is invented, renamed or added for convenience.
//
// CREDENTIALS FOR IMPORTED PEOPLE — APPROVED DECISION, NOT AN ASSUMPTION
//   Student, FacultyMember and Employee each require a User, and
//   User.passwordHash is NOT NULL. The approved policy is the W1.4 mechanism
//   reused unchanged: a cryptographically generated temporary password, only
//   its bcrypt hash stored, mustChangePassword = true, and the plaintext
//   returned ONCE in the import response for a one-time credentials download.
//   A `password` column in the source CSV is refused — every person schema is
//   strict, so supplying one is a 400.
//
// IDENTIFIERS ARE THE ENGINE'S, NOT THIS MODULE'S (PRD §9)
//   Where a person entity may omit its identifier, `identifierEntity` names the
//   type the existing engine issues for. STUDENT, FACULTY and EMPLOYEE are all
//   in IDENTIFIER_ENTITIES, so nothing here asks for a number the engine cannot
//   produce. A legacy identifier supplied by a migration file is preserved
//   exactly as given — which is the point of migrating one.
//
// TEMPLATES (§55 Stage 3 "Data templates") ARE DERIVED FROM THIS FILE
//   The downloadable CSV template, the header validation and the UI's column
//   documentation all read these definitions, so they cannot disagree.
// ============================================================================

/** How a column is treated by validation and by the generated template. */
export interface ImportColumn {
  readonly name: string;
  readonly required: boolean;
  /** Shown in the UI and in the template's guidance row. */
  readonly description: string;
  /** Permitted values, when the underlying column is an enum. */
  readonly enumValues?: readonly string[];
}

export interface ImportEntityDefinition {
  readonly key: string;
  readonly label: string;
  /** The Prisma model this writes. One entity, one model. */
  readonly model: string;
  readonly prdSource: string;
  /** The business identifier a duplicate is detected on. */
  readonly duplicateKey: string;
  readonly columns: readonly ImportColumn[];
  /** Entities that must be imported or configured first. */
  readonly dependsOn: readonly string[];
  /**
   * This entity creates a User, so importing it issues credentials.
   *
   * Drives three things that must not diverge: the lower row cap (each account
   * costs a bcrypt hash), the credentials returned once by a commit, and the
   * warning the UI shows before the operator navigates away.
   */
  readonly createsUser?: boolean;
  /**
   * The identifier engine's entity type (PRD §9), when the file may omit the
   * identifier. Only STUDENT, FACULTY, EMPLOYEE and CERTIFICATE are supported
   * by the engine, so nothing here can name one it cannot issue.
   */
  readonly identifierEntity?: "STUDENT" | "FACULTY" | "EMPLOYEE";
  /** The column the identifier lands in — enrollmentNo, or employeeId. */
  readonly identifierColumn?: string;
  /**
   * The EXISTING tenant role granted to each imported person.
   *
   * A constant, never a CSV column: nothing in a file may choose what authority
   * an imported account receives. The role is resolved by NAME within the
   * tenant — the same identifier requireRole compares on — and must already
   * exist. Import never creates a Role.
   *
   * Absent for Employee, and that is a finding rather than an oversight: the
   * product defines no non-teaching-staff role. The enforced vocabulary is
   * SUPER_ADMIN, UNIVERSITY_ADMIN, FACULTY and STUDENT; the wider list adds
   * CAMPUS_ADMIN, HOD, DEPARTMENT_HOD, CONTROLLER_OF_EXAMINATION and PARENT.
   * None describes an employee, homeRouteForRoles routes none of them to an
   * employee portal, and no such portal exists — §57 lists "Employees" as a
   * screen the ADMIN uses, not a portal an employee signs into. Granting one of
   * the existing roles would hand a clerk a portal they have no business in.
   */
  readonly roleName?: "STUDENT" | "FACULTY";
}

/** Mirrors Prisma enum CourseType. */
const COURSE_TYPES = ["CORE", "ELECTIVE", "AUDIT", "LAB", "PROJECT", "SEMINAR"] as const;

/** Mirrors Prisma enum ProgrammeType. */
const PROGRAMME_TYPES = [
  "UNDERGRADUATE",
  "POSTGRADUATE",
  "DIPLOMA",
  "CERTIFICATE",
  "PHD",
  "INTEGRATED",
] as const;

/** Mirrors Prisma enum DurationUnit. */
const DURATION_UNITS = ["YEARS", "MONTHS", "SEMESTERS"] as const;

/** Mirrors Prisma enum StudentStatus. */
const STUDENT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "GRADUATED",
  "WITHDRAWN",
  "SUSPENDED",
  "ON_LEAVE",
  "TRANSFERRED",
] as const;

/** Mirrors Prisma enum EmployeeStatus. */
const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE", "ON_LEAVE", "TERMINATED", "RETIRED"] as const;

/** Mirrors Prisma enum EmployeeType. */
const EMPLOYEE_TYPES = ["TEACHING", "NON_TEACHING", "VISITING", "ADJUNCT", "CONTRACT"] as const;

/** The three columns every person entity shares, because each creates a User. */
const PERSON_COLUMNS: readonly ImportColumn[] = [
  { name: "firstName", required: true, description: "Given name." },
  { name: "lastName", required: true, description: "Family name." },
  {
    name: "email",
    required: true,
    description: "Unique within the university. Becomes their sign-in address.",
  },
  { name: "phone", required: false, description: "Contact number." },
];

export const IMPORT_ENTITIES: readonly ImportEntityDefinition[] = [
  {
    key: "course",
    label: "Courses",
    model: "Course",
    prdSource: "§54 — Programme and course migration",
    duplicateKey: "code",
    // Course.departmentId is nullable, so a course needs nothing to exist
    // first. It is the only importable entity with no prerequisite.
    dependsOn: [],
    columns: [
      { name: "code", required: true, description: "Unique within the university." },
      { name: "name", required: true, description: "Course title." },
      {
        name: "type",
        required: false,
        description: "Defaults to CORE when blank.",
        enumValues: COURSE_TYPES,
      },
      { name: "credits", required: false, description: "Whole number. Defaults to 3." },
      {
        name: "departmentCode",
        required: false,
        // Resolved to a Department id, scoped to this tenant. The CSV never
        // carries an id: an id from another university would otherwise attach
        // the course to somebody else's department.
        description: "Existing department code. Leave blank for none.",
      },
      { name: "description", required: false, description: "Free text." },
    ],
  },
  {
    key: "programme",
    label: "Programmes",
    model: "Programme",
    prdSource: "§54 — Programme and course migration",
    duplicateKey: "code",
    // Programme.departmentId is NOT NULL, so departments — and therefore
    // campuses — must exist before programmes can be imported.
    dependsOn: ["Campus", "Department"],
    columns: [
      { name: "code", required: true, description: "Unique within the university." },
      { name: "name", required: true, description: "Programme title." },
      {
        name: "departmentCode",
        required: true,
        description: "Existing department code. Required — a programme belongs to a department.",
      },
      {
        name: "type",
        required: false,
        description: "Defaults to UNDERGRADUATE when blank.",
        enumValues: PROGRAMME_TYPES,
      },
      { name: "durationValue", required: true, description: "Whole number, at least 1." },
      {
        name: "durationUnit",
        required: false,
        description: "Defaults to YEARS when blank.",
        enumValues: DURATION_UNITS,
      },
      { name: "totalCredits", required: false, description: "Whole number." },
      { name: "eligibility", required: false, description: "Free text." },
    ],
  },
  {
    key: "student",
    label: "Students",
    model: "Student",
    prdSource: "§54 — Student migration",
    // A person is identified by their address: it is what User is unique on and
    // what a re-import must recognise. enrollmentNo may be absent from the file
    // entirely, so it cannot be the key.
    duplicateKey: "email",
    createsUser: true,
    identifierEntity: "STUDENT",
    identifierColumn: "enrollmentNo",
    roleName: "STUDENT",
    dependsOn: [],
    columns: [
      ...PERSON_COLUMNS,
      {
        name: "admissionDate",
        required: true,
        description: "YYYY-MM-DD. Student.admissionDate is required by the model.",
      },
      {
        name: "enrollmentNo",
        required: false,
        // PRD §9 — the identifier engine issues one when the caller omits it,
        // exactly as POST /api/students already does. A legacy number supplied
        // by a migration file is preserved as given.
        description:
          "Existing enrolment number. Leave blank to have the identifier engine issue one.",
      },
      { name: "programmeCode", required: false, description: "Existing programme code." },
      {
        name: "currentSemester",
        required: false,
        description: "Whole number. Defaults to 1.",
      },
      {
        name: "status",
        required: false,
        description: "Defaults to ACTIVE when blank.",
        enumValues: STUDENT_STATUSES,
      },
    ],
  },
  {
    key: "faculty",
    label: "Faculty",
    model: "FacultyMember",
    prdSource: "§54 — Faculty and employee migration",
    duplicateKey: "email",
    createsUser: true,
    identifierEntity: "FACULTY",
    identifierColumn: "employeeId",
    roleName: "FACULTY",
    dependsOn: [],
    columns: [
      ...PERSON_COLUMNS,
      {
        name: "joinDate",
        required: true,
        description: "YYYY-MM-DD. FacultyMember.joinDate is required by the model.",
      },
      {
        name: "employeeId",
        required: false,
        description:
          "Existing staff number. Leave blank to have the identifier engine issue one.",
      },
      { name: "departmentCode", required: false, description: "Existing department code." },
      { name: "designation", required: false, description: "Job title." },
      { name: "qualification", required: false, description: "Highest qualification." },
      { name: "specialization", required: false, description: "Area of specialism." },
      { name: "experience", required: false, description: "Whole years." },
      {
        name: "status",
        required: false,
        description: "Defaults to ACTIVE when blank.",
        enumValues: EMPLOYEE_STATUSES,
      },
    ],
  },
  {
    key: "employee",
    label: "Employees",
    model: "Employee",
    prdSource: "§54 — Faculty and employee migration",
    duplicateKey: "email",
    createsUser: true,
    identifierEntity: "EMPLOYEE",
    identifierColumn: "employeeId",
    // No roleName — see ImportEntityDefinition.roleName. The product defines no
    // employee role and no employee portal, so an imported Employee is a
    // managed record rather than a portal user. Recorded as TD-W16-4.
    
    dependsOn: [],
    columns: [
      ...PERSON_COLUMNS,
      {
        name: "joinDate",
        required: true,
        description: "YYYY-MM-DD. Employee.joinDate is required by the model.",
      },
      {
        name: "employeeId",
        required: false,
        description:
          "Existing staff number. Leave blank to have the identifier engine issue one.",
      },
      { name: "departmentCode", required: false, description: "Existing department code." },
      { name: "designation", required: false, description: "Job title." },
      {
        name: "type",
        required: false,
        description: "Defaults to NON_TEACHING when blank.",
        enumValues: EMPLOYEE_TYPES,
      },
      {
        name: "status",
        required: false,
        description: "Defaults to ACTIVE when blank.",
        enumValues: EMPLOYEE_STATUSES,
      },
    ],
  },
] as const;

const BY_KEY = new Map(IMPORT_ENTITIES.map((entity) => [entity.key, entity]));

export function getImportEntity(key: string): ImportEntityDefinition | undefined {
  return BY_KEY.get(key);
}

export const IMPORT_ENTITY_KEYS: readonly string[] = IMPORT_ENTITIES.map((e) => e.key);

/**
 * The header row a template offers, in definition order.
 *
 * Required columns first is deliberate: a spreadsheet is read left to right,
 * and the columns somebody must fill in should be the ones they see first.
 */
export function templateHeaders(entity: ImportEntityDefinition): string[] {
  return [
    ...entity.columns.filter((c) => c.required).map((c) => c.name),
    ...entity.columns.filter((c) => !c.required).map((c) => c.name),
  ];
}

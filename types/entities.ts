// ============================================================================
// MODULE : Shared Types — Wire Entities
// PURPOSE: The shape each entity actually has *after* JSON serialization, as
//          returned by the routes under app/api. This is the frontend's view of
//          the backend contract and the single reference the service layer and
//          every page type against.
//
//          Three deliberate differences from prisma/schema.prisma, all forced by
//          JSON and none of them optional:
//            · DateTime  -> string  (ISO-8601; JSON has no date type)
//            · Decimal   -> string  (Prisma's Decimal has toJSON; kept as a
//                                    string so large money values stay exact)
//            · BigInt    -> string  (lib/utils/serialize.ts converts these —
//                                    JSON.stringify throws on BigInt outright)
//
//          Where a route declares an explicit `select`, this file mirrors that
//          select rather than the full model — the select *is* the contract, and
//          typing the extra columns would promise fields the API never sends.
// ============================================================================

import type {
  AssignmentStatus,
  AssignmentType,
  AttendanceStatus,
  BillingCycle,
  BloodGroup,
  CertificateType,
  CourseType,
  DayOfWeek,
  DocumentType,
  DurationUnit,
  EmployeeStatus,
  EmployeeType,
  ExamStatus,
  ExaminationType,
  FeeStatus,
  FeeType,
  Gender,
  InstitutionType,
  PaymentMethod,
  PaymentStatus,
  ProgrammeType,
  SessionType,
  StudentStatus,
  SubmissionStatus,
  SubscriptionPlan,
  SubscriptionStatus,
  TenantStatus,
} from "./enums";

/**
 * Postal address, stored in a `Json?` column so the backend applies no shape of
 * its own. Every field is optional because nothing is validated on write.
 */
export interface AddressJson {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** Free-form emergency contact held in `StudentPersonal.emergencyContact`. */
export interface EmergencyContactJson {
  name?: string;
  relation?: string;
  phone?: string;
  email?: string;
}

// --- Platform ---------------------------------------------------------------

/** GET /api/platform/tenants — the full model; the route applies no select. */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  type: InstitutionType;
  status: TenantStatus;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  timezone: string;
  locale: string;
  country: string;
  address: AddressJson | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  accreditationNo: string | null;
  establishedYear: number | null;
  settings: Record<string, unknown> | null;
  /** W1.5 · PRD §5.1 "Assign support manager" — a PlatformUser id, or null. */
  supportManagerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/platform/subscriptions.
 *
 * `maxStorage` is a string because the column is BigInt, and `pricePerMonth`
 * because it is Decimal(10,2) — parse with BigInt()/Number() at the point of
 * display, never store the parsed value back on the entity.
 */
export interface Subscription {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  startDate: string;
  endDate: string | null;
  trialEndsAt: string | null;
  maxStudents: number | null;
  maxFaculty: number | null;
  maxStorage: string | null;
  features: Record<string, unknown> | null;
  pricePerMonth: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/platform/tenants/[id]/stats — counts only; no revenue metric. */
export interface TenantStats {
  students: { total: number; active: number };
  faculty: { total: number; active: number };
}

/**
 * GET /api/platform/tenants/[id]/admins — a university's own administrator
 * (W1.4).
 *
 * An ordinary tenant `User`, not a new kind of account: it carries a tenantId,
 * signs in through the normal tenant login, and is bounded by requireTenant
 * like every other member of its university. It is typed separately from
 * `User` below only because the platform route returns a narrower projection.
 *
 * `passwordHash` is not on this type because the route never sends it: the
 * provisioning service selects an explicit column list that omits it.
 */
export interface TenantAdmin {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  /** True while the account holds the password the platform generated for it. */
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: string[];
}

/**
 * GET /api/platform/users — an EduOS platform operator (W1.3).
 *
 * Distinct from `User` below, which is a TENANT member and carries a tenantId.
 * A platform operator belongs to no institution; that missing column is the
 * whole security property of the model, so it is missing here too rather than
 * being present and set to null.
 *
 * `passwordHash` is not on this type because the route never sends it: the
 * service selects an explicit column list that omits it.
 *
 * `roles` holds granted PlatformRole names. It is an array because
 * PlatformUserRole is a join table, even though W1.3 grants exactly one role —
 * modelling it as a single string here would misreport an account that somehow
 * holds two, which is exactly when an operator needs to see the truth.
 */
export interface PlatformUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  /** True while the account holds a password another operator generated. */
  mustChangePassword: boolean;
  /** Console accent for THIS operator. null = the product default. */
  accentColor: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: string[];
}

// --- Identity & access ------------------------------------------------------

/** GET /api/users — mirrors USER_SELECT; `passwordHash` is never exposed. */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/users/[id] — the list select plus assigned roles. The collection
 * endpoint deliberately omits `roles`, so it is a separate type rather than an
 * optional field on User.
 */
export interface UserWithRoles extends User {
  roles: Pick<Role, "id" | "name">[];
}

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A permission, addressed as resource + action + scope.
 *
 * Not a flat code string: the model is @@unique([resource, action, scope]),
 * so "students" / "create" / "*" is the identity. `scope` defaults to "*"
 * meaning everywhere, and narrows to a campus or department id when a role is
 * bounded.
 *
 * Permission is global rather than tenant-scoped — it carries no tenantId. The
 * per-tenant part is which of them a Role is granted, through RolePermission.
 */
export interface Permission {
  id: string;
  resource: string;
  action: string;
  scope: string;
}

/**
 * A role's grant of one permission.
 *
 * Composite primary key @@id([roleId, permissionId]) — there is no id column,
 * so a row is addressed by the pair.
 */
export interface RolePermission {
  roleId: string;
  permissionId: string;
  grantedAt: string;
}

/**
 * A user's assignment of one role.
 *
 * Composite primary key @@id([userId, roleId]), so again no id of its own —
 * which is why unassigning is DELETE /api/users/[id]/roles/[roleId] rather
 * than a delete by row id.
 *
 * `scope` narrows the role to part of the institution (a campus, a department).
 * `grantedBy` is set by the route from the session, never from the client.
 */
export interface UserRole {
  userId: string;
  roleId: string;
  scope: Record<string, unknown> | null;
  grantedAt: string;
  grantedBy: string | null;
}

/** POST /api/users/[id]/roles — the join row with its role expanded. */
export interface UserRoleWithRole extends UserRole {
  role: Pick<Role, "id" | "name">;
}

/** A role with the count of permissions granted to it, for the roles list. */
export interface RoleWithCounts extends Role {
  permissionCount: number;
  userCount: number;
}

/** The decoded JWT the session cookie carries. Mirrors lib/auth/jwt.ts. */
export interface SessionUser {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
}

/** POST /api/auth/login — the `data.user` object on success. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  /**
   * W1.4 — true while the account holds a password somebody else generated.
   *
   * Optional because /api/auth/me does not report it; only the login response
   * does, which is where it is acted on. It is a routing hint, never a control:
   * requireAuth re-reads the column on every request.
   */
  mustChangePassword?: boolean;
}

// --- Organisation structure -------------------------------------------------

export interface Campus {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: AddressJson | null;
  phone: string | null;
  email: string | null;
  isMain: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface School {
  id: string;
  tenantId: string;
  campusId: string;
  name: string;
  code: string;
  deanName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  tenantId: string;
  campusId: string;
  schoolId: string | null;
  name: string;
  code: string;
  hodName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Programme {
  id: string;
  tenantId: string;
  departmentId: string;
  name: string;
  code: string;
  type: ProgrammeType;
  durationValue: number;
  durationUnit: DurationUnit;
  totalCredits: number | null;
  eligibility: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Specialisation {
  id: string;
  tenantId: string;
  programmeId: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

// --- Academic calendar ------------------------------------------------------

export interface AcademicYear {
  id: string;
  tenantId: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface Semester {
  id: string;
  tenantId: string;
  academicYearId: string;
  name: string;
  semesterNumber: number;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface Batch {
  id: string;
  tenantId: string;
  programmeId: string;
  academicYearId: string;
  name: string;
  code: string;
  maxStrength: number | null;
  createdAt: string;
}

export interface Section {
  id: string;
  tenantId: string;
  batchId: string;
  semesterId: string;
  name: string;
  maxStrength: number | null;
  createdAt: string;
}

// --- Students ---------------------------------------------------------------

/**
 * GET /api/students — mirrors STUDENT_SELECT.
 *
 * Note the absence of a name: Student carries none, and the route expands no
 * relation, so the student's name and email are reached through the linked
 * User. List screens that need a name must resolve it separately — see
 * StudentWithUser.
 */
export interface Student {
  id: string;
  tenantId: string;
  userId: string;
  enrollmentNo: string;
  programmeId: string | null;
  batchId: string | null;
  sectionId: string | null;
  specialisationId: string | null;
  currentSemester: number;
  status: StudentStatus;
  admissionDate: string;
  graduationDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A student joined to its User for display.
 *
 * The API does NOT return this shape — it is composed on the frontend from a
 * student page and a user lookup. Kept distinct from Student so no page can
 * assume the collection endpoint hands back a name it never sends.
 *
 * `fullName` is flattened alongside the nested user because searching and
 * sorting need a single string field. Reaching into `user.firstName` for each
 * would mean every list re-joining the name, and a substring search across two
 * separate fields never matches "Priya Sharma" typed in full.
 */
export interface StudentWithUser extends Student {
  user: Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">;
  fullName: string;
}

export interface StudentPersonal {
  id: string;
  studentId: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  bloodGroup: BloodGroup | null;
  nationality: string | null;
  religion: string | null;
  category: string | null;
  motherTongue: string | null;
  permanentAddr: AddressJson | null;
  localAddr: AddressJson | null;
  emergencyContact: EmergencyContactJson | null;
  disability: boolean;
  disabilityDesc: string | null;
  updatedAt: string;
}

export interface StudentDocument {
  id: string;
  studentId: string;
  type: DocumentType;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  isVerified: boolean;
  /** User id of whoever verified it. Null until someone has. */
  verifiedBy: string | null;
  verifiedAt: string | null;
  uploadedAt: string;
}

/**
 * A guardian.
 *
 * Note `relation` lives here, not on the join: the model puts it on Parent, so
 * one person is "Father" globally rather than per child. `phone` is required —
 * a guardian record with no way to reach them serves no purpose.
 *
 * `annualIncome` is a string because the column is Decimal(12,2); it feeds
 * means-tested scholarship checks, so it must stay exact.
 */
export interface Parent {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  occupation: string | null;
  annualIncome: string | null;
  relation: string;
  createdAt: string;
}

/**
 * The student-to-guardian link.
 *
 * Composite primary key @@id([studentId, parentId]) — no id column of its own.
 * `isPrimary` marks the first point of contact.
 */
export interface StudentParent {
  studentId: string;
  parentId: string;
  isPrimary: boolean;
}

/** POST /api/students/[id]/parents returns the link row with `parent` expanded. */
export interface StudentParentWithParent extends StudentParent {
  parent: Parent;
}

// --- Staff ------------------------------------------------------------------

export interface FacultyMember {
  id: string;
  tenantId: string;
  userId: string;
  employeeId: string;
  departmentId: string | null;
  designation: string | null;
  qualification: string | null;
  specialization: string | null;
  experience: number | null;
  status: EmployeeStatus;
  joinDate: string;
  createdAt: string;
  updatedAt: string;
}

/** Composed on the frontend, as with StudentWithUser — not an API shape. */
export interface FacultyWithUser extends FacultyMember {
  user: Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">;
  fullName: string;
}

export interface Employee {
  id: string;
  tenantId: string;
  userId: string;
  employeeId: string;
  departmentId: string | null;
  designation: string | null;
  type: EmployeeType;
  status: EmployeeStatus;
  joinDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeWithUser extends Employee {
  user: Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">;
  fullName: string;
}

/**
 * A teaching assignment: this lecturer, this course, this section, this term.
 *
 * @@unique([facultyId, courseId, sectionId, semesterId]) — the same lecturer
 * may teach one course to several sections, and the same section across
 * several terms, but not the identical combination twice.
 *
 * `isActive` retires an assignment without deleting it, so past workload stays
 * on record.
 */
export interface FacultyCourseAssignment {
  id: string;
  tenantId: string;
  facultyId: string;
  courseId: string;
  sectionId: string | null;
  semesterId: string | null;
  isActive: boolean;
  createdAt: string;
}

/** An assignment joined to the course, section and semester it names. */
export interface FacultyAssignmentRow extends FacultyCourseAssignment {
  courseCode: string;
  courseName: string;
  courseCredits: number;
  sectionName: string | null;
  semesterName: string | null;
}

// --- Curriculum & courses ---------------------------------------------------
// No backend route serves these yet (backend Phase 8). Typed here so the mock
// services and UI are already written against the intended contract.

/**
 * A course in the catalogue.
 *
 * Note there are no lecture/lab/tutorial hour columns — the model carries only
 * `credits`. Contact hours are a property of the timetable, not the catalogue.
 */
export interface Course {
  id: string;
  tenantId: string;
  departmentId: string | null;
  name: string;
  code: string;
  type: CourseType;
  credits: number;
  description: string | null;
  syllabus: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A versioned programme structure.
 *
 * @@unique([programmeId, version]) — a programme may have several curricula
 * over time ("2024", "2026 revised"), but each version once.
 */
export interface Curriculum {
  id: string;
  tenantId: string;
  programmeId: string;
  name: string;
  version: string;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One course placed in one semester of a curriculum.
 *
 * @@unique([curriculumId, courseId, semesterNumber]) — the same course may
 * legitimately appear in two semesters of the same curriculum, but not twice
 * in one.
 *
 * `credits` is duplicated from Course on purpose: a curriculum may weight a
 * course differently from its catalogue default, and the curriculum's value is
 * what the degree audit counts.
 */
export interface CurriculumSubject {
  id: string;
  curriculumId: string;
  courseId: string;
  semesterNumber: number;
  isCompulsory: boolean;
  credits: number;
  internalMarks: number | null;
  externalMarks: number | null;
  createdAt: string;
}

/** A curriculum subject joined to the course it names. */
export interface CurriculumSubjectRow extends CurriculumSubject {
  courseCode: string;
  courseName: string;
  courseType: CourseType;
}

// --- Timetable & attendance -------------------------------------------------

/**
 * One recurring slot on the weekly timetable.
 *
 * The column is `day`, not `dayOfWeek`. `facultyId` is required — a scheduled
 * class with nobody teaching it is not a class. Times are plain "HH:MM"
 * strings rather than timestamps, because a slot recurs weekly and has no date.
 */
export interface Timetable {
  id: string;
  tenantId: string;
  semesterId: string;
  sectionId: string;
  courseId: string;
  facultyId: string;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  roomNo: string | null;
  sessionType: SessionType;
  isActive: boolean;
  createdAt: string;
}

/** A timetable slot joined to the course and lecturer it names. */
export interface TimetableSlot extends Timetable {
  courseCode: string;
  courseName: string;
  facultyName: string;
}

/**
 * One student's attendance for one session.
 *
 * @@unique([studentId, courseId, date, sessionType]) — a student is marked once
 * per course per day per session type, so re-marking updates rather than
 * duplicates.
 *
 * `sectionId`, `courseId` and `facultyId` are all nullable: daily (non-course)
 * attendance is a real case the schema allows. `markedAt`/`markedBy` record who
 * took the register and when, which is what an attendance dispute is settled
 * from.
 */
export interface Attendance {
  id: string;
  tenantId: string;
  studentId: string;
  facultyId: string | null;
  sectionId: string | null;
  courseId: string | null;
  date: string;
  status: AttendanceStatus;
  sessionType: SessionType;
  remarks: string | null;
  markedAt: string;
  markedBy: string | null;
}

/** Per-course attendance rollup for one student. */
export interface AttendanceSummary {
  courseId: string;
  courseCode: string;
  courseName: string;
  totalClasses: number;
  present: number;
  absent: number;
  late: number;
  percentage: number;
}

// --- Assessment -------------------------------------------------------------

/**
 * A piece of set work.
 *
 * The author column is `createdBy` — a user id, not a facultyId. `dueDate` is
 * nullable because a DRAFT assignment need not have one yet, and `publishedAt`
 * null means students cannot see it at all.
 */
export interface Assignment {
  id: string;
  tenantId: string;
  courseId: string;
  sectionId: string | null;
  createdBy: string;
  title: string;
  description: string | null;
  type: AssignmentType;
  status: AssignmentStatus;
  maxMarks: number;
  dueDate: string | null;
  publishedAt: string | null;
  attachments: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One student's submission.
 *
 * @@unique([assignmentId, studentId]) — a student submits once per assignment;
 * a resubmission updates the row rather than adding one.
 *
 * The marks column is `marks`, and files live in `attachments` (Json) rather
 * than a single fileUrl.
 */
export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  submittedAt: string | null;
  attachments: Record<string, unknown> | null;
  marks: number | null;
  feedback: string | null;
  gradedAt: string | null;
  gradedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An assignment joined to its course, and to one student's submission of it. */
export interface AssignmentRow extends Assignment {
  courseCode: string;
  courseName: string;
  /** Null when the student has not submitted. */
  submission: AssignmentSubmission | null;
}

export interface Examination {
  id: string;
  tenantId: string;
  semesterId: string;
  courseId: string;
  title: string;
  type: ExaminationType;
  status: ExamStatus;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  maxMarks: number;
  passMark: number | null;
  /** Minutes. */
  duration: number | null;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One student's result for one examination.
 *
 * `marksObtained` and `gradePoint` are strings — both are Decimal columns, and
 * a GPA rounded through a float is how a transcript ends up off by 0.01.
 *
 * `isPassed` is nullable, distinct from false: null means not yet evaluated,
 * false means failed. `publishedAt` null means the result exists but has not
 * been released to the student.
 */
export interface ExamResult {
  id: string;
  examinationId: string;
  studentId: string;
  marksObtained: string | null;
  grade: string | null;
  gradePoint: string | null;
  isPassed: boolean | null;
  isAbsent: boolean;
  remarks: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One line of GET /api/students/[id]/transcript.
 *
 * The endpoint DOES expand the examination, its course and its semester — the
 * frontend once assumed otherwise and substituted placeholders for all three,
 * which is why the shape is written out here rather than reusing ExamResult.
 * `maxMarks` and `passMark` are lifted from the examination by the route, so
 * they sit at the top level rather than under it.
 */
export interface TranscriptResult {
  id: string;
  marksObtained: string | null;
  maxMarks: number;
  passMark: number;
  grade: string | null;
  gradePoint: string | null;
  isPassed: boolean | null;
  isAbsent: boolean;
  remarks: string | null;
  publishedAt: string | null;
  examination: { id: string; title: string; type: ExaminationType; date: string };
  course: { id: string; code: string; name: string; type: string; credits: string };
  semester: {
    id: string;
    name: string;
    semesterNumber: number;
    academicYearId: string;
  };
}

/** GET /api/students/[id]/transcript — `{ student, results }`. */
export interface Transcript {
  student: Student;
  results: TranscriptResult[];
}

/**
 * A transcript row flattened for the table that renders it.
 *
 * The joins come from the endpoint; this shape only lifts them out of their
 * nesting so a column can name one field.
 */
export interface TranscriptRow extends ExamResult {
  examinationTitle: string;
  examinationType: ExaminationType;
  maxMarks: number;
  courseCode: string;
  courseName: string;
  semesterId: string;
  semesterName: string;
}

// --- Finance ----------------------------------------------------------------

/**
 * A fee plan. Scoped to any of programme, batch or academic year — all three
 * are nullable, so a structure can be as broad or as narrow as needed.
 */
export interface FeeStructure {
  id: string;
  tenantId: string;
  programmeId: string | null;
  batchId: string | null;
  academicYearId: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One line item on a structure. `amount` is Decimal(10,2) — kept exact. */
export interface FeeComponent {
  id: string;
  feeStructureId: string;
  name: string;
  type: FeeType;
  amount: string;
  isOptional: boolean;
  isTaxable: boolean;
  /** Decimal(5,2). Only meaningful when isTaxable. */
  taxPercent: string | null;
  createdAt: string;
}

export interface FeeDemand {
  id: string;
  tenantId: string;
  studentId: string;
  semesterId: string | null;
  feeStructureId: string | null;
  totalAmount: string;
  paidAmount: string;
  waivedAmount: string;
  status: FeeStatus;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A payment against a demand.
 *
 * `receiptNo` is globally @unique, not per-tenant — a receipt number is a legal
 * document reference.
 *
 * `paidAt` is nullable: a payment row exists from the moment it is initiated,
 * and only carries a settlement time once the gateway confirms. A PENDING
 * payment with no paidAt is the normal in-flight state, not missing data.
 */
export interface Payment {
  id: string;
  tenantId: string;
  studentId: string;
  feeDemandId: string | null;
  receiptNo: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId: string | null;
  gatewayRef: string | null;
  gatewayMeta: Record<string, unknown> | null;
  paidAt: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A demand joined to the student it belongs to, for the fee ledger. */
export interface FeeDemandRow extends FeeDemand {
  studentName: string;
  enrollmentNo: string;
  programmeCode: string | null;
  /** totalAmount − paidAmount − waivedAmount, as a number for display. */
  outstanding: number;
}

// --- Certificates -----------------------------------------------------------

/**
 * A certificate design.
 *
 * `htmlTemplate` holds the markup with `{{placeholder}}` tokens; `cssStyles` is
 * kept separate so a template can be restyled without touching its structure.
 * `variables` documents which placeholders the template expects.
 */
export interface CertificateTemplate {
  id: string;
  tenantId: string;
  name: string;
  type: CertificateType;
  htmlTemplate: string;
  cssStyles: string | null;
  variables: Record<string, unknown> | null;
  isActive: boolean;
  /** Version within this template's lineage. */
  version: number;
  /** Lineage root; null on the first version. */
  parentTemplateId: string | null;
  /** When this version became issuable; null while a draft. */
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An issued certificate.
 *
 * `templateId` is required — a certificate is always an instance of a design.
 * `certificateNo` is globally @unique and is what the public verification page
 * looks up. `data` snapshots the values merged into the template at issue time,
 * so a later edit to the student record cannot silently rewrite history on an
 * already-issued document.
 */
export interface Certificate {
  id: string;
  tenantId: string;
  templateId: string;
  studentId: string;
  certificateNo: string;
  type: CertificateType;
  data: Record<string, unknown> | null;
  issuedAt: string;
  expiresAt: string | null;
  pdfUrl: string | null;
  qrCode: string | null;
  isRevoked: boolean;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

/** A certificate joined to its student and template, for the issued list. */
export interface CertificateRow extends Certificate {
  studentName: string;
  enrollmentNo: string;
  templateName: string;
}

/** GET /api/certificates/verify/[certNo] — the public, unauthenticated view. */
export interface CertificateVerification {
  isValid: boolean;
  certificateNo: string;
  type: CertificateType;
  studentName: string;
  maskedEnrollmentNo: string;
  tenantName: string;
  programmeName: string | null;
  issuedAt: string;
  isRevoked: boolean;
}

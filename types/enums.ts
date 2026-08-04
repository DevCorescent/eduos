// ============================================================================
// MODULE : Shared Types — Domain Enums
// PURPOSE: Mirrors every enum in prisma/schema.prisma as a string-literal union.
//
//          These are declared by hand rather than imported from
//          @/app/generated/prisma/client on purpose: that module pulls the
//          Prisma runtime with it, which must never reach a client bundle. A
//          union of string literals is structurally identical over the wire and
//          costs nothing at runtime, so "use client" components can import it
//          freely.
//
//          Each union is paired with a frozen `*_VALUES` tuple so the same list
//          can drive a <Select>'s options without being restated. The
//          satisfies clause makes the two fail to compile if they ever drift.
// ============================================================================

// --- Platform ---------------------------------------------------------------

export type InstitutionType = "UNIVERSITY" | "COLLEGE" | "INSTITUTE" | "SCHOOL";
export const INSTITUTION_TYPE_VALUES = [
  "UNIVERSITY",
  "COLLEGE",
  "INSTITUTE",
  "SCHOOL",
] as const satisfies readonly InstitutionType[];

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "TRIAL" | "CANCELLED";
export const TENANT_STATUS_VALUES = [
  "ACTIVE",
  "SUSPENDED",
  "TRIAL",
  "CANCELLED",
] as const satisfies readonly TenantStatus[];

export type DomainType = "PRIMARY" | "CUSTOM" | "SUBDOMAIN";
export const DOMAIN_TYPE_VALUES = [
  "PRIMARY",
  "CUSTOM",
  "SUBDOMAIN",
] as const satisfies readonly DomainType[];

export type SubscriptionPlan = "STARTER" | "GROWTH" | "ENTERPRISE" | "CUSTOM";
export const SUBSCRIPTION_PLAN_VALUES = [
  "STARTER",
  "GROWTH",
  "ENTERPRISE",
  "CUSTOM",
] as const satisfies readonly SubscriptionPlan[];

export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELLED" | "TRIAL";
export const SUBSCRIPTION_STATUS_VALUES = [
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
  "TRIAL",
] as const satisfies readonly SubscriptionStatus[];

export type BillingCycle = "MONTHLY" | "ANNUAL";
export const BILLING_CYCLE_VALUES = [
  "MONTHLY",
  "ANNUAL",
] as const satisfies readonly BillingCycle[];

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";
export const INVOICE_STATUS_VALUES = [
  "DRAFT",
  "SENT",
  "PAID",
  "OVERDUE",
  "VOID",
] as const satisfies readonly InvoiceStatus[];

// --- Academic structure -----------------------------------------------------

export type ProgrammeType =
  | "UNDERGRADUATE"
  | "POSTGRADUATE"
  | "DIPLOMA"
  | "CERTIFICATE"
  | "PHD"
  | "INTEGRATED";
export const PROGRAMME_TYPE_VALUES = [
  "UNDERGRADUATE",
  "POSTGRADUATE",
  "DIPLOMA",
  "CERTIFICATE",
  "PHD",
  "INTEGRATED",
] as const satisfies readonly ProgrammeType[];

export type DurationUnit = "YEARS" | "MONTHS" | "SEMESTERS";
export const DURATION_UNIT_VALUES = [
  "YEARS",
  "MONTHS",
  "SEMESTERS",
] as const satisfies readonly DurationUnit[];

export type CourseType =
  | "CORE"
  | "ELECTIVE"
  | "AUDIT"
  | "LAB"
  | "PROJECT"
  | "SEMINAR";
export const COURSE_TYPE_VALUES = [
  "CORE",
  "ELECTIVE",
  "AUDIT",
  "LAB",
  "PROJECT",
  "SEMINAR",
] as const satisfies readonly CourseType[];

// --- People -----------------------------------------------------------------

export type StudentStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "GRADUATED"
  | "WITHDRAWN"
  | "SUSPENDED"
  | "ON_LEAVE"
  | "TRANSFERRED";
export const STUDENT_STATUS_VALUES = [
  "ACTIVE",
  "INACTIVE",
  "GRADUATED",
  "WITHDRAWN",
  "SUSPENDED",
  "ON_LEAVE",
  "TRANSFERRED",
] as const satisfies readonly StudentStatus[];

export type EmployeeStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "ON_LEAVE"
  | "TERMINATED"
  | "RETIRED";
export const EMPLOYEE_STATUS_VALUES = [
  "ACTIVE",
  "INACTIVE",
  "ON_LEAVE",
  "TERMINATED",
  "RETIRED",
] as const satisfies readonly EmployeeStatus[];

export type EmployeeType =
  | "TEACHING"
  | "NON_TEACHING"
  | "VISITING"
  | "ADJUNCT"
  | "CONTRACT";
export const EMPLOYEE_TYPE_VALUES = [
  "TEACHING",
  "NON_TEACHING",
  "VISITING",
  "ADJUNCT",
  "CONTRACT",
] as const satisfies readonly EmployeeType[];

export type Gender = "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
export const GENDER_VALUES = [
  "MALE",
  "FEMALE",
  "OTHER",
  "PREFER_NOT_TO_SAY",
] as const satisfies readonly Gender[];

export type BloodGroup =
  | "A_POS"
  | "A_NEG"
  | "B_POS"
  | "B_NEG"
  | "AB_POS"
  | "AB_NEG"
  | "O_POS"
  | "O_NEG";
export const BLOOD_GROUP_VALUES = [
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "AB_POS",
  "AB_NEG",
  "O_POS",
  "O_NEG",
] as const satisfies readonly BloodGroup[];

export type DocumentType =
  | "PHOTO"
  | "AADHAAR"
  | "PAN"
  | "PASSPORT"
  | "BIRTH_CERTIFICATE"
  | "MARKSHEET"
  | "TRANSFER_CERTIFICATE"
  | "INCOME_CERTIFICATE"
  | "CATEGORY_CERTIFICATE"
  | "OTHER";
export const DOCUMENT_TYPE_VALUES = [
  "PHOTO",
  "AADHAAR",
  "PAN",
  "PASSPORT",
  "BIRTH_CERTIFICATE",
  "MARKSHEET",
  "TRANSFER_CERTIFICATE",
  "INCOME_CERTIFICATE",
  "CATEGORY_CERTIFICATE",
  "OTHER",
] as const satisfies readonly DocumentType[];

// --- Scheduling & attendance ------------------------------------------------

export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";
export const DAY_OF_WEEK_VALUES = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const satisfies readonly DayOfWeek[];

export type SessionType = "LECTURE" | "LAB" | "TUTORIAL" | "SEMINAR" | "EXAM";
export const SESSION_TYPE_VALUES = [
  "LECTURE",
  "LAB",
  "TUTORIAL",
  "SEMINAR",
  "EXAM",
] as const satisfies readonly SessionType[];

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export const ATTENDANCE_STATUS_VALUES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
] as const satisfies readonly AttendanceStatus[];

// --- Assessment -------------------------------------------------------------

export type AssignmentType =
  | "HOMEWORK"
  | "PROJECT"
  | "QUIZ"
  | "ESSAY"
  | "PRESENTATION"
  | "LAB_REPORT";
export const ASSIGNMENT_TYPE_VALUES = [
  "HOMEWORK",
  "PROJECT",
  "QUIZ",
  "ESSAY",
  "PRESENTATION",
  "LAB_REPORT",
] as const satisfies readonly AssignmentType[];

export type AssignmentStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "GRADED";
export const ASSIGNMENT_STATUS_VALUES = [
  "DRAFT",
  "PUBLISHED",
  "CLOSED",
  "GRADED",
] as const satisfies readonly AssignmentStatus[];

export type SubmissionStatus =
  | "PENDING"
  | "SUBMITTED"
  | "LATE"
  | "GRADED"
  | "RETURNED";
export const SUBMISSION_STATUS_VALUES = [
  "PENDING",
  "SUBMITTED",
  "LATE",
  "GRADED",
  "RETURNED",
] as const satisfies readonly SubmissionStatus[];

export type ExaminationType =
  | "INTERNAL"
  | "EXTERNAL"
  | "SUPPLEMENTARY"
  | "PRACTICAL"
  | "VIVA"
  | "MID_TERM"
  | "END_TERM";
export const EXAMINATION_TYPE_VALUES = [
  "INTERNAL",
  "EXTERNAL",
  "SUPPLEMENTARY",
  "PRACTICAL",
  "VIVA",
  "MID_TERM",
  "END_TERM",
] as const satisfies readonly ExaminationType[];

export type ExamStatus =
  | "SCHEDULED"
  | "ONGOING"
  | "COMPLETED"
  | "CANCELLED"
  | "POSTPONED";
export const EXAM_STATUS_VALUES = [
  "SCHEDULED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
  "POSTPONED",
] as const satisfies readonly ExamStatus[];

// --- Finance ----------------------------------------------------------------

export type FeeType =
  | "TUITION"
  | "HOSTEL"
  | "TRANSPORT"
  | "LIBRARY"
  | "LAB"
  | "EXAM"
  | "REGISTRATION"
  | "ACTIVITY"
  | "MISCELLANEOUS";
export const FEE_TYPE_VALUES = [
  "TUITION",
  "HOSTEL",
  "TRANSPORT",
  "LIBRARY",
  "LAB",
  "EXAM",
  "REGISTRATION",
  "ACTIVITY",
  "MISCELLANEOUS",
] as const satisfies readonly FeeType[];

export type FeeStatus = "PENDING" | "PARTIAL" | "PAID" | "OVERDUE" | "WAIVED";
export const FEE_STATUS_VALUES = [
  "PENDING",
  "PARTIAL",
  "PAID",
  "OVERDUE",
  "WAIVED",
] as const satisfies readonly FeeStatus[];

export type PaymentMethod =
  | "ONLINE"
  | "CASH"
  | "CHEQUE"
  | "DD"
  | "NEFT"
  | "UPI"
  | "CARD";
export const PAYMENT_METHOD_VALUES = [
  "ONLINE",
  "CASH",
  "CHEQUE",
  "DD",
  "NEFT",
  "UPI",
  "CARD",
] as const satisfies readonly PaymentMethod[];

export type PaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "REFUNDED"
  | "PARTIAL";
export const PAYMENT_STATUS_VALUES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
  "PARTIAL",
] as const satisfies readonly PaymentStatus[];

// --- Documents & messaging --------------------------------------------------

export type CertificateType =
  | "DEGREE"
  | "DIPLOMA"
  | "TRANSCRIPT"
  | "BONAFIDE"
  | "MIGRATION"
  | "CONDUCT"
  | "COMPLETION"
  | "PROVISIONAL"
  | "CUSTOM";
export const CERTIFICATE_TYPE_VALUES = [
  "DEGREE",
  "DIPLOMA",
  "TRANSCRIPT",
  "BONAFIDE",
  "MIGRATION",
  "CONDUCT",
  "COMPLETION",
  "PROVISIONAL",
  "CUSTOM",
] as const satisfies readonly CertificateType[];

export type NotificationType = "EMAIL" | "SMS" | "PUSH" | "IN_APP";
export const NOTIFICATION_TYPE_VALUES = [
  "EMAIL",
  "SMS",
  "PUSH",
  "IN_APP",
] as const satisfies readonly NotificationType[];

export type SequenceReset = "NEVER" | "YEARLY" | "MONTHLY" | "SEMESTERLY";
export const SEQUENCE_RESET_VALUES = [
  "NEVER",
  "YEARLY",
  "MONTHLY",
  "SEMESTERLY",
] as const satisfies readonly SequenceReset[];

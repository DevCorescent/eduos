// ============================================================================
// MODULE : Constants — Enum Presentation
// PURPOSE: Turns the SCREAMING_SNAKE enum values the API sends into the text a
//          user reads, and maps each status onto a Badge variant.
//
//          Declared once here rather than at each call site for two reasons.
//          A naive `value.replace(/_/g, " ").toLowerCase()` gets "phd", "ug",
//          "aadhaar" and "a_pos" wrong, and colour is a semantic decision —
//          SUSPENDED must read as danger on the tenant table and the student
//          table alike, and that only holds if one map decides it.
//
//          Every map is a total Record over its union, so adding an enum value
//          to types/enums.ts fails the build here until its label and colour
//          are supplied. That is deliberate: an unlabelled status would
//          otherwise reach a screen as raw ALL_CAPS.
// ============================================================================

import type { BadgeVariant } from "@/components/ui/Badge";
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
} from "@/types";

// --- Labels -----------------------------------------------------------------

export const INSTITUTION_TYPE_LABELS: Record<InstitutionType, string> = {
  UNIVERSITY: "University",
  COLLEGE: "College",
  INSTITUTE: "Institute",
  SCHOOL: "School",
};

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  TRIAL: "Trial",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const SUBSCRIPTION_PLAN_LABELS: Record<SubscriptionPlan, string> = {
  STARTER: "Starter",
  GROWTH: "Growth",
  ENTERPRISE: "Enterprise",
  CUSTOM: "Custom",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: "Active",
  PAST_DUE: "Past Due",
  CANCELLED: "Cancelled",
  TRIAL: "Trial",
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: "Monthly",
  ANNUAL: "Annual",
};

export const PROGRAMME_TYPE_LABELS: Record<ProgrammeType, string> = {
  UNDERGRADUATE: "Undergraduate",
  POSTGRADUATE: "Postgraduate",
  DIPLOMA: "Diploma",
  CERTIFICATE: "Certificate",
  PHD: "PhD",
  INTEGRATED: "Integrated",
};

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  YEARS: "Years",
  MONTHS: "Months",
  SEMESTERS: "Semesters",
};

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  CORE: "Core",
  ELECTIVE: "Elective",
  AUDIT: "Audit",
  LAB: "Lab",
  PROJECT: "Project",
  SEMINAR: "Seminar",
};

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  GRADUATED: "Graduated",
  WITHDRAWN: "Withdrawn",
  SUSPENDED: "Suspended",
  ON_LEAVE: "On Leave",
  TRANSFERRED: "Transferred",
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On Leave",
  TERMINATED: "Terminated",
  RETIRED: "Retired",
};

export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  VISITING: "Visiting",
  ADJUNCT: "Adjunct",
  CONTRACT: "Contract",
};

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
  PREFER_NOT_TO_SAY: "Prefer not to say",
};

/** The DB stores POS/NEG; clinicians and students both expect "A+" / "A−". */
export const BLOOD_GROUP_LABELS: Record<BloodGroup, string> = {
  A_POS: "A+",
  A_NEG: "A−",
  B_POS: "B+",
  B_NEG: "B−",
  AB_POS: "AB+",
  AB_NEG: "AB−",
  O_POS: "O+",
  O_NEG: "O−",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PHOTO: "Photograph",
  AADHAAR: "Aadhaar",
  PAN: "PAN Card",
  PASSPORT: "Passport",
  BIRTH_CERTIFICATE: "Birth Certificate",
  MARKSHEET: "Marksheet",
  TRANSFER_CERTIFICATE: "Transfer Certificate",
  INCOME_CERTIFICATE: "Income Certificate",
  CATEGORY_CERTIFICATE: "Category Certificate",
  OTHER: "Other",
};

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

/** Column headings on the timetable grid, where full names will not fit. */
export const DAY_OF_WEEK_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  LECTURE: "Lecture",
  LAB: "Lab",
  TUTORIAL: "Tutorial",
  SEMINAR: "Seminar",
  EXAM: "Exam",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
};

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  HOMEWORK: "Homework",
  PROJECT: "Project",
  QUIZ: "Quiz",
  ESSAY: "Essay",
  PRESENTATION: "Presentation",
  LAB_REPORT: "Lab Report",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  CLOSED: "Closed",
  GRADED: "Graded",
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  LATE: "Late",
  GRADED: "Graded",
  RETURNED: "Returned",
};

export const EXAMINATION_TYPE_LABELS: Record<ExaminationType, string> = {
  INTERNAL: "Internal",
  EXTERNAL: "External",
  SUPPLEMENTARY: "Supplementary",
  PRACTICAL: "Practical",
  VIVA: "Viva",
  MID_TERM: "Mid-Term",
  END_TERM: "End-Term",
};

export const EXAM_STATUS_LABELS: Record<ExamStatus, string> = {
  SCHEDULED: "Scheduled",
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  POSTPONED: "Postponed",
};

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  TUITION: "Tuition",
  HOSTEL: "Hostel",
  TRANSPORT: "Transport",
  LIBRARY: "Library",
  LAB: "Laboratory",
  EXAM: "Examination",
  REGISTRATION: "Registration",
  ACTIVITY: "Activity",
  MISCELLANEOUS: "Miscellaneous",
};

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  PENDING: "Pending",
  PARTIAL: "Partially Paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  WAIVED: "Waived",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ONLINE: "Online",
  CASH: "Cash",
  CHEQUE: "Cheque",
  DD: "Demand Draft",
  NEFT: "NEFT",
  UPI: "UPI",
  CARD: "Card",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  SUCCESS: "Successful",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIAL: "Partial",
};

export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  DEGREE: "Degree",
  DIPLOMA: "Diploma",
  TRANSCRIPT: "Transcript",
  BONAFIDE: "Bonafide",
  MIGRATION: "Migration",
  CONDUCT: "Conduct",
  COMPLETION: "Completion",
  PROVISIONAL: "Provisional",
  CUSTOM: "Custom",
};

// --- Badge variants ---------------------------------------------------------
// Colour carries meaning, so the assignment is consistent across every map:
//   success — the healthy steady state (Active, Paid, Present, Completed)
//   warning — needs attention but not yet failed (Trial, Pending, Late)
//   danger  — failed, blocked or revoked (Suspended, Overdue, Absent)
//   info    — a neutral terminal state that is not a failure (Graduated, Waived)
//   default — inert or not-yet-started (Inactive, Draft, Cancelled)

export const TENANT_STATUS_VARIANTS: Record<TenantStatus, BadgeVariant> = {
  ACTIVE: "success",
  TRIAL: "warning",
  SUSPENDED: "danger",
  CANCELLED: "neutral",
  ARCHIVED: "neutral",
};

export const SUBSCRIPTION_STATUS_VARIANTS: Record<SubscriptionStatus, BadgeVariant> = {
  ACTIVE: "success",
  TRIAL: "warning",
  PAST_DUE: "danger",
  CANCELLED: "neutral",
};

export const STUDENT_STATUS_VARIANTS: Record<StudentStatus, BadgeVariant> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  GRADUATED: "info",
  WITHDRAWN: "neutral",
  SUSPENDED: "danger",
  ON_LEAVE: "warning",
  TRANSFERRED: "info",
};

export const EMPLOYEE_STATUS_VARIANTS: Record<EmployeeStatus, BadgeVariant> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  ON_LEAVE: "warning",
  TERMINATED: "danger",
  RETIRED: "info",
};

export const ATTENDANCE_STATUS_VARIANTS: Record<AttendanceStatus, BadgeVariant> = {
  PRESENT: "success",
  ABSENT: "danger",
  LATE: "warning",
  EXCUSED: "info",
};

export const ASSIGNMENT_STATUS_VARIANTS: Record<AssignmentStatus, BadgeVariant> = {
  DRAFT: "neutral",
  PUBLISHED: "info",
  CLOSED: "warning",
  GRADED: "success",
};

export const SUBMISSION_STATUS_VARIANTS: Record<SubmissionStatus, BadgeVariant> = {
  PENDING: "warning",
  SUBMITTED: "info",
  LATE: "danger",
  GRADED: "success",
  RETURNED: "neutral",
};

export const EXAM_STATUS_VARIANTS: Record<ExamStatus, BadgeVariant> = {
  SCHEDULED: "info",
  ONGOING: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  POSTPONED: "warning",
};

export const FEE_STATUS_VARIANTS: Record<FeeStatus, BadgeVariant> = {
  PENDING: "warning",
  PARTIAL: "warning",
  PAID: "success",
  OVERDUE: "danger",
  WAIVED: "info",
};

export const PAYMENT_STATUS_VARIANTS: Record<PaymentStatus, BadgeVariant> = {
  PENDING: "warning",
  SUCCESS: "success",
  FAILED: "danger",
  REFUNDED: "info",
  PARTIAL: "warning",
};

export const SUBSCRIPTION_PLAN_VARIANTS: Record<SubscriptionPlan, BadgeVariant> = {
  STARTER: "neutral",
  GROWTH: "info",
  ENTERPRISE: "success",
  CUSTOM: "warning",
};

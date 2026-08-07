// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : DTO
// PURPOSE: The shapes the three profile endpoints return, and the boundary
//          conversions that produce them.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every mapper returns a plain object. A Prisma row carries `Date` objects
//   and `Decimal` instances, neither of which serialises honestly: a Decimal
//   prints its internal representation and a Date becomes an ISO string only by
//   accident of JSON.stringify. Both are converted here, explicitly, once.
//
// THE JSON COLUMNS ARE PARSED DEFENSIVELY, NOT TRUSTED
//   StudentPersonal.permanentAddr, .localAddr and .emergencyContact are
//   untyped `Json`. Nothing in the database constrains their shape, and nothing
//   in the application has ever validated what was written into them. Casting
//   them to an interface would be a claim this codebase cannot support, so each
//   is read key by key and every field that is missing or of the wrong type
//   becomes null. A profile with a half-populated address renders; it does not
//   throw.
//
// NULL MEANS UNAVAILABLE AND IS NEVER FABRICATED
//   Per the Phase 18 decision, a figure the system cannot produce comes back as
//   null and a collection comes back empty. A dashboard showing 0.00 CGPA for a
//   student whose results are not yet computed would be a statement nobody made.
// ============================================================================

import type {
  AchievementCategory,
  BloodGroup,
  CertificateType,
  DocumentType,
  Gender,
  NotificationType,
  StudentStatus,
} from "@/app/generated/prisma/enums";

/** Anything Prisma hands back as a Decimal. */
type DecimalLike = { toFixed(places: number): string } | null;

/** The scale money columns in this module are stored at. */
const MONEY_SCALE = 2;

/** Render a nullable Decimal as a lossless string, preserving the null. */
export function optionalMoney(value: DecimalLike): string | null {
  return value === null || value === undefined ? null : value.toFixed(MONEY_SCALE);
}

/** Render a Date as ISO-8601, preserving the null. */
export function isoDate(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

/**
 * Read a string off an untyped JSON value.
 *
 * Returns null for a missing key, a non-object container, a non-string value
 * and an empty string alike. An empty string is treated as absent because a
 * blank field in a JSON blob means "not supplied", and rendering it as an empty
 * line on a profile is worse than omitting it.
 */
function jsonString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

// --- Shapes -----------------------------------------------------------------

/** A postal address, parsed from an untyped JSON column. */
export interface AddressDto {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
}

/**
 * The person to contact in an emergency.
 *
 * Read from `StudentPersonal.emergencyContact`, which is untyped JSON — so
 * every field is nullable and none is guaranteed. `hasContact` says whether
 * anything usable was found, so a portal need not test five fields to decide
 * whether to render the card.
 */
export interface EmergencyContactDto {
  name: string | null;
  relation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** True when at least a name or a phone number is present. */
  hasContact: boolean;
}

/** The student's professional photograph, and where it came from. */
export interface ProfilePhotoDto {
  url: string | null;
  /**
   * AVATAR when taken from User.avatarUrl, DOCUMENT when from an uploaded
   * StudentDocument of type PHOTO, NONE when neither exists. Stated rather than
   * inferred so a client knows whether it is showing a verified upload or a
   * self-set avatar.
   */
  source: "AVATAR" | "DOCUMENT" | "NONE";
}

/** Who the student is. */
export interface StudentIdentityDto {
  studentId: string;
  enrollmentNo: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string;
  phone: string | null;
  photo: ProfilePhotoDto;
  status: StudentStatus;
}

/** Personal details, every one of them optional in the schema. */
export interface StudentPersonalDto {
  dateOfBirth: string | null;
  gender: Gender | null;
  bloodGroup: BloodGroup | null;
  nationality: string | null;
  religion: string | null;
  category: string | null;
  motherTongue: string | null;
  permanentAddress: AddressDto | null;
  localAddress: AddressDto | null;
  emergencyContact: EmergencyContactDto | null;
  disability: boolean;
  disabilityDesc: string | null;
}

/** Where the student sits academically. */
export interface StudentAcademicDto {
  programmeId: string | null;
  batchId: string | null;
  batchName: string | null;
  sectionId: string | null;
  sectionName: string | null;
  specialisationId: string | null;
  specialisationName: string | null;
  currentSemester: number;
  admissionDate: string;
  graduationDate: string | null;
}

/** A parent or guardian. */
export interface ParentDto {
  id: string;
  firstName: string;
  lastName: string;
  relation: string;
  email: string | null;
  phone: string;
  occupation: string | null;
  /** Decimal(12,2) as a lossless string, null when not recorded. */
  annualIncome: string | null;
  /** True for the nominated primary contact. A property of the RELATIONSHIP. */
  isPrimary: boolean;
}

/** One uploaded document. */
export interface StudentDocumentDto {
  id: string;
  type: DocumentType;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  uploadedAt: string;
}

/** One institution-issued certificate. */
export interface CertificateDto {
  id: string;
  certificateNo: string;
  type: CertificateType;
  issuedAt: string;
  expiresAt: string | null;
  pdfUrl: string | null;
  qrCode: string | null;
  /** Revoked certificates ARE returned — a student must know one no longer stands. */
  isRevoked: boolean;
  revokedAt: string | null;
  /** Derived: not revoked and not past its expiry. */
  isActive: boolean;
}

/** One student-claimed achievement. */
export interface AchievementDto {
  id: string;
  title: string;
  category: AchievementCategory;
  description: string;
  issuer: string;
  /** When it was achieved, not when it was entered. */
  achievedOn: string;
  certificateUrl: string | null;
  evidenceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/student/profile */
export interface StudentProfileDto {
  identity: StudentIdentityDto;
  personal: StudentPersonalDto | null;
  academic: StudentAcademicDto;
  parents: ParentDto[];
  documents: StudentDocumentDto[];
  certificates: CertificateDto[];
  achievements: AchievementDto[];
}

/** One notification on a dashboard panel. */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  subject: string | null;
  body: string;
  sentAt: string | null;
  isRead: boolean;
}

/**
 * GET /api/student/dashboard
 *
 * Every figure is nullable and every collection may be empty. A student whose
 * results have not been computed gets `sgpa: null`, not `sgpa: "0.00"` — the
 * difference between "we do not know" and "you scored nothing" is the whole
 * point of the Phase 18 decision to never fabricate.
 */
export interface StudentDashboardDto {
  academic: {
    programmeId: string | null;
    currentSemester: number;
    sectionId: string | null;
    sectionName: string | null;
    /** GPA_SCALE decimal string, null until results exist. */
    sgpa: string | null;
    cgpa: string | null;
    earnedCredits: string | null;
    backlogCount: number | null;
  };
  attendance: {
    /** Percentage as a decimal string, null when no attendance is recorded. */
    overallPercent: string | null;
    /** True only when a percentage EXISTS and falls below the threshold. */
    hasWarning: boolean;
  };
  finance: {
    pendingFeeCount: number | null;
    outstandingAmount: string | null;
  };
  profile: {
    /** 0–100 integer. Always computable, so never null. */
    completionPercent: number;
    /** Which fields were still missing, so a portal can prompt for them. */
    missingFields: string[];
  };
  summary: {
    pendingDocuments: number;
    activeCertificates: number;
    achievementCount: number;
  };
  /** Empty when the student has none, or when notifications are unavailable. */
  notifications: NotificationDto[];
}

// --- Mappers ----------------------------------------------------------------

/** Parse an untyped address JSON column. Returns null when nothing is usable. */
export function toAddressDto(source: unknown): AddressDto | null {
  const address: AddressDto = {
    line1: jsonString(source, "line1"),
    line2: jsonString(source, "line2"),
    city: jsonString(source, "city"),
    state: jsonString(source, "state"),
    country: jsonString(source, "country"),
    postalCode: jsonString(source, "postalCode"),
  };

  // An address whose every field is absent is not an address.
  return Object.values(address).some((value) => value !== null) ? address : null;
}

/** Parse an untyped emergency-contact JSON column. */
export function toEmergencyContactDto(source: unknown): EmergencyContactDto | null {
  const name = jsonString(source, "name");
  const phone = jsonString(source, "phone");

  const contact: EmergencyContactDto = {
    name,
    relation: jsonString(source, "relation"),
    phone,
    email: jsonString(source, "email"),
    address: jsonString(source, "address"),
    // A contact you cannot name or call is not a contact you can use.
    hasContact: name !== null || phone !== null,
  };

  return Object.values(contact).some((value) => typeof value === "string") ? contact : null;
}

/**
 * Decide which photograph to show.
 *
 * `User.avatarUrl` is the primary source per the Phase 18 decision; an uploaded
 * StudentDocument of type PHOTO is the fallback. The chosen source is reported
 * rather than left implicit, because the two differ in trust: an avatar is
 * self-set, a document may have been verified by the institution.
 */
export function toProfilePhotoDto(
  avatarUrl: string | null,
  photoDocumentUrl: string | null
): ProfilePhotoDto {
  if (avatarUrl !== null && avatarUrl.trim().length > 0) {
    return { url: avatarUrl, source: "AVATAR" };
  }

  if (photoDocumentUrl !== null && photoDocumentUrl.trim().length > 0) {
    return { url: photoDocumentUrl, source: "DOCUMENT" };
  }

  return { url: null, source: "NONE" };
}

type ParentRow = {
  isPrimary: boolean;
  parent: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string;
    occupation: string | null;
    annualIncome: DecimalLike;
    relation: string;
  };
};

export function toParentDto(row: ParentRow): ParentDto {
  return {
    id: row.parent.id,
    firstName: row.parent.firstName,
    lastName: row.parent.lastName,
    relation: row.parent.relation,
    email: row.parent.email,
    phone: row.parent.phone,
    occupation: row.parent.occupation,
    annualIncome: optionalMoney(row.parent.annualIncome),
    isPrimary: row.isPrimary,
  };
}

type DocumentRow = {
  id: string;
  type: DocumentType;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  isVerified: boolean;
  verifiedAt: Date | null;
  uploadedAt: Date;
};

export function toStudentDocumentDto(row: DocumentRow): StudentDocumentDto {
  return {
    id: row.id,
    type: row.type,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    isVerified: row.isVerified,
    verifiedAt: isoDate(row.verifiedAt),
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

type CertificateRow = {
  id: string;
  certificateNo: string;
  type: CertificateType;
  issuedAt: Date;
  expiresAt: Date | null;
  pdfUrl: string | null;
  qrCode: string | null;
  isRevoked: boolean;
  revokedAt: Date | null;
};

/**
 * Map a certificate, deriving `isActive`.
 *
 * `now` is a parameter rather than a call to `new Date()` inside the mapper, so
 * a whole profile is evaluated against ONE instant. Reading the clock per row
 * would let two certificates expiring in the same millisecond disagree, and
 * would make the function untestable without freezing time globally.
 */
export function toCertificateDto(row: CertificateRow, now: Date): CertificateDto {
  const isExpired = row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();

  return {
    id: row.id,
    certificateNo: row.certificateNo,
    type: row.type,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: isoDate(row.expiresAt),
    pdfUrl: row.pdfUrl,
    qrCode: row.qrCode,
    isRevoked: row.isRevoked,
    revokedAt: isoDate(row.revokedAt),
    isActive: !row.isRevoked && !isExpired,
  };
}

type AchievementRow = {
  id: string;
  title: string;
  category: AchievementCategory;
  description: string;
  issuer: string;
  achievedOn: Date;
  certificateUrl: string | null;
  evidenceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toAchievementDto(row: AchievementRow): AchievementDto {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    issuer: row.issuer,
    achievedOn: row.achievedOn.toISOString(),
    certificateUrl: row.certificateUrl,
    evidenceUrl: row.evidenceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type PersonalRow = {
  dateOfBirth: Date | null;
  gender: Gender | null;
  bloodGroup: BloodGroup | null;
  nationality: string | null;
  religion: string | null;
  category: string | null;
  motherTongue: string | null;
  permanentAddr: unknown;
  localAddr: unknown;
  emergencyContact: unknown;
  disability: boolean;
  disabilityDesc: string | null;
};

export function toStudentPersonalDto(row: PersonalRow): StudentPersonalDto {
  return {
    dateOfBirth: isoDate(row.dateOfBirth),
    gender: row.gender,
    bloodGroup: row.bloodGroup,
    nationality: row.nationality,
    religion: row.religion,
    category: row.category,
    motherTongue: row.motherTongue,
    permanentAddress: toAddressDto(row.permanentAddr),
    localAddress: toAddressDto(row.localAddr),
    emergencyContact: toEmergencyContactDto(row.emergencyContact),
    disability: row.disability,
    disabilityDesc: row.disabilityDesc,
  };
}

type NotificationRow = {
  id: string;
  type: NotificationType;
  subject: string | null;
  body: string;
  sentAt: Date | null;
  readAt: Date | null;
};

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    sentAt: isoDate(row.sentAt),
    isRead: row.readAt !== null,
  };
}

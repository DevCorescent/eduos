// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : DTO
// PURPOSE: The shapes the five open-elective endpoints return, and the boundary
//          conversions that produce them.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every mapper returns a plain object. A Prisma row carries `Date` objects,
//   which survive JSON only by accident of JSON.stringify. They are converted
//   here, explicitly, once.
//
// SEATS ARE PRESENTED, NOT DECIDED
//   `seatsRemaining` appears on the DTO because a catalogue is useless without
//   it — but the SUBTRACTION happens in the service and is passed in. A mapper
//   that computed it would put the same arithmetic in two layers, and the day
//   one changed the catalogue and the allocator would disagree about whether a
//   seat existed.
//
//   `isFull` is likewise derived by the service and carried here, so a client
//   need not restate the rule "remaining <= 0" and cannot get it wrong.
//
// ELIGIBILITY IS REPORTED AS RULES, NOT AS A VERDICT
//   The offering DTO carries the rules that apply to it. Whether a PARTICULAR
//   student satisfies them is a per-caller decision the service makes, and it
//   travels separately as `isEligible` on the student-facing shape — because
//   the same offering is eligible for one student and not another, and baking
//   a verdict into the shared shape would make it uncacheable and wrong.
// ============================================================================

import type {
  CourseType,
  ElectiveAllocationOutcome,
  ElectiveAllocationStrategy,
  OpenElectiveStatus,
} from "@/app/generated/prisma/enums";
import type {
  AllocationRow,
  EligibilityRow,
  OfferingRow,
  PreferenceRow,
} from "@/lib/repositories/openElective.repository";

/** Render a Date as ISO-8601, preserving the null. */
export function isoDate(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

// --- Shapes -----------------------------------------------------------------

/** One eligibility rule. Every null means "any". */
export interface EligibilityRuleDto {
  id: string;
  /** Null means any programme. */
  programmeId: string | null;
  programmeName: string | null;
  /** Null means any branch. "Branch" is Specialisation. */
  specialisationId: string | null;
  specialisationName: string | null;
  /** Null means any semester. Compared against Student.currentSemester. */
  semesterNumber: number | null;
}

/** The course an offering is for. */
export interface OfferingCourseDto {
  id: string;
  code: string;
  name: string;
  credits: number;
  type: CourseType;
}

/**
 * One open-elective offering.
 *
 * `seatsRemaining` and `isFull` are computed by the SERVICE and passed in — see
 * the file header. They are present because a catalogue without them is
 * unusable, not because this layer decided them.
 */
export interface OpenElectiveOfferingDto {
  id: string;
  course: OfferingCourseDto;
  semesterId: string;
  semesterName: string;
  offeringDepartmentId: string;
  offeringDepartmentName: string;

  /** The regulation that will grade it — the offering department's. */
  evaluationSchemeId: string;
  evaluationSchemeCode: string;
  evaluationSchemeVersion: number;

  totalSeats: number;
  /** totalSeats minus allocated. Derived by the service, never stored. */
  seatsRemaining: number;
  /** True when no seat is left. Derived, so a client need not restate the rule. */
  isFull: boolean;

  status: OpenElectiveStatus;
  allocationStrategy: ElectiveAllocationStrategy;
  /** True only while the offering is OPEN. */
  acceptsPreferences: boolean;

  /** Empty means UNRESTRICTED — absence of rules is not absence of access. */
  eligibility: EligibilityRuleDto[];

  statusChangedAt: string;
  createdAt: string;
}

/**
 * An offering as one particular student sees it.
 *
 * Extends the shared shape with the two facts that differ per caller: whether
 * this student is permitted to take it, and what they have already chosen.
 */
export interface StudentOfferingDto extends OpenElectiveOfferingDto {
  /** Whether THIS student satisfies the rules. Decided by the service. */
  isEligible: boolean;
  /** Why not, when they do not. Empty when eligible. */
  ineligibilityReasons: string[];
  /** The rank this student gave it, or null if they have not chosen it. */
  preferenceRank: number | null;
}

/** One of a student's ranked choices. */
export interface PreferenceDto {
  id: string;
  offeringId: string;
  semesterId: string;
  /** 1 is most preferred. */
  preferenceRank: number;
  submittedAt: string;
}

/** What an allocation run concluded for one student. */
export interface AllocationDto {
  id: string;
  offeringId: string;
  studentId: string;
  /** The rank this verdict answers — recorded for refusals too. */
  preferenceRank: number;
  outcome: ElectiveAllocationOutcome;
  /** Null exactly when the outcome is NOT_ALLOCATED. */
  courseRegistrationId: string | null;
  allocatedAt: string;
}

/** GET /api/open-electives/status — one student's position. */
export interface ElectiveStatusDto {
  studentId: string;
  semesterId: string;
  /** The student's ranked choices, most preferred first. */
  preferences: PreferenceDto[];
  /** Verdicts, once a run has happened. Empty before then. */
  allocations: AllocationDto[];
  /** True when every offering the student chose has been allocated. */
  isAllocated: boolean;
  /** True while any chosen offering is still OPEN, so choices may be edited. */
  isEditable: boolean;
}

/** POST /api/open-electives/select — what was recorded. */
export interface PreferenceSubmissionDto {
  studentId: string;
  semesterId: string;
  /** How many choices were stored. Replaces the previous set wholesale. */
  recorded: number;
  preferences: PreferenceDto[];
}

/** The allocation report for one offering. */
export interface AllocationReportDto {
  offeringId: string;
  totalSeats: number;
  allocated: number;
  notAllocated: number;
  seatsRemaining: number;
  /** Every verdict — refusals included, because a report without them explains nothing. */
  allocations: AllocationDto[];
}

// --- Mappers ----------------------------------------------------------------

export function toEligibilityRuleDto(row: EligibilityRow): EligibilityRuleDto {
  return {
    id: row.id,
    programmeId: row.programmeId,
    programmeName: row.programme?.name ?? null,
    specialisationId: row.specialisationId,
    specialisationName: row.specialisation?.name ?? null,
    semesterNumber: row.semesterNumber,
  };
}

/**
 * Map an offering.
 *
 * `allocatedCount` is supplied by the caller rather than read here, because
 * this layer issues no queries — and the subtraction that turns it into
 * `seatsRemaining` is the service's arithmetic, performed once and passed
 * through so the catalogue and the allocator cannot diverge.
 *
 * `seatsRemaining` is floored at zero. A negative remainder would mean the
 * offering was oversubscribed, which is a fault to be reported rather than a
 * number to be displayed — and showing "-3 seats left" helps nobody.
 */
export function toOfferingDto(
  row: OfferingRow,
  allocatedCount: number,
  eligibility: readonly EligibilityRow[]
): OpenElectiveOfferingDto {
  const remaining = row.totalSeats - allocatedCount;

  return {
    id: row.id,
    course: {
      id: row.course.id,
      code: row.course.code,
      name: row.course.name,
      credits: row.course.credits,
      type: row.course.type,
    },
    semesterId: row.semesterId,
    semesterName: row.semester.name,
    offeringDepartmentId: row.offeringDepartmentId,
    offeringDepartmentName: row.department.name,
    evaluationSchemeId: row.evaluationSchemeId,
    evaluationSchemeCode: row.evaluationScheme.code,
    evaluationSchemeVersion: row.evaluationScheme.version,
    totalSeats: row.totalSeats,
    seatsRemaining: remaining > 0 ? remaining : 0,
    isFull: remaining <= 0,
    status: row.status,
    allocationStrategy: row.allocationStrategy,
    // The single predicate that decides whether a client renders an editable
    // preference form. True only while OPEN, matching the lifecycle exactly.
    acceptsPreferences: row.status === "OPEN",
    eligibility: eligibility.map(toEligibilityRuleDto),
    statusChangedAt: row.statusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Map an offering as one student sees it. */
export function toStudentOfferingDto(
  base: OpenElectiveOfferingDto,
  isEligible: boolean,
  ineligibilityReasons: readonly string[],
  preferenceRank: number | null
): StudentOfferingDto {
  return {
    ...base,
    isEligible,
    ineligibilityReasons: [...ineligibilityReasons],
    preferenceRank,
  };
}

export function toPreferenceDto(row: PreferenceRow): PreferenceDto {
  return {
    id: row.id,
    offeringId: row.offeringId,
    semesterId: row.semesterId,
    preferenceRank: row.preferenceRank,
    submittedAt: row.submittedAt.toISOString(),
  };
}

export function toAllocationDto(row: AllocationRow): AllocationDto {
  return {
    id: row.id,
    offeringId: row.offeringId,
    studentId: row.studentId,
    preferenceRank: row.preferenceRank,
    outcome: row.outcome,
    courseRegistrationId: row.courseRegistrationId,
    allocatedAt: row.allocatedAt.toISOString(),
  };
}

/**
 * Build an allocation report.
 *
 * The two counts are derived from the verdicts themselves rather than taken
 * from a separate query, so the report cannot state a total that disagrees with
 * the rows printed beneath it.
 */
export function toAllocationReportDto(
  offeringId: string,
  totalSeats: number,
  rows: readonly AllocationRow[]
): AllocationReportDto {
  let allocated = 0;

  for (const row of rows) {
    if (row.outcome === "ALLOCATED") {
      allocated += 1;
    }
  }

  const remaining = totalSeats - allocated;

  return {
    offeringId,
    totalSeats,
    allocated,
    notAllocated: rows.length - allocated,
    seatsRemaining: remaining > 0 ? remaining : 0,
    allocations: rows.map(toAllocationDto),
  };
}

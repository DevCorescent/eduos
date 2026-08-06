// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : DTO
// PURPOSE: The exact shapes the four result endpoints return.
//
// EVERY NUMBER IS A STRING, AND THAT IS NOT PEDANTRY
//   The engine computes in exact scaled integers precisely so a grade never
//   depends on binary representation error. Emitting those as JSON numbers
//   would hand the client back the float problem the whole engine exists to
//   avoid — a percentage of 33.33 arriving as 33.329999999999998 and a
//   classification boundary decided on it. Every decimal below is a lossless
//   decimal string, exactly as every other Phase 16 DTO reports one.
//
// NULL MEANS SOMETHING EVERYWHERE
//   A null SGPA is a student with nothing credit-bearing, not a student who
//   scored zero. A null grade is a result not yet resolvable, not a fail. The
//   nulls are load-bearing and a client must render them as absence.
// ============================================================================

import type { CourseOutcome } from "@/lib/constants/resultEngine";

/** One component's contribution to one course. */
export interface ComponentResultDTO {
  code: string;
  isLeaf: boolean;
  /** After session aggregation, before component-level rules. */
  raw: string;
  /** After component-level rules. */
  awarded: string;
  maxMarks: string;
  /** Percentage points contributed to whatever contains it. */
  contribution: string;
  sessionCount: number;
}

/** A criterion the student did not meet. */
export interface CriterionFailureDTO {
  code: string;
  metric: string;
  threshold: string;
  actual: string;
  outcome: string;
}

/** One course, computed. */
export interface CourseResultDTO {
  courseRegistrationId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  attemptNumber: number;
  registrationType: string;

  credits: string;
  creditsEarned: string;

  /** Course total as a percentage. */
  percentage: string;
  /** Null while the result is not resolvable — withheld, unfinished, deferred. */
  grade: string | null;
  /** The band's classification text, verbatim from configuration. */
  classification: string | null;
  gradePoint: string | null;
  /** True when a criterion or mandatory failure overrode the band's verdict. */
  isOverridden: boolean;

  outcome: CourseOutcome;
  isPass: boolean;

  components: ComponentResultDTO[];
  failedCriteria: CriterionFailureDTO[];
  /** Cohort rules a second pass must apply before this result is final. */
  pendingOperations: string[];
}

/** A credit-weighted average and what went into it. */
export interface GpaDTO {
  /** Null when nothing carried credit — NOT zero. */
  value: string | null;
  creditsAttempted: string;
  creditsEarned: string;
  coursesCounted: number;
}

/** A student's credits, split by what happened to them. */
export interface CreditPositionDTO {
  registered: string;
  earned: string;
  /** Registered but not concluded. Distinct from failed, deliberately. */
  pending: string;
  failed: string;
}

/** One semester of one student. */
export interface SemesterResultDTO {
  semesterId: string;
  semesterName: string;
  courses: CourseResultDTO[];
  sgpa: GpaDTO;
  credits: CreditPositionDTO;
  backlogCount: number;
  isPromoted: boolean;
  /** True while any cohort operation is outstanding — do not treat as final. */
  isProvisional: boolean;
  /** True when every contributing sitting has been published. */
  isPublished: boolean;
}

/** Where a student stands overall. */
export interface AcademicStandingDTO {
  cgpa: string | null;
  /** CGPA as a percentage of the scale's ceiling. */
  cgpaPercent: string | null;
  /** Read from the tenant's own bands — never computed from a threshold here. */
  classification: string | null;
  grade: string | null;
  creditsEarned: string;
  backlogCount: number;
  isClear: boolean;
}

/** GET /api/results/student/[studentId] */
export interface StudentResultDTO {
  studentId: string;
  enrollmentNo: string;
  semesters: SemesterResultDTO[];
  cgpa: GpaDTO;
  credits: CreditPositionDTO;
  standing: AcademicStandingDTO;
  /** Students the batch could not compute are never silently omitted. */
  warnings: string[];
}

/** One line of a transcript. */
export interface TranscriptLineDTO {
  semesterId: string;
  semesterName: string;
  creditsRegistered: string;
  creditsEarned: string;
  sgpa: string | null;
  /** Cumulative up to and including this semester. */
  cgpa: string | null;
  backlogCount: number;
  courses: TranscriptCourseDTO[];
}

/** One course as a transcript prints it. */
export interface TranscriptCourseDTO {
  courseCode: string;
  courseName: string;
  credits: string;
  grade: string | null;
  gradePoint: string | null;
  attemptNumber: number;
  outcome: CourseOutcome;
}

/** GET /api/results/transcript/[studentId] */
export interface TranscriptDTO {
  studentId: string;
  enrollmentNo: string;
  lines: TranscriptLineDTO[];
  degreeSummary: {
    creditsRegistered: string;
    creditsEarned: string;
    cgpa: string | null;
    classification: string | null;
    semestersCompleted: number;
  };
  standing: AcademicStandingDTO;
  /** A transcript with anything outstanding is not a final transcript. */
  isProvisional: boolean;
}

/** One point on a trend line. */
export interface TrendPointDTO {
  semesterId: string;
  semesterName: string;
  sgpa: string | null;
  cgpa: string | null;
  creditsEarned: string;
  backlogCount: number;
}

/** How one component fared across a student's whole record. */
export interface ComponentBreakdownDTO {
  code: string;
  achieved: string;
  maxMarks: string;
  percent: string | null;
  courseCount: number;
}

/** One re-attempt a student made. */
export interface ImprovementDTO {
  courseCode: string;
  attemptNumber: number;
  registrationType: string;
  grade: string | null;
  gradePoint: string | null;
  outcome: CourseOutcome;
}

/** GET /api/results/analytics/[studentId] */
export interface StudentAnalyticsDTO {
  studentId: string;
  enrollmentNo: string;

  /** SGPA and CGPA per semester, in academic order. */
  performanceTrend: TrendPointDTO[];
  /** Newest SGPA minus oldest. Null with fewer than two graded semesters. */
  trendDelta: string | null;

  /**
   * Every leaf component totalled across the record.
   *
   * "Internal versus external" is read from this by the client, because WHICH
   * components are internal is a tenant's configuration and not a fact this
   * engine may assume. Nothing here names a component.
   */
  componentBreakdown: ComponentBreakdownDTO[];

  credits: CreditPositionDTO;
  standing: AcademicStandingDTO;

  backlogs: BacklogDTO[];
  improvementHistory: ImprovementDTO[];
  /** Populated only where a cohort was computed alongside — otherwise empty. */
  rankHistory: RankHistoryDTO[];
}

/** A course concluded and not passed. */
export interface BacklogDTO {
  courseCode: string;
  courseName: string;
  semesterId: string;
  credits: string;
  attemptNumber: number;
  outcome: CourseOutcome;
  /** True when a later attempt at the same course passed. */
  isCleared: boolean;
}

/** A rank a student held. */
export interface RankHistoryDTO {
  semesterId: string;
  scope: string;
  rank: number;
  outOf: number;
  isTied: boolean;
}

/** One student's row in a cohort report. */
export interface CohortStudentDTO {
  studentId: string;
  enrollmentNo: string;
  sgpa: string | null;
  percentage: string | null;
  creditsEarned: string;
  backlogCount: number;
  isPromoted: boolean;
  /** Null when the student was excluded from ranking — e.g. a sealed result. */
  rank: number | null;
}

/** How a cohort performed. */
export interface CohortStatisticsDTO {
  total: number;
  /** Students with a resolvable result. Averages divide by THIS, not by total. */
  evaluated: number;
  passed: number;
  failed: number;
  /** Withheld or unfinished. Neither passed nor failed. */
  pending: number;
  passPercent: string | null;
  failPercent: string | null;
  average: string | null;
  median: string | null;
  highest: string | null;
  lowest: string | null;
}

/** How many students earned each grade. */
export interface GradeDistributionDTO {
  grade: string;
  count: number;
  percent: string;
}

/** GET /api/results/semester/[semesterId] */
export interface SemesterCohortResultDTO {
  semesterId: string;
  semesterName: string;
  students: CohortStudentDTO[];
  statistics: CohortStatisticsDTO;
  gradeDistribution: GradeDistributionDTO[];
  /** Ordered best first. Students with no result are excluded, not ranked last. */
  meritList: MeritEntryDTO[];
  /** Students the engine could not compute, never silently dropped. */
  failures: string[];
}

/** One entry of a merit list. */
export interface MeritEntryDTO {
  studentId: string;
  enrollmentNo: string;
  rank: number;
  outOf: number;
  isTied: boolean;
  sgpa: string | null;
}

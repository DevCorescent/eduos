// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Profile Portal
// LAYER      : Service
// PURPOSE    : Resolve the caller to their own Student row, compose the profile
//              DTOs, and assemble the dashboard from services that already own
//              the figures it shows.
// ARCHITECTURE:
//   • Service owns ALL orchestration and the one calculation this module has:
//     profile completion, whose weighting is a documented constant.
//   • It issues no query of its own beyond StudentProfileRepository, and it
//     RE-DERIVES NOTHING. SGPA, CGPA and credits come from ResultService;
//     attendance and its warning line from AttendanceAnalyticsService; dues
//     from StudentFinanceService. Recomputing any of them here would be a
//     second opinion about a number a student can already see elsewhere.
//
// SELF-SERVICE, ENFORCED IN ONE PLACE
//   Every public method takes (tenantId, userId) and never a studentId. The
//   Student row is resolved ONCE per request by resolveOwnStudent(), and every
//   read afterwards uses the resolved id. A caller-supplied id is not merely
//   ignored — no method has a parameter to put one in.
//
//   A caller holding a permitted role but owning no Student row is FORBIDDEN,
//   not served an empty profile. That is the UNIVERSITY_ADMIN case the Phase 18
//   decision names explicitly, and it uses the same message and status as "no
//   such student" so the two are indistinguishable from outside.
//
// A FAILING PANEL MUST NOT TAKE THE DASHBOARD DOWN
//   The three composed services each throw on their own failure modes —
//   AttendanceAnalyticsService raises 404 for a student it cannot find, and the
//   result engine can refuse a broken regulation. A dashboard that propagated
//   any of those would show a student nothing because one panel was
//   unavailable. So each section is settled independently and degrades to null,
//   which is exactly the Phase 18 instruction: return null for unavailable
//   data, never fabricate.
//
// QUERY BUDGET, STATED HONESTLY
//   getProfile      6 statements (repository only).
//   getAchievements 2 statements (resolve + read).
//   getDashboard    1 resolve + 1 counts + 1 notifications + whatever the three
//                   composed services cost — currently ~8 (result), ~2+
//                   (attendance), ~5 (finance, including its own resolve).
//   The dashboard is therefore the expensive endpoint in this module, and the
//   cost is the price of NOT duplicating three subsystems' logic. It is bounded
//   and constant per request — no call is inside a loop — but it is not cheap,
//   and a later phase wanting it cheaper should add a projection to those
//   services rather than reimplement them here.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE } from "@/lib/constants/errors";
import {
  DASHBOARD_PENDING_FEE_LIMIT,
  PROFILE_COMPLETION_TOTAL,
  PROFILE_COMPLETION_WEIGHTS,
  PROFILE_REQUIRED_FIELDS,
  STUDENT_PROFILE_MESSAGE,
  type ProfileSection,
} from "@/lib/constants/studentProfile";
import { MARK_SCALE } from "@/lib/constants/resultEngine";
import { formatScaled, toScaled } from "@/lib/domain/result-engine/decimal";
import { DocumentType } from "@/app/generated/prisma/enums";
import type { StudentProfileRepository } from "@/lib/repositories/studentProfile.repository";
import type { ResultService } from "@/lib/services/result.service";
import type { AttendanceAnalyticsService } from "@/lib/services/attendanceAnalytics.service";
import type { StudentFinanceService } from "@/lib/services/studentFinance.service";
import type { AchievementQuery, DashboardQuery } from "@/lib/validations/studentProfile.validation";
import {
  toAchievementDto,
  toCertificateDto,
  toNotificationDto,
  toParentDto,
  toProfilePhotoDto,
  toStudentDocumentDto,
  toStudentPersonalDto,
  type AchievementDto,
  type StudentDashboardDto,
  type StudentProfileDto,
} from "@/lib/dto/studentProfile.dto";

/**
 * The narrow slices of three other services this module depends on.
 *
 * Interface Segregation, and the reason the project already does this: the
 * profile service needs ONE method from each, so it depends on exactly those
 * three rather than on three whole classes. Narrowing at the type level is what
 * makes it impossible for profile composition to quietly start writing marks —
 * and what makes this class unit-testable with three tiny fakes.
 */
export type ProfileResultPort = Pick<ResultService, "getStudentResult">;
export type ProfileAttendancePort = Pick<AttendanceAnalyticsService, "getAnalytics">;
export type ProfileFinancePort = Pick<StudentFinanceService, "getPendingFees">;

/** How one section of the profile scored. */
export interface SectionScore {
  readonly section: ProfileSection;
  readonly weight: number;
  readonly complete: boolean;
  readonly missing: readonly string[];
}

export class StudentProfileService {
  constructor(
    private readonly repository: StudentProfileRepository,
    private readonly results: ProfileResultPort,
    private readonly attendance: ProfileAttendancePort,
    private readonly finance: ProfileFinancePort
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/student/profile
  // --------------------------------------------------------------------------

  /**
   * The caller's whole profile.
   *
   * Six statements: one resolve, then five collections issued CONCURRENTLY.
   * They have no ordering dependency, so awaiting them one at a time would pay
   * five round trips for one page.
   */
  async getProfile(tenantId: string, userId: string, now: Date): Promise<StudentProfileDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const [profile, parents, documents, certificates, achievements] = await Promise.all([
      this.repository.findProfile(tenantId, studentId),
      this.repository.findParents(studentId),
      this.repository.findDocuments(studentId),
      this.repository.findCertificates(tenantId, studentId),
      this.repository.findAchievements(tenantId, studentId),
    ]);

    if (profile === null) {
      // The id was resolved a moment ago, so this is a row deleted mid-request
      // rather than an authorisation failure. 404 is the honest answer.
      throw new AppError(STUDENT_PROFILE_MESSAGE.PROFILE_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    return {
      identity: {
        studentId: profile.id,
        enrollmentNo: profile.enrollmentNo,
        firstName: profile.user.firstName,
        lastName: profile.user.lastName,
        displayName: profile.user.displayName,
        email: profile.user.email,
        phone: profile.user.phone,
        photo: toProfilePhotoDto(profile.user.avatarUrl, photoDocumentUrl(documents)),
        status: profile.status,
      },
      personal: profile.personal === null ? null : toStudentPersonalDto(profile.personal),
      academic: {
        programmeId: profile.programmeId,
        batchId: profile.batchId,
        batchName: profile.batch?.name ?? null,
        sectionId: profile.sectionId,
        sectionName: profile.section?.name ?? null,
        specialisationId: profile.specialisationId,
        specialisationName: profile.specialisation?.name ?? null,
        currentSemester: profile.currentSemester,
        admissionDate: profile.admissionDate.toISOString(),
        graduationDate:
          profile.graduationDate === null ? null : profile.graduationDate.toISOString(),
      },
      parents: parents.map(toParentDto),
      documents: documents.map(toStudentDocumentDto),
      certificates: certificates.map((row) => toCertificateDto(row, now)),
      achievements: achievements.map(toAchievementDto),
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/student/achievements
  // --------------------------------------------------------------------------

  /** The caller's own achievements, newest achieved first. */
  async getAchievements(
    tenantId: string,
    userId: string,
    query: AchievementQuery
  ): Promise<readonly AchievementDto[]> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);
    const rows = await this.repository.findAchievements(tenantId, studentId, query.category);

    return rows.map(toAchievementDto);
  }

  // --------------------------------------------------------------------------
  // GET /api/student/dashboard
  // --------------------------------------------------------------------------

  /**
   * The caller's dashboard.
   *
   * Each of the three composed sections is settled INDEPENDENTLY, so one
   * subsystem being unavailable costs one panel rather than the whole page.
   * Profile completion is computed from data this module already holds and can
   * therefore never be null.
   */
  async getDashboard(
    tenantId: string,
    userId: string,
    query: DashboardQuery,
    now: Date
  ): Promise<StudentDashboardDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const [profile, parents, documents, achievements, counts, notifications] = await Promise.all([
      this.repository.findProfile(tenantId, studentId),
      this.repository.findParents(studentId),
      this.repository.findDocuments(studentId),
      this.repository.findAchievements(tenantId, studentId),
      this.repository.findProfileCounts(tenantId, studentId, now),
      this.repository.findRecentNotifications(tenantId, userId, query.notifications),
    ]);

    if (profile === null) {
      throw new AppError(STUDENT_PROFILE_MESSAGE.PROFILE_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    // Promise.all is safe here precisely because none of these three can
    // reject: each compose* method catches its own failure and degrades to
    // nulls, so a subsystem being unavailable costs one panel rather than the
    // whole page. The containment is inside the methods, not in this call.
    const [academic, attendance, finance] = await Promise.all([
      this.composeAcademic(tenantId, studentId),
      this.composeAttendance(tenantId, studentId),
      this.composeFinance(tenantId, userId),
    ]);

    const completion = this.scoreProfile(profile, parents, documents, achievements);

    return {
      academic: {
        programmeId: profile.programmeId,
        currentSemester: profile.currentSemester,
        sectionId: profile.sectionId,
        sectionName: profile.section?.name ?? null,
        ...academic,
      },
      attendance,
      finance,
      profile: {
        completionPercent: completion.percent,
        missingFields: completion.missing,
      },
      summary: {
        pendingDocuments: counts.pendingDocuments,
        activeCertificates: counts.activeCertificates,
        achievementCount: achievements.length,
      },
      notifications: notifications.map(toNotificationDto),
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE — composition
  // --------------------------------------------------------------------------

  /**
   * SGPA, CGPA, earned credits and backlogs, from ResultService.
   *
   * The SGPA reported is the LATEST semester's, because that is what "your
   * SGPA" means on a dashboard; the transcript endpoint carries the full
   * history. Every figure degrades to null rather than to zero.
   */
  private async composeAcademic(tenantId: string, studentId: string) {
    try {
      const result = await this.results.getStudentResult(tenantId, studentId, { scope: "ANY" });
      const latest = result.semesters[result.semesters.length - 1];

      return {
        sgpa: latest?.sgpa.value ?? null,
        cgpa: result.cgpa.value,
        earnedCredits: result.credits.earned,
        backlogCount: latest?.backlogCount ?? null,
      };
    } catch {
      // A regulation that could not be prepared, or a student with no
      // registrations at all. Neither is a reason to fail the whole dashboard.
      return { sgpa: null, cgpa: null, earnedCredits: null, backlogCount: null };
    }
  }

  /**
   * Attendance and its warning flag, from AttendanceAnalyticsService.
   *
   * `hasWarning` is READ from that service's own `alerts.lowAttendance` rather
   * than recomputed against a threshold declared here. There is exactly one
   * definition of the warning line in this codebase and it is not in this file.
   */
  private async composeAttendance(tenantId: string, studentId: string) {
    try {
      const analytics = await this.attendance.getAnalytics(tenantId, studentId);

      return {
        overallPercent: analytics.overallPercentage.toFixed(MARK_SCALE),
        hasWarning: analytics.alerts.lowAttendance,
      };
    } catch {
      // No attendance recorded, or the subsystem is unavailable. A student with
      // no attendance has no percentage — and no warning either, because a
      // warning about a figure nobody has is not actionable.
      return { overallPercent: null, hasWarning: false };
    }
  }

  /**
   * Pending demands and what they total, from StudentFinanceService.
   *
   * The count is always exact — it comes from the paginated total. The AMOUNT
   * is stated only when every demand was returned; if a student somehow holds
   * more than the bound, the sum of one page is not the outstanding balance and
   * reporting it as one would be a fabrication that looks authoritative.
   */
  private async composeFinance(tenantId: string, userId: string) {
    try {
      const pending = await this.finance.getPendingFees(tenantId, userId, {
        page: 1,
        limit: DASHBOARD_PENDING_FEE_LIMIT,
        sortBy: "dueDate",
        sortOrder: "asc",
      });

      const complete = pending.demands.length >= pending.pagination.total;

      return {
        pendingFeeCount: pending.pagination.total,
        outstandingAmount: complete ? sumOutstanding(pending.demands) : null,
      };
    } catch {
      return { pendingFeeCount: null, outstandingAmount: null };
    }
  }

  // --------------------------------------------------------------------------
  // PRIVATE — profile completion
  // --------------------------------------------------------------------------

  /**
   * Score the profile against the documented weighting.
   *
   * All-or-nothing per section — see PROFILE_COMPLETION_WEIGHTS for why. The
   * percentage is integer division of the earned weight by the declared total,
   * so a weighting that no longer summed to 100 would still produce a coherent
   * percentage rather than one silently capped below it.
   *
   * COMPLEXITY : O(1) — a fixed number of presence checks, independent of how
   *              many documents, parents or achievements the student holds.
   */
  private scoreProfile(
    profile: NonNullable<Awaited<ReturnType<StudentProfileRepository["findProfile"]>>>,
    parents: readonly unknown[],
    documents: readonly { fileUrl: string; type: DocumentType }[],
    achievements: readonly unknown[]
  ): { percent: number; missing: string[] } {
    const personal = profile.personal;
    const contact =
      personal === null ? null : toStudentPersonalDto(personal).emergencyContact;

    const sections: SectionScore[] = [
      score("BASIC_INFO", [
        ["firstName", nonEmpty(profile.user.firstName)],
        ["lastName", nonEmpty(profile.user.lastName)],
        ["email", nonEmpty(profile.user.email)],
        ["phone", nonEmpty(profile.user.phone)],
      ]),
      score("PERSONAL_DETAILS", [
        ["dateOfBirth", personal?.dateOfBirth != null],
        ["gender", personal?.gender != null],
        ["bloodGroup", personal?.bloodGroup != null],
        ["nationality", nonEmpty(personal?.nationality ?? null)],
      ]),
      score("PARENTS", [["parents", parents.length > 0]]),
      score("DOCUMENTS", [["documents", documents.length > 0]]),
      score("PHOTO", [
        [
          "photo",
          toProfilePhotoDto(profile.user.avatarUrl, photoDocumentUrl(documents)).source !== "NONE",
        ],
      ]),
      score("EMERGENCY_CONTACT", [["emergencyContact", contact?.hasContact === true]]),
      score("ACHIEVEMENTS", [["achievements", achievements.length > 0]]),
    ];

    let earned = 0;
    const missing: string[] = [];

    for (const section of sections) {
      if (section.complete) {
        earned += section.weight;
      } else {
        missing.push(...section.missing);
      }
    }

    return {
      percent: Math.round((earned / PROFILE_COMPLETION_TOTAL) * 100),
      missing,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE — resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve the caller to the Student row they own.
   *
   * The single gate every public method passes through. A permitted role with
   * no Student row in this tenant — the UNIVERSITY_ADMIN case — is FORBIDDEN
   * rather than served an empty profile, matching the convention
   * StudentFinanceService and ResultService already established for the
   * identical situation.
   */
  private async resolveOwnStudent(tenantId: string, userId: string): Promise<string> {
    const own = await this.repository.findStudentByUserId(tenantId, userId);

    if (own === null) {
      throw new AppError(STUDENT_PROFILE_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    return own.id;
  }
}

// --- Helpers ----------------------------------------------------------------

/** Whether a nullable string carries anything a portal would render. */
function nonEmpty(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

/** The url of the most recent uploaded PHOTO document, if any. */
function photoDocumentUrl(
  documents: readonly { fileUrl: string; type: DocumentType }[]
): string | null {
  // The repository already orders documents newest first, so the first PHOTO is
  // the current one. No sort here — re-sorting would be a second opinion about
  // an ordering the repository already states.
  return documents.find((document) => document.type === DocumentType.PHOTO)?.fileUrl ?? null;
}

/** Build one section's score from its field checks. */
function score(section: ProfileSection, checks: readonly [string, boolean][]): SectionScore {
  const missing = checks.filter(([, present]) => !present).map(([field]) => field);

  return {
    section,
    weight: PROFILE_COMPLETION_WEIGHTS[section],
    complete: missing.length === 0,
    missing:
      missing.length === 0
        ? []
        : // A section whose checks are a single presence flag reports the
          // section's own field name rather than a duplicate of it.
          missing.length === checks.length && checks.length === 1
          ? [...PROFILE_REQUIRED_FIELDS[section]]
          : missing,
  };
}

/**
 * Total what a set of demands still owes, in EXACT integer hundredths.
 *
 * Reuses the result engine's decimal helpers rather than parseFloat: summing
 * money as IEEE 754 is how a portal ends up showing an outstanding balance of
 * 12500.499999999998. Each demand is clamped at zero — an overpayment on one
 * demand is not credit against another, and letting it subtract would report a
 * balance smaller than the student actually owes.
 */
function sumOutstanding(
  demands: readonly { totalAmount: string; paidAmount: string; waivedAmount: string }[]
): string {
  let total = 0;

  for (const demand of demands) {
    const outstanding =
      toScaled(demand.totalAmount) - toScaled(demand.paidAmount) - toScaled(demand.waivedAmount);

    total += outstanding > 0 ? outstanding : 0;
  }

  return formatScaled(total, MARK_SCALE);
}

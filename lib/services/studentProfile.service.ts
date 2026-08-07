// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Profile Portal
// LAYER      : Service
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

export type ProfileResultPort = Pick<ResultService, "getStudentResult">;
export type ProfileAttendancePort = Pick<AttendanceAnalyticsService, "getAnalytics">;
export type ProfileFinancePort = Pick<StudentFinanceService, "getPendingFees">;

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

  async getAchievements(
    tenantId: string,
    userId: string,
    query: AchievementQuery
  ): Promise<readonly AchievementDto[]> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);
    const rows = await this.repository.findAchievements(tenantId, studentId, query.category);

    return rows.map(toAchievementDto);
  }

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

    // IMPORTANT FOR THIS INVESTIGATION: try/catch inside each compose* method
    // only guards against a REJECTION. If any of the three subsystem calls
    // below awaits something that never settles (e.g. a hung DB connection),
    // this Promise.all — and therefore this whole endpoint — never resolves,
    // which matches "keeps loading" exactly. The per-section timings logged
    // inside each compose* method show WHICH of the three never returns.
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
      return { sgpa: null, cgpa: null, earnedCredits: null, backlogCount: null };
    }
  }

  private async composeAttendance(tenantId: string, studentId: string) {
    try {
      const analytics = await this.attendance.getAnalytics(tenantId, studentId);

      return {
        overallPercent: analytics.overallPercentage.toFixed(MARK_SCALE),
        hasWarning: analytics.alerts.lowAttendance,
      };
    } catch {
      return { overallPercent: null, hasWarning: false };
    }
  }

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

  private async resolveOwnStudent(tenantId: string, userId: string): Promise<string> {
    const own = await this.repository.findStudentByUserId(tenantId, userId);

    if (own === null) {
      throw new AppError(STUDENT_PROFILE_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    return own.id;
  }
}

// --- Helpers ----------------------------------------------------------------

function nonEmpty(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function photoDocumentUrl(
  documents: readonly { fileUrl: string; type: DocumentType }[]
): string | null {
  return documents.find((document) => document.type === DocumentType.PHOTO)?.fileUrl ?? null;
}

function score(section: ProfileSection, checks: readonly [string, boolean][]): SectionScore {
  const missing = checks.filter(([, present]) => !present).map(([field]) => field);

  return {
    section,
    weight: PROFILE_COMPLETION_WEIGHTS[section],
    complete: missing.length === 0,
    missing:
      missing.length === 0
        ? []
        : missing.length === checks.length && checks.length === 1
          ? [...PROFILE_REQUIRED_FIELDS[section]]
          : missing,
  };
}

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
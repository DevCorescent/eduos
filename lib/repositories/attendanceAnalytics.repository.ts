// ============================================================================
// OWNER      : Gauransh
// MODULE     : Attendance Analytics
// LAYER      : Repository
// PURPOSE    : Prisma database access layer.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No calculations.
//   • No business logic.
//   • No percentage computation.
//   • No prediction.
//   • No leave calculation.
// ============================================================================

import { prisma } from "@/lib/db/prisma";

export class AttendanceAnalyticsRepository {
  /**
   * Fetch student profile.
   */
  async getStudent(
    tenantId: string,
    studentId: string
  ) {
    return prisma.student.findFirst({
      where: {
        id: studentId,
        tenantId,
      },
      include: {
        user: true,
        batch: true,
        section: {
          include: {
            semester: true,
          },
        },
        specialisation: true,
      },
    });
  }

  /**
   * Resolve a caller's own Student row from their authenticated user id.
   *
   * Added for Phase 15 route-level self-scoping: a STUDENT caller must be
   * confined to their own analytics, exactly as GET
   * /api/attendance/report/[studentId] confines a student to their own report.
   * That route resolves ownership the same way — Student.userId, scoped to the
   * tenant — but does so with a direct prisma call since it has no repository
   * of its own. This module already has one, so the same lookup belongs here
   * rather than being duplicated inline in each analytics route.
   *
   * Selects only the id: the route needs it purely for comparison against the
   * requested studentId, not to display anything about the caller.
   */
  async getStudentIdByUserId(
    tenantId: string,
    userId: string
  ) {
    return prisma.student.findFirst({
      where: {
        userId,
        tenantId,
      },
      select: {
        id: true,
      },
    });
  }

  /**
   * Confirm a studentId belongs to the tenant, without the full profile.
   *
   * Added for Phase 15 route-level scoping: an elevated caller (FACULTY /
   * UNIVERSITY_ADMIN) must still be blocked from running analytics against a
   * studentId that doesn't exist or belongs to another tenant, matching the
   * existence check in GET /api/attendance/report/[studentId]. getStudent()
   * above answers the same question but pulls user/batch/section/
   * specialisation along with it; a route that only needs a yes/no shouldn't
   * pay for that join.
   */
  async studentExists(
    tenantId: string,
    studentId: string
  ): Promise<boolean> {
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        tenantId,
      },
      select: {
        id: true,
      },
    });

    return student !== null;
  }

  /**
   * Fetch complete attendance history.
   */
  async getAttendanceRecords(
    tenantId: string,
    studentId: string
  ) {
    return prisma.attendance.findMany({
      where: {
        tenantId,
        studentId,
      },

      include: {
        faculty: true,

        section: {
          include: {
            semester: true,
            batch: true,
          },
        },

        timetable: true,
      },

      orderBy: {
        date: "asc",
      },
    });
  }

  /**
   * Attendance by course.
   */
  async getAttendanceByCourse(
    tenantId: string,
    studentId: string,
    courseId: string
  ) {
    return prisma.attendance.findMany({
      where: {
        tenantId,
        studentId,
        courseId,
      },

      include: {
        timetable: true,
      },

      orderBy: {
        date: "asc",
      },
    });
  }

  /**
   * Attendance by semester.
   */
  async getAttendanceBySemester(
    tenantId: string,
    studentId: string,
    semesterId: string
  ) {
    return prisma.attendance.findMany({
      where: {
        tenantId,
        studentId,

        section: {
          semesterId,
        },
      },

      include: {
        section: {
          include: {
            semester: true,
          },
        },
      },

      orderBy: {
        date: "asc",
      },
    });
  }

  /**
   * Attendance by calendar year.
   */
  async getAttendanceByYear(
    tenantId: string,
    studentId: string,
    year: number
  ) {
    return prisma.attendance.findMany({
      where: {
        tenantId,
        studentId,

        date: {
          gte: new Date(`${year}-01-01T00:00:00.000Z`),
          lte: new Date(`${year}-12-31T23:59:59.999Z`),
        },
      },

      orderBy: {
        date: "asc",
      },
    });
  }

  /**
   * Attendance grouped by course and status.
   */
  async getCourseAttendanceSummary(
    tenantId: string,
    studentId: string
  ) {
    return prisma.attendance.groupBy({
      by: [
        "courseId",
        "status",
      ],

      where: {
        tenantId,
        studentId,
      },

      _count: {
        id: true,
      },

      orderBy: {
        courseId: "asc",
      },
    });
  }

  /**
   * Attendance grouped by status.
   */
  async getAttendanceStatusSummary(
    tenantId: string,
    studentId: string
  ) {
    return prisma.attendance.groupBy({
      by: ["status"],

      where: {
        tenantId,
        studentId,
      },

      _count: {
        id: true,
      },
    });
  }

  /**
   * Monthly attendance.
   */
  async getMonthlyAttendance(
    tenantId: string,
    studentId: string
  ) {
    return prisma.attendance.findMany({
      where: {
        tenantId,
        studentId,
      },

      select: {
        date: true,
        status: true,
        courseId: true,
      },

      orderBy: {
        date: "asc",
      },
    });
  }

  /**
   * Dashboard dataset.
   */
  async getDashboardAttendance(
    tenantId: string
  ) {
    return prisma.attendance.findMany({
      where: {
        tenantId,
      },

      select: {
        studentId: true,
        courseId: true,
        sectionId: true,
        date: true,
        status: true,
      },
    });
  }

  /**
   * Fetch semester.
   */
  async getSemester(
    semesterId: string
  ) {
    return prisma.semester.findUnique({
      where: {
        id: semesterId,
      },
    });
  }

  /**
   * Fetch all semesters.
   */
  async getSemesters(
    tenantId: string
  ) {
    return prisma.semester.findMany({
      where: {
        tenantId,
      },

      orderBy: {
        semesterNumber: "asc",
      },
    });
  }

  /**
   * Fetch course names for a set of course ids, scoped to the tenant.
   *
   * Added for Phase 15 subject-wise analytics: Attendance.courseId is a bare
   * string with no relation to Course (see the notes in
   * lib/validations/attendance.ts — Attendance declares no course relation at
   * all), so course names cannot be included in the attendance query itself
   * and must be resolved with a second, explicit lookup.
   *
   * Returns [] without a query when courseIds is empty, since Prisma's `in: []`
   * is a valid but wasteful round trip for a result that is always [].
   */
  async getCourses(
    tenantId: string,
    courseIds: string[]
  ) {
    if (courseIds.length === 0) {
      return [];
    }

    return prisma.course.findMany({
      where: {
        tenantId,
        id: {
          in: courseIds,
        },
      },

      select: {
        id: true,
        name: true,
        code: true,
      },
    });
  }
  /**
   * ============================================================================
   * Phase 15
   * Create Low Attendance Notification
   * ============================================================================
   */
  async createLowAttendanceNotification(
    tenantId: string,
    userId: string,
    percentage: number
  ) {
    return prisma.notification.create({
      data: {
        tenantId,
        userId,
        type: "IN_APP",
        subject: "Low Attendance Warning",
        body: `Your attendance is ${percentage}%. Minimum required attendance is 75%.`,
        status: "PENDING",
        data: {
          percentage,
          minimumRequired: 75,
        },
      },
    });
  }
}

export const attendanceAnalyticsRepository =
  new AttendanceAnalyticsRepository();
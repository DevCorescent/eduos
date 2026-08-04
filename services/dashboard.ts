// ============================================================================
// MODULE : Services — University Dashboard
// PURPOSE: The single call the university dashboard makes.
//
//          Assembled here rather than in the page so the page has no idea how
//          many sources the figures come from. Today that is four fixture
//          modules and two count queries; against a real backend it should be
//          one GET /api/dashboard/summary. Either way the page calls one
//          function and renders what it gets.
//
//          Live mode is deliberately partial and honest about it. Counts of
//          students and faculty are real — every collection endpoint returns
//          pagination.total. Courses running and outstanding fees have no
//          endpoint at all (backend Phases 8 and 11), so those come back null
//          and the dashboard renders them as unavailable rather than as zero.
//          A zero would read as "nothing is being taught", which is a
//          statement, and a false one.
// ============================================================================

import type { ApiResponse } from "@/types";
import { USE_MOCKS } from "./config";
import { countFaculty, countEmployees } from "./faculty";
import { countStudents } from "./students";
import { mockOk } from "@/mock/utils";
import { CURRENT_ACADEMIC_YEAR, CURRENT_SEMESTER, MOCK_PROGRAMMES } from "@/mock/data/academics";
import { coursesRunningCount } from "@/mock/data/courses";
import { MOCK_FEE_DEMANDS, outstandingAmount, pendingFeeDemands } from "@/mock/data/finance";
import { MOCK_FACULTY, MOCK_STUDENTS } from "@/mock/data/people";

export interface DashboardSummary {
  students: { total: number; active: number };
  faculty: { total: number; active: number };
  employees: { total: number };
  /** null when no endpoint can answer it yet — render as unavailable, not zero. */
  coursesRunning: number | null;
  fees: {
    pendingCount: number | null;
    overdueCount: number | null;
    outstandingAmount: number | null;
  };
  /** Programmes accepting intake. */
  activeProgrammes: number;
  currentAcademicYear: string | null;
  currentSemester: string | null;
}

export async function getDashboardSummary(): Promise<ApiResponse<DashboardSummary>> {
  if (USE_MOCKS) {
    const pending = pendingFeeDemands();

    return mockOk<DashboardSummary>({
      students: {
        total: MOCK_STUDENTS.length,
        active: MOCK_STUDENTS.filter((s) => s.status === "ACTIVE").length,
      },
      faculty: {
        total: MOCK_FACULTY.length,
        active: MOCK_FACULTY.filter((f) => f.status === "ACTIVE").length,
      },
      employees: { total: 0 },
      coursesRunning: coursesRunningCount(),
      fees: {
        pendingCount: pending.length,
        overdueCount: MOCK_FEE_DEMANDS.filter((d) => d.status === "OVERDUE").length,
        outstandingAmount: outstandingAmount(),
      },
      activeProgrammes: MOCK_PROGRAMMES.filter((p) => p.isActive).length,
      currentAcademicYear: CURRENT_ACADEMIC_YEAR.name,
      currentSemester: CURRENT_SEMESTER.name,
    });
  }

  // Issued together: none of these depends on another, so awaiting them in
  // sequence would stack five round trips onto first paint.
  const [studentsTotal, studentsActive, facultyTotal, facultyActive, employeesTotal] =
    await Promise.all([
      countStudents(),
      countStudents({ status: "ACTIVE" }),
      countFaculty(),
      countFaculty({ status: "ACTIVE" }),
      countEmployees(),
    ]);

  return {
    success: true,
    data: {
      students: { total: studentsTotal, active: studentsActive },
      faculty: { total: facultyTotal, active: facultyActive },
      employees: { total: employeesTotal },
      coursesRunning: null,
      fees: { pendingCount: null, overdueCount: null, outstandingAmount: null },
      // Also unavailable live: /api/programmes exists but returns a page, and
      // there is no isActive filter, so a truthful count needs the endpoint to
      // support one rather than this counting a first page.
      activeProgrammes: 0,
      currentAcademicYear: null,
      currentSemester: null,
    },
  };
}

// ============================================================================
// MODULE : Services — University Dashboard
// PURPOSE: The single call the university dashboard makes.
//
//          Assembled here rather than in the page so the page has no idea how
//          many endpoints the figures come from. There is no summary endpoint;
//          every figure below is derived from a collection route that already
//          exists, and the composition is confined to this file.
//
// HOW EACH FIGURE IS SOURCED, AND WHERE IT STOPS
//   Counts (students, faculty, employees, courses) come from `pagination.total`
//   on a one-row request — one cheap round trip each, and correct regardless of
//   how many pages the collection spans.
//
//   Three figures have no matching filter on their endpoint: GET /api/programmes
//   takes no ?isActive, and GET /api/fee-demands takes no ?status. Those are
//   counted by walking pages and tallying client-side, bounded by SCAN_PAGE_CAP.
//   A collection larger than the cap returns null rather than the partial tally:
//   an undercount presented as a total is a wrong number, and a wrong number is
//   worse than an absent one.
//
//   Nothing here fabricates. A figure the API cannot answer comes back null and
//   the dashboard renders "—", which says "not available" rather than "zero".
// ============================================================================

import type { ApiResponse, FeeDemand, Programme } from "@/types";
import { apiList } from "./client";
import { countFaculty, countEmployees } from "./faculty";
import { currentAcademicYear, currentSemester } from "./reference";
import { countStudents } from "./students";

/** The `limit` cap every collection endpoint enforces. */
const SCAN_PAGE_SIZE = 100;

/**
 * How many pages a client-side tally will walk before declaring the figure
 * unavailable. Ten pages of 100 covers any realistic programme catalogue and
 * a mid-sized fee ledger; beyond that the endpoint needs the filter.
 */
const SCAN_PAGE_CAP = 10;

/** Fee demand states that still owe money. */
const UNSETTLED: readonly FeeDemand["status"][] = ["PENDING", "PARTIAL", "OVERDUE"];

export interface DashboardSummary {
  students: { total: number; active: number };
  faculty: { total: number; active: number };
  employees: { total: number };
  /** Courses in the catalogue. null when the count could not be read. */
  courses: number | null;
  fees: {
    pendingCount: number | null;
    overdueCount: number | null;
    outstandingAmount: number | null;
  };
  /** Programmes accepting intake. null when the catalogue exceeded the scan cap. */
  activeProgrammes: number | null;
  currentAcademicYear: string | null;
  currentSemester: string | null;
}

/**
 * Read every page of a collection, up to the cap.
 *
 * RETURNS null when the collection is larger than the cap — see the module
 * header for why a partial tally is not returned instead.
 */
async function scanAll<T>(path: string, key: string): Promise<T[] | null> {
  const rows: T[] = [];

  for (let page = 1; page <= SCAN_PAGE_CAP; page++) {
    const result = await apiList<T>(path, key, { page, limit: SCAN_PAGE_SIZE });
    if (!result.success) return null;

    rows.push(...result.data.items);

    if (page >= result.data.pagination.totalPages) return rows;
  }

  return null;
}

/** Rows and total for a collection, without paying for rows we will not read. */
async function countOf(path: string, key: string): Promise<number | null> {
  const result = await apiList<unknown>(path, key, { page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : null;
}

/**
 * Every figure on the dashboard, in one call.
 *
 * The independent reads are issued together — awaiting them in sequence would
 * stack a dozen round trips onto first paint for data that does not depend on
 * itself.
 */
export async function getDashboardSummary(): Promise<ApiResponse<DashboardSummary>> {
  const [
    studentsTotal,
    studentsActive,
    facultyTotal,
    facultyActive,
    employeesTotal,
    courses,
    programmes,
    feeDemands,
    academicYear,
    semester,
  ] = await Promise.all([
    countStudents(),
    countStudents({ status: "ACTIVE" }),
    countFaculty(),
    countFaculty({ status: "ACTIVE" }),
    countEmployees(),
    countOf("/api/courses", "courses"),
    scanAll<Programme>("/api/programmes", "programmes"),
    scanAll<FeeDemand>("/api/fee-demands", "feeDemands"),
    currentAcademicYear(),
    currentSemester(),
  ]);

  return {
    success: true,
    data: {
      students: { total: studentsTotal, active: studentsActive },
      faculty: { total: facultyTotal, active: facultyActive },
      employees: { total: employeesTotal },
      courses,
      fees: {
        pendingCount:
          feeDemands?.filter((demand) => UNSETTLED.includes(demand.status)).length ?? null,
        overdueCount: feeDemands?.filter((demand) => demand.status === "OVERDUE").length ?? null,
        // FeeDemand carries no balance column — what is still owed is the
        // total less what was paid and what was written off. Computed rather
        // than read so a waiver is not counted as outstanding money.
        outstandingAmount:
          feeDemands?.reduce(
            (sum, demand) =>
              UNSETTLED.includes(demand.status)
                ? sum +
                  (Number(demand.totalAmount) -
                    Number(demand.paidAmount) -
                    Number(demand.waivedAmount))
                : sum,
            0
          ) ?? null,
      },
      activeProgrammes: programmes?.filter((programme) => programme.isActive).length ?? null,
      currentAcademicYear: academicYear?.name ?? null,
      currentSemester: semester?.name ?? null,
    },
  };
}

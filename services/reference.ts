// ============================================================================
// MODULE : Services — Reference Data
// PURPOSE: Request-scoped indexes of the small, slow-moving collections that
//          other services join against — courses, semesters, academic years.
//
// WHY THIS EXISTS
//   Most collection routes return scalar columns only and expand no relation:
//   an Assignment carries a courseId and no course name, an Examination carries
//   a semesterId and no semester name. Every screen that lists one of those
//   needs the name, so the join has to happen somewhere on this side.
//
//   Doing it per row would be one request per cell. Doing it here means one
//   scan per collection per request, shared by every caller in that render
//   through React's cache().
//
// DEGRADES RATHER THAN FAILS, AND DOES NOT ASK WHEN THE ANSWER IS CERTAIN
//   Every collection behind these indexes is requireRole("UNIVERSITY_ADMIN") —
//   courses, academic years, semesters, batches, sections. A student or a
//   lecturer receives 403 from all of them. That is not an error for the
//   caller: it means the name is unavailable to this user, so the index comes
//   back empty and the row renders an em dash. The page still loads.
//
//   What changed is that the request is no longer ISSUED when it cannot
//   succeed. Asking anyway cost a round trip and a database connection per
//   index, per page, to be told 403 — on the student dashboard that was a
//   guaranteed-wasted second, and it competed for the pool with the requests
//   that were going to succeed.
//
//   THIS IS NOT AUTHORIZATION. It decides whether to make a call, never
//   whether a caller may see data. Every route still runs requireRole against
//   the live database on every request; a caller who reached one of these
//   endpoints another way is refused exactly as before. Removing the check
//   below would cost latency and change no permission.
// ============================================================================

import "server-only";

import { cache } from "react";
import type { AcademicYear, Batch, Course, Section, Semester } from "@/types";
import { apiList } from "./client";
import { getPortalSession } from "./session";
import { ROLES, UNIVERSITY_ROLES, hasAnyRole } from "@/constants/roles";

/** The `limit` cap every collection endpoint enforces. */
const SCAN_PAGE_SIZE = 100;

/** Pages a scan will walk before returning what it has. */
const SCAN_PAGE_CAP = 10;

/**
 * Whether this caller may read the administrative reference collections.
 *
 * Cached for the request, so one session read serves every index below. Mirrors
 * the role sets the routes themselves enforce — SUPER_ADMIN is included because
 * the university portal admits them, exactly as constants/roles.ts describes.
 */
const canReadReference = cache(async (): Promise<boolean> => {
  const session = await getPortalSession();
  if (!session) return false;

  return (
    hasAnyRole(session.roles, UNIVERSITY_ROLES) ||
    session.roles.includes(ROLES.SUPER_ADMIN)
  );
});

/** Read a whole collection, tolerating a partial or forbidden read. */
async function scan<T>(path: string, key: string): Promise<T[]> {
  // Skipped rather than attempted-and-refused. See the module header: this is
  // a latency decision, not a permission one.
  if (!(await canReadReference())) return [];

  const rows: T[] = [];

  for (let page = 1; page <= SCAN_PAGE_CAP; page++) {
    const result = await apiList<T>(path, key, { page, limit: SCAN_PAGE_SIZE });
    if (!result.success) break;

    rows.push(...result.data.items);
    if (page >= result.data.pagination.totalPages) break;
  }

  return rows;
}

/** Index a collection by id. */
function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Every course in the catalogue, indexed by id.
 *
 * cache() scopes this to one render: ten components asking for it in the same
 * request share one scan, and the next request starts clean rather than serving
 * another tenant's catalogue from a module-level variable.
 */
export const courseIndex = cache(async (): Promise<Map<string, Course>> => {
  return byId(await scan<Course>("/api/courses", "courses"));
});

/** Every academic year, newest-first as the endpoint returns them. */
export const academicYears = cache(async (): Promise<AcademicYear[]> => {
  return scan<AcademicYear>("/api/academic-years", "academicYears");
});

/** The year flagged current, or null when none is. */
export const currentAcademicYear = cache(async (): Promise<AcademicYear | null> => {
  return (await academicYears()).find((year) => year.isCurrent) ?? null;
});

/**
 * Every semester across every academic year, indexed by id.
 *
 * Semesters are nested under a year, so this is one request per year. The years
 * are read first and then walked concurrently — sequentially would multiply the
 * latency by the number of years on file for no gain.
 */
export const semesterIndex = cache(async (): Promise<Map<string, Semester>> => {
  const years = await academicYears();

  const perYear = await Promise.all(
    years.map((year) =>
      scan<Semester>(`/api/academic-years/${year.id}/semesters`, "semesters")
    )
  );

  return byId(perYear.flat());
});

/**
 * Every section in the tenant, with the batch it belongs to.
 *
 * Sections are only reachable nested under a batch — there is no flat
 * GET /api/sections — so this reads the batches first and then walks them
 * concurrently. Exists so a screen that has to ask "which section?" can offer a
 * real list instead of being pinned to one hard-coded id.
 */
export const allSections = cache(
  async (): Promise<Array<Section & { batchName: string }>> => {
    const batches = await scan<Batch>("/api/batches", "batches");

    const perBatch = await Promise.all(
      batches.map(async (batch) => {
        const sections = await scan<Section>(`/api/batches/${batch.id}/sections`, "sections");
        return sections.map((section) => ({ ...section, batchName: batch.name }));
      })
    );

    return perBatch.flat();
  }
);

/**
 * The semester flagged current, or null.
 *
 * Looked up within the current year rather than across all of them: `isCurrent`
 * is set per year, and a stale flag on a closed year would otherwise win.
 */
export const currentSemester = cache(async (): Promise<Semester | null> => {
  const year = await currentAcademicYear();
  if (!year) return null;

  const semesters = await scan<Semester>(
    `/api/academic-years/${year.id}/semesters`,
    "semesters"
  );

  return semesters.find((semester) => semester.isCurrent) ?? null;
});

// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Section Roster
// FLOW   : Validates the query of GET /api/sections/[id]/roster before it
//          reaches the guard or the database.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Keep roster request validation declarative and in one place,
//          matching the existing per-module validation convention.
//
//          Declared in its own module rather than added to section.ts because
//          this query belongs to the attendance flow, not to section
//          administration: section.ts is the UNIVERSITY_ADMIN CRUD vocabulary,
//          and a schema a lecturer reaches does not belong inside it.
// ============================================================================

import { z } from "zod";

/**
 * Query schema for GET /api/sections/[id]/roster.
 *
 * courseId is REQUIRED, and that is an authorisation decision rather than a
 * filtering one. It does not narrow the rows — every ACTIVE student in the
 * section is on the register whatever the course. It is required because a
 * lecturer's right to read the roster comes from teaching a COURSE to this
 * SECTION, and that pair is what requireSectionRosterAccess proves. Optional,
 * a faculty caller would have nothing to prove and the guard nothing to check.
 *
 * Ids are cuids, not UUIDs, so only non-empty-once-trimmed is asserted. An
 * unrecognised but well-formed id fails the ownership proof (403) or the
 * section lookup (404) rather than validation (400) — the same convention the
 * timetable and section routes follow.
 */
export const sectionRosterQuerySchema = z.object({
  courseId: z.string().trim().min(1),
});

export type SectionRosterQuery = z.infer<typeof sectionRosterQuerySchema>;

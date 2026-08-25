// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Teaching Relationships
// LAYER  : Service (data access)
// PURPOSE: Answer one question, in one place: does THIS lecturer teach THIS
//          (section, course) pair?
//
// WHY THIS IS ITS OWN MODULE
//   Two endpoints now depend on that answer and they must never disagree:
//
//     GET  /api/sections/[id]/roster   who may READ a class register
//     POST /api/attendance             who may WRITE one
//
//   A read rule and a write rule that drift apart are worse than either being
//   wrong on its own, because the screen keeps working while the API stops
//   agreeing with it — a lecturer sees a register they are then refused
//   permission to submit, or worse, the reverse. The predicate is stated once
//   here and both callers import it.
//
// WHAT COUNTS AS TEACHING
//   Either of the two models that express the relationship is sufficient:
//
//     Timetable                — a scheduled slot for (faculty, section, course)
//     FacultyCourseAssignment  — an explicit assignment, narrowed to a section
//
//   Either alone is a true statement that this lecturer teaches this class.
//   Requiring both would refuse a lecturer whose course is assigned but not yet
//   timetabled, which is an ordinary state at the start of a term.
//
// THE PAIR, NEVER THE SECTION ALONE
//   A section is not a teaching relationship: two lecturers may each own a
//   different course in the same section. Every function here takes both ids
//   and matches both.
// ============================================================================

import { prisma } from "@/lib/db/prisma";

/** One (section, course) pair whose ownership is in question. */
export interface TeachingPair {
  readonly sectionId: string;
  readonly courseId: string;
}

/**
 * The caller's own FacultyMember id, resolved from the authenticated subject.
 *
 * INPUT   : the resolved tenant and `session.sub` — never a client-supplied
 *           facultyId, which is the whole point of routing every caller
 *           through this function.
 * RETURNS : the id, or null when this user holds no FacultyMember row in this
 *           tenant. Null is a refusal for the caller to make, not an error:
 *           an account carrying the FACULTY role with no faculty record is
 *           misconfigured, and each endpoint decides what to answer.
 *
 * findFirst rather than findUnique: the tenant predicate is part of the lookup,
 * so another tenant's faculty member can never be resolved. FacultyMember is
 * unique on userId, so this matches at most one row.
 */
export async function findFacultyIdForUser(
  tenantId: string,
  userId: string
): Promise<string | null> {
  const faculty = await prisma.facultyMember.findFirst({
    where: { userId, tenantId },
    select: { id: true },
  });

  return faculty?.id ?? null;
}

/**
 * Does this faculty member teach this exact (section, course) pair?
 *
 * COMPLEXITY : two reads issued together. Neither depends on the other and
 *              either alone is sufficient, so waiting on the first before
 *              starting the second would cost a round trip for nothing.
 */
export async function teachesPair(
  tenantId: string,
  facultyId: string,
  sectionId: string,
  courseId: string
): Promise<boolean> {
  const [slot, assignment] = await Promise.all([
    prisma.timetable.findFirst({
      where: { tenantId, facultyId, sectionId, courseId },
      select: { id: true },
    }),

    // sectionId is matched exactly, including the null case: an assignment
    // carrying no section is course-wide and does not by itself prove this
    // lecturer teaches THIS section. isActive is required — a withdrawn
    // assignment is not a teaching relationship any more.
    prisma.facultyCourseAssignment.findFirst({
      where: { tenantId, facultyId, sectionId, courseId, isActive: true },
      select: { id: true },
    }),
  ]);

  return slot !== null || assignment !== null;
}

/**
 * Does this faculty member teach EVERY pair in the list?
 *
 * For a write that may name several classes at once. All-or-nothing on
 * purpose: a batch is written in a single statement, so permitting the pairs a
 * lecturer owns and silently dropping the rest would produce a partial register
 * that the caller believes is complete — the same reason the roster endpoint
 * refuses to paginate.
 *
 * Caller is expected to pass DISTINCT pairs; a register names one pair on every
 * row, so deduplicating first turns N reads into one.
 *
 * COMPLEXITY : two reads per distinct pair, all issued together. An empty list
 *              is vacuously true and performs no reads — callers that must
 *              refuse an empty list do so themselves, because "named no class"
 *              and "teaches every class it named" are different statements.
 */
export async function teachesAllPairs(
  tenantId: string,
  facultyId: string,
  pairs: readonly TeachingPair[]
): Promise<boolean> {
  const results = await Promise.all(
    pairs.map((pair) => teachesPair(tenantId, facultyId, pair.sectionId, pair.courseId))
  );

  return results.every(Boolean);
}

// --- Write confinement ------------------------------------------------------

/** The part of an attendance record that decides whether a lecturer may write it. */
export interface MarkableRecord {
  readonly sectionId?: string;
  readonly courseId?: string;
}

/** The reads this decision composes. Injected so every branch is testable. */
export interface FacultyMarkDeps {
  findFacultyIdForUser: typeof findFacultyIdForUser;
  teachesAllPairs: typeof teachesAllPairs;
}

const DEFAULT_MARK_DEPS: FacultyMarkDeps = { findFacultyIdForUser, teachesAllPairs };

/**
 * May THIS lecturer mark THIS batch of attendance records?
 *
 * Stated here rather than inline in POST /api/attendance so the write rule sits
 * beside the read rule it must agree with, and so every branch below can be
 * exercised without a Next.js request context or a database.
 *
 * INPUT   : the resolved tenant, `session.sub`, and the batch. `record.facultyId`
 *           is deliberately absent from MarkableRecord — it is a client-supplied
 *           claim about who taught the session, and authority comes from the
 *           authenticated subject alone.
 * RETURNS : true only when the caller holds a FacultyMember row in this tenant,
 *           every record names BOTH ids, and they teach every distinct pair.
 *           One boolean because every failure is the same 403: distinguishing
 *           "you teach nothing" from "you do not teach that class" would tell a
 *           caller which classes exist.
 *
 * Callers must apply this ONLY to a non-elevated caller. An administrator marks
 * on behalf of faculty legitimately, and passing them through here would refuse
 * them for holding no FacultyMember row.
 */
export async function facultyMayMarkRecords(
  tenantId: string,
  userId: string,
  records: readonly MarkableRecord[],
  deps: FacultyMarkDeps = DEFAULT_MARK_DEPS
): Promise<boolean> {
  // Resolved from the authenticated subject, never from the batch.
  const facultyId = await deps.findFacultyIdForUser(tenantId, userId);

  // The FACULTY role without a FacultyMember row is a misconfigured account,
  // not an authority to write a register.
  if (facultyId === null) return false;

  // sectionId and courseId are OPTIONAL on the record schema, and that is the
  // hole this closes: a record naming neither has no pair to prove, so omitting
  // them would have been the way AROUND the check rather than a reason to skip
  // it. A lecturer must say which class they are marking.
  const pairs: TeachingPair[] = [];

  for (const record of records) {
    if (!record.sectionId || !record.courseId) return false;
    pairs.push({ sectionId: record.sectionId, courseId: record.courseId });
  }

  // An empty batch names no class, so there is nothing the caller has proven a
  // right to. teachesAllPairs is vacuously true on an empty list, which is
  // correct for that function and wrong here — so it is refused before the call
  // rather than by it. The route's schema already requires min(1); this holds
  // whether or not that stays true.
  if (pairs.length === 0) return false;

  // Deduplicated: a register names the same pair on every row, so this is one
  // lookup rather than one per student.
  const distinctPairs = [
    ...new Map(pairs.map((pair) => [`${pair.sectionId}|${pair.courseId}`, pair])).values(),
  ];

  return deps.teachesAllPairs(tenantId, facultyId, distinctPairs);
}

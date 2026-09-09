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

// --- Scheduling confinement -------------------------------------------------

/** The reads the scheduling decision composes. Injected so every branch is testable. */
export interface FacultyScheduleDeps {
  findFacultyIdForUser: typeof findFacultyIdForUser;
  teachesPair: typeof teachesPair;
}

const DEFAULT_SCHEDULE_DEPS: FacultyScheduleDeps = { findFacultyIdForUser, teachesPair };

/** Either the faculty id the caller may schedule as, or why they may not. */
export type FacultyScheduleDecision =
  | { allowed: true; facultyId: string }
  | { allowed: false; reason: "NO_FACULTY_RECORD" | "NOT_YOUR_CLASS" | "OTHER_FACULTY" };

/**
 * May THIS lecturer schedule or reschedule THIS class — and as whom?
 *
 * Stated here beside facultyMayMarkRecords rather than inline in the timetable
 * routes, for the reason this whole module exists: the rule that decides who may
 * WRITE a slot has to be the same rule that decides who may read one, and the
 * only way to guarantee that is for both to consult teachesPair.
 *
 * INPUT   : the resolved tenant, `session.sub`, the (section, course) pair the
 *           slot names, and the facultyId the BODY asked for — which is a claim,
 *           not an authority.
 * RETURNS : the caller's own FacultyMember id on success. The route writes THAT
 *           into the row, never the body's value, so a lecturer cannot put a
 *           colleague's name on a class even when the pair is one they teach.
 *
 * THE THREE REFUSALS ARE DISTINCT ON PURPOSE, unlike facultyMayMarkRecords,
 * which collapses everything into one boolean. Marking a register is a bulk
 * operation where a specific message would enumerate which classes exist;
 * scheduling names exactly one class the caller has already chosen from their
 * own authorized options, so nothing is disclosed by saying which rule stopped
 * them — and "you are not assigned to this course" is the difference between a
 * lecturer filing a support ticket and one giving up.
 *
 * Callers must apply this ONLY to a non-elevated caller. An administrator
 * schedules on behalf of faculty legitimately and holds no FacultyMember row.
 */
export async function facultyMayScheduleClass(
  tenantId: string,
  userId: string,
  pair: TeachingPair,
  requestedFacultyId: string | undefined,
  deps: FacultyScheduleDeps = DEFAULT_SCHEDULE_DEPS
): Promise<FacultyScheduleDecision> {
  // Resolved from the authenticated subject, never from the body.
  const facultyId = await deps.findFacultyIdForUser(tenantId, userId);

  // The FACULTY role without a FacultyMember row is a misconfigured account,
  // not an authority to publish a timetable.
  if (facultyId === null) return { allowed: false, reason: "NO_FACULTY_RECORD" };

  // A body naming someone else is refused rather than quietly rewritten. Both
  // readings are safe — the write uses `facultyId` either way — but silently
  // substituting would tell the caller their request succeeded as sent, and the
  // schedule would then differ from what they submitted.
  if (requestedFacultyId !== undefined && requestedFacultyId !== facultyId) {
    return { allowed: false, reason: "OTHER_FACULTY" };
  }

  // The pair itself. An assignment (or an existing slot) is what makes this
  // lecturer the owner of this class; without one they may not put a class on
  // the timetable for it, whichever name they put on the row.
  const teaches = await deps.teachesPair(tenantId, facultyId, pair.sectionId, pair.courseId);

  if (!teaches) return { allowed: false, reason: "NOT_YOUR_CLASS" };

  return { allowed: true, facultyId };
}

/** The refusal message each reason produces. One per reason, stated once. */
export const FACULTY_SCHEDULE_REFUSALS: Record<
  Exclude<FacultyScheduleDecision, { allowed: true }>["reason"],
  string
> = {
  NO_FACULTY_RECORD: "Your account is not linked to a faculty record.",
  NOT_YOUR_CLASS: "You are not assigned to teach this course for this section.",
  OTHER_FACULTY: "You can only schedule classes for yourself.",
};

// --- Coursework confinement -------------------------------------------------

/**
 * Does this faculty member teach this COURSE at all — in any section?
 *
 * WHY A SECOND PREDICATE RATHER THAN teachesPair
 *   Everything above answers about a (section, course) PAIR, because a register
 *   and a timetable slot are both statements about one class meeting. A piece
 *   of coursework is not: Assignment.sectionId is NULLABLE, and an assignment
 *   carrying no section is set for the whole course rather than for one class.
 *
 *   Asking teachesPair about that assignment is not possible — there is no
 *   section to match — and passing null into it would match only a
 *   FacultyCourseAssignment that itself carries no section, which is the
 *   narrower question and would refuse a lecturer who teaches every section of
 *   the course through per-section rows. So the course-wide question gets its
 *   own predicate rather than a special case bolted onto the pair one.
 *
 * WHAT COUNTS IS UNCHANGED. The same two models, read the same way, with the
 * same isActive rule on the assignment — only the section clause is dropped.
 *
 * COMPLEXITY : two reads issued together, for the reason teachesPair gives.
 */
export async function teachesCourse(
  tenantId: string,
  facultyId: string,
  courseId: string
): Promise<boolean> {
  const [slot, assignment] = await Promise.all([
    prisma.timetable.findFirst({
      where: { tenantId, facultyId, courseId },
      select: { id: true },
    }),

    // isActive is required here exactly as in teachesPair: a withdrawn
    // assignment is not a teaching relationship any more.
    prisma.facultyCourseAssignment.findFirst({
      where: { tenantId, facultyId, courseId, isActive: true },
      select: { id: true },
    }),
  ]);

  return slot !== null || assignment !== null;
}

/** The reads the coursework decision composes. Injected so every branch is testable. */
export interface FacultyCourseworkDeps {
  findFacultyIdForUser: typeof findFacultyIdForUser;
  teachesPair: typeof teachesPair;
  teachesCourse: typeof teachesCourse;
}

const DEFAULT_COURSEWORK_DEPS: FacultyCourseworkDeps = {
  findFacultyIdForUser,
  teachesPair,
  teachesCourse,
};

/** Either the faculty id the caller may set work as, or why they may not. */
export type FacultyCourseworkDecision =
  | { allowed: true; facultyId: string }
  | { allowed: false; reason: "NO_FACULTY_RECORD" | "NOT_YOUR_COURSE" | "NOT_YOUR_CLASS" };

/**
 * May THIS lecturer set or publish coursework for THIS course — and this
 * section, when one is named?
 *
 * WHAT THIS CLOSES
 *   POST /api/assignments admitted FACULTY and checked only that the course and
 *   section belonged to the caller's TENANT. Tenant membership is not a teaching
 *   relationship: every lecturer in the university satisfied it, so any of them
 *   could set work on any colleague's course — and, once published, that work
 *   notified that colleague's students. The same hole applies to publishing.
 *
 * INPUT   : the resolved tenant, `session.sub`, and the two references the
 *           assignment names. No facultyId parameter exists, and that is
 *           deliberate: Assignment.createdBy is written from the session, so
 *           there is no client-supplied claim about authorship for this
 *           function to be asked to trust.
 * RETURNS : the caller's own FacultyMember id on success — the same shape
 *           facultyMayScheduleClass returns, for the same reason.
 *
 * THE SECTION DECIDES WHICH QUESTION IS ASKED
 *   Named  — the PAIR must be taught, through teachesPair. An assignment set
 *            for Section A notifies Section A's students on publication, so
 *            the section is the thing authority has to cover.
 *   Absent — the COURSE must be taught, through teachesCourse. Course-wide work
 *            is a legitimate and ordinary shape; requiring a pair would refuse
 *            it outright.
 *
 *   Omitting the section is therefore not a way AROUND the check — it selects
 *   the course-wide check instead, which is the weaker claim and is verified on
 *   its own terms. This is the same trap facultyMayMarkRecords documents, and
 *   it is closed here by having no unchecked branch rather than by refusing.
 *
 * THE THREE REFUSALS ARE DISTINCT, as in facultyMayScheduleClass and for the
 * same reason: the caller chose one course from their own screen, so naming the
 * rule that stopped them discloses nothing they could not already see.
 *
 * Callers must apply this ONLY to a non-elevated caller. A UNIVERSITY_ADMIN
 * sets work on behalf of a department legitimately and holds no FacultyMember
 * row, so passing them through here would refuse them for that alone.
 */
export async function facultyMaySetCoursework(
  tenantId: string,
  userId: string,
  courseId: string,
  sectionId: string | null | undefined,
  deps: FacultyCourseworkDeps = DEFAULT_COURSEWORK_DEPS
): Promise<FacultyCourseworkDecision> {
  // Resolved from the authenticated subject, never from the body.
  const facultyId = await deps.findFacultyIdForUser(tenantId, userId);

  // The FACULTY role without a FacultyMember row is a misconfigured account,
  // not an authority to set work.
  if (facultyId === null) return { allowed: false, reason: "NO_FACULTY_RECORD" };

  if (sectionId !== null && sectionId !== undefined) {
    const teaches = await deps.teachesPair(tenantId, facultyId, sectionId, courseId);
    if (!teaches) return { allowed: false, reason: "NOT_YOUR_CLASS" };

    return { allowed: true, facultyId };
  }

  const teaches = await deps.teachesCourse(tenantId, facultyId, courseId);
  if (!teaches) return { allowed: false, reason: "NOT_YOUR_COURSE" };

  return { allowed: true, facultyId };
}

/** The refusal message each reason produces. One per reason, stated once. */
export const FACULTY_COURSEWORK_REFUSALS: Record<
  Exclude<FacultyCourseworkDecision, { allowed: true }>["reason"],
  string
> = {
  NO_FACULTY_RECORD: "Your account is not linked to a faculty record.",
  NOT_YOUR_COURSE: "You are not assigned to teach this course.",
  NOT_YOUR_CLASS: "You are not assigned to teach this course for this section.",
};

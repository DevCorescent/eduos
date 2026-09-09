// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Teaching Relationships
// LAYER  : Service — Unit Tests
// PURPOSE: Pin the rule that decides whether a lecturer may WRITE a register.
//
//          Both reads are injected, so all of this runs with no Next.js request
//          context, no session and no database. What is verified is the
//          decision itself — and on a write path that produces a legal academic
//          record, each of these is a security property:
//
//            • authority comes from the authenticated subject, never from a
//              facultyId in the batch
//            • a record naming no (section, course) pair is REFUSED rather than
//              skipped — omitting the ids was the way around the check
//            • the batch is all-or-nothing, so a lecturer cannot mix one class
//              they teach with one they do not
//            • the pair is matched, never the section alone
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  facultyMayMarkRecords,
  type FacultyMarkDeps,
  type TeachingPair,
} from "@/lib/services/facultyTeaching";

const TENANT_ID = "tenant_1";
const FACULTY_USER_ID = "user_faculty";
const FACULTY_ID = "faculty_1";
const SECTION_ID = "section_1";
const COURSE_ID = "course_1";

interface Behaviour {
  /** The caller's own FacultyMember id, or null when they hold no row. */
  facultyId?: string | null;
  /** The (section, course) pairs this faculty member genuinely teaches. */
  teaches?: readonly (readonly [string, string])[];
}

function deps(behaviour: Behaviour = {}) {
  /** Every pair list teachesAllPairs was asked about, to prove dedup and scope. */
  const asked: TeachingPair[][] = [];
  const resolvedFor: string[][] = [];

  const injected: FacultyMarkDeps = {
    async findFacultyIdForUser(tenantId: string, userId: string) {
      resolvedFor.push([tenantId, userId]);
      return behaviour.facultyId === undefined ? FACULTY_ID : behaviour.facultyId;
    },

    async teachesAllPairs(tenantId: string, facultyId: string, pairs: readonly TeachingPair[]) {
      assert.equal(tenantId, TENANT_ID, "always scoped to the resolved tenant");
      assert.equal(facultyId, FACULTY_ID, "always the caller's OWN resolved faculty id");
      asked.push([...pairs]);

      return pairs.every((pair) =>
        (behaviour.teaches ?? []).some(
          ([sec, crs]) => sec === pair.sectionId && crs === pair.courseId
        )
      );
    },
  };

  return { injected, asked, resolvedFor };
}

/** A record naming the taught pair. */
const OWN = { sectionId: SECTION_ID, courseId: COURSE_ID };

describe("facultyMayMarkRecords", () => {
  describe("permitted", () => {
    it("allows a batch naming ONLY the pair the lecturer teaches", async () => {
      const { injected, resolvedFor } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [OWN, OWN, OWN],
        injected
      );

      assert.equal(allowed, true);
      // Resolved from the authenticated subject and the resolved tenant only.
      assert.deepEqual(resolvedFor, [[TENANT_ID, FACULTY_USER_ID]]);
    });

    it("deduplicates the pair a register repeats on every row", async () => {
      const { injected, asked } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [OWN, OWN, OWN, OWN, OWN],
        injected
      );

      // Five students, one class — one ownership lookup, not five.
      assert.deepEqual(asked, [[{ sectionId: SECTION_ID, courseId: COURSE_ID }]]);
    });
  });

  describe("refused — the confinement itself", () => {
    it("REFUSES a section the lecturer does not teach", async () => {
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [{ sectionId: "section_other", courseId: COURSE_ID }],
        injected
      );

      assert.equal(allowed, false);
    });

    it("REFUSES their own section paired with a course they do not teach", async () => {
      // The pair is the relationship: a colleague may own a different course in
      // the very same section.
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [{ sectionId: SECTION_ID, courseId: "course_of_a_colleague" }],
        injected
      );

      assert.equal(allowed, false);
    });

    it("REFUSES their own course paired with a section they do not teach", async () => {
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [{ sectionId: "section_of_a_colleague", courseId: COURSE_ID }],
        injected
      );

      assert.equal(allowed, false);
    });

    it("REFUSES the WHOLE batch when one record names a class they do not teach", async () => {
      // All-or-nothing. The batch is one statement; accepting the owned rows and
      // dropping the rest would leave a register the caller believes was taken.
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [OWN, { sectionId: "section_other", courseId: "course_other" }],
        injected
      );

      assert.equal(allowed, false);
    });
  });

  describe("refused — the ways around the check", () => {
    it("REFUSES a record naming NEITHER section nor course", async () => {
      // Both are optional on the record schema, so omitting them would have
      // been the bypass rather than a reason to skip the check.
      const { injected, asked } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(TENANT_ID, FACULTY_USER_ID, [{}], injected);

      assert.equal(allowed, false);
      assert.deepEqual(asked, [], "refused before any ownership lookup");
    });

    it("REFUSES a record naming a section but no course", async () => {
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [{ sectionId: SECTION_ID }],
        injected
      );

      assert.equal(allowed, false);
    });

    it("REFUSES a record naming a course but no section", async () => {
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [{ courseId: COURSE_ID }],
        injected
      );

      assert.equal(allowed, false);
    });

    it("REFUSES when ONE record of an otherwise-owned batch omits the pair", async () => {
      const { injected } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(
        TENANT_ID,
        FACULTY_USER_ID,
        [OWN, {}],
        injected
      );

      assert.equal(allowed, false);
    });

    it("REFUSES an empty batch — naming no class proves no right to one", async () => {
      const { injected, asked } = deps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(TENANT_ID, FACULTY_USER_ID, [], injected);

      // teachesAllPairs is vacuously TRUE on an empty list, so relying on it
      // here would have allowed the batch. Refused before the call instead.
      assert.equal(allowed, false);
      assert.deepEqual(asked, []);
    });
  });

  describe("refused — misconfigured account", () => {
    it("REFUSES a caller holding no FacultyMember row in this tenant", async () => {
      const { injected, asked } = deps({ facultyId: null, teaches: [[SECTION_ID, COURSE_ID]] });

      const allowed = await facultyMayMarkRecords(TENANT_ID, FACULTY_USER_ID, [OWN], injected);

      assert.equal(allowed, false);
      assert.deepEqual(asked, [], "refused before any ownership question is asked");
    });
  });
});

// ============================================================================
// Coursework confinement — facultyMaySetCoursework
//
// The rule behind POST /api/assignments and POST /api/assignments/[id]/publish.
// Both reads are injected, so all of this runs with no request context, no
// session and no database.
//
// WHAT MAKES EACH OF THESE A SECURITY PROPERTY
//   Publishing an assignment notifies the course's registered students. Until
//   this rule existed both endpoints proved only TENANT membership, which every
//   lecturer in the university satisfies for every course in it — so any of
//   them could set work on a colleague's course and announce it to that
//   colleague's cohort.
//
//   • authority comes from the authenticated subject, never from the body
//   • a named section must be TAUGHT, as the exact pair
//   • omitting the section selects the COURSE-WIDE check rather than skipping
//     the check — the trap facultyMayMarkRecords documents, closed by having no
//     unchecked branch
//   • a lecturer who teaches the course but not the section is refused for the
//     section, which is the narrower claim
// ============================================================================

import {
  facultyMaySetCoursework,
  FACULTY_COURSEWORK_REFUSALS,
  type FacultyCourseworkDeps,
} from "@/lib/services/facultyTeaching";

const OTHER_SECTION_ID = "section_2";
const OTHER_COURSE_ID = "course_2";

interface CourseworkBehaviour {
  facultyId?: string | null;
  /** The (section, course) pairs this faculty member genuinely teaches. */
  teaches?: readonly (readonly [string, string])[];
  /** The courses they teach at all, in any section. */
  courses?: readonly string[];
}

function courseworkDeps(behaviour: CourseworkBehaviour = {}) {
  const pairAsked: Array<[string, string]> = [];
  const courseAsked: string[] = [];
  const resolvedFor: string[][] = [];

  const injected: FacultyCourseworkDeps = {
    async findFacultyIdForUser(tenantId: string, userId: string) {
      resolvedFor.push([tenantId, userId]);
      return behaviour.facultyId === undefined ? FACULTY_ID : behaviour.facultyId;
    },

    async teachesPair(tenantId: string, facultyId: string, sectionId: string, courseId: string) {
      assert.equal(tenantId, TENANT_ID, "always scoped to the resolved tenant");
      assert.equal(facultyId, FACULTY_ID, "always the caller's OWN resolved faculty id");
      pairAsked.push([sectionId, courseId]);

      return (behaviour.teaches ?? []).some(
        ([sec, crs]) => sec === sectionId && crs === courseId
      );
    },

    async teachesCourse(tenantId: string, facultyId: string, courseId: string) {
      assert.equal(tenantId, TENANT_ID, "always scoped to the resolved tenant");
      assert.equal(facultyId, FACULTY_ID, "always the caller's OWN resolved faculty id");
      courseAsked.push(courseId);

      return (behaviour.courses ?? []).includes(courseId);
    },
  };

  return { injected, pairAsked, courseAsked, resolvedFor };
}

describe("facultyMaySetCoursework", () => {
  describe("permitted", () => {
    it("allows work on the exact (section, course) pair the lecturer teaches", async () => {
      const { injected, resolvedFor, courseAsked } = courseworkDeps({
        teaches: [[SECTION_ID, COURSE_ID]],
      });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        SECTION_ID,
        injected
      );

      assert.deepEqual(decision, { allowed: true, facultyId: FACULTY_ID });
      // Resolved from the authenticated subject and the resolved tenant only.
      assert.deepEqual(resolvedFor, [[TENANT_ID, FACULTY_USER_ID]]);
      // A named section is the PAIR question. The weaker course-wide check is
      // never consulted, so it cannot rescue a refusal.
      assert.deepEqual(courseAsked, []);
    });

    it("allows course-wide work when no section is named", async () => {
      const { injected, pairAsked, courseAsked } = courseworkDeps({
        courses: [COURSE_ID],
      });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        undefined,
        injected
      );

      assert.deepEqual(decision, { allowed: true, facultyId: FACULTY_ID });
      assert.deepEqual(courseAsked, [COURSE_ID]);
      // There is no section to prove a pair about, so the pair question is not
      // asked with a fabricated one.
      assert.deepEqual(pairAsked, []);
    });

    it("treats an explicit null section as course-wide, exactly as undefined", async () => {
      // The publish route reads sectionId off the stored row, where the column
      // is nullable — so null arrives here where the create route sends
      // undefined. The two must mean the same thing.
      const { injected, courseAsked } = courseworkDeps({ courses: [COURSE_ID] });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        null,
        injected
      );

      assert.deepEqual(decision, { allowed: true, facultyId: FACULTY_ID });
      assert.deepEqual(courseAsked, [COURSE_ID]);
    });

    it("returns the caller's OWN faculty id, which is what the route records", async () => {
      const { injected } = courseworkDeps({ courses: [COURSE_ID] });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        undefined,
        injected
      );

      assert.equal(decision.allowed && decision.facultyId, FACULTY_ID);
    });
  });

  describe("refused — the confinement itself", () => {
    it("REFUSES a course the lecturer does not teach at all", async () => {
      const { injected } = courseworkDeps({ courses: [COURSE_ID] });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        OTHER_COURSE_ID,
        undefined,
        injected
      );

      assert.deepEqual(decision, { allowed: false, reason: "NOT_YOUR_COURSE" });
    });

    it("REFUSES a section of a course the lecturer does not take", async () => {
      // Teaches Section 1 of the course; names Section 2. The pair is what
      // authority covers, because publication notifies THAT section.
      const { injected } = courseworkDeps({ teaches: [[SECTION_ID, COURSE_ID]] });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        OTHER_SECTION_ID,
        injected
      );

      assert.deepEqual(decision, { allowed: false, reason: "NOT_YOUR_CLASS" });
    });

    it("REFUSES a section when only the COURSE is taught — the pair is not implied", async () => {
      // Course-wide authority does not confer authority over a section that is
      // somebody else's class. The course check must not be consulted as a
      // fallback once a section has been named.
      const { injected, courseAsked } = courseworkDeps({ courses: [COURSE_ID], teaches: [] });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        SECTION_ID,
        injected
      );

      assert.deepEqual(decision, { allowed: false, reason: "NOT_YOUR_CLASS" });
      assert.deepEqual(courseAsked, [], "no fallback to the weaker question");
    });

    it("REFUSES another lecturer's course even when the caller teaches something", async () => {
      const { injected } = courseworkDeps({
        teaches: [[SECTION_ID, COURSE_ID]],
        courses: [COURSE_ID],
      });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        OTHER_COURSE_ID,
        OTHER_SECTION_ID,
        injected
      );

      assert.deepEqual(decision, { allowed: false, reason: "NOT_YOUR_CLASS" });
    });
  });

  describe("refused — the ways around the check", () => {
    it("omitting the section does NOT skip the check — it selects the course one", async () => {
      // This is the trap: if an absent section meant "nothing to verify", the
      // way to set work on any course in the tenant would be to leave the
      // section out. It is verified on its own terms instead.
      const { injected, courseAsked } = courseworkDeps({ courses: [] });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        OTHER_COURSE_ID,
        undefined,
        injected
      );

      assert.deepEqual(decision, { allowed: false, reason: "NOT_YOUR_COURSE" });
      assert.deepEqual(courseAsked, [OTHER_COURSE_ID], "the check ran, and refused");
    });

    it("takes no facultyId parameter — authority is the authenticated subject", () => {
      // A compile-time property as much as a runtime one: there is no argument
      // a caller could pass to claim another lecturer's teaching load, which is
      // why the signature has none. Assignment.createdBy is written from the
      // session for the same reason.
      assert.equal(
        facultyMaySetCoursework.length,
        4,
        "tenantId, userId, courseId, sectionId — deps carries a default, and no facultyId"
      );
    });
  });

  describe("refused — misconfigured account", () => {
    it("REFUSES a caller holding no FacultyMember row in this tenant", async () => {
      const { injected, pairAsked, courseAsked } = courseworkDeps({
        facultyId: null,
        teaches: [[SECTION_ID, COURSE_ID]],
        courses: [COURSE_ID],
      });

      const decision = await facultyMaySetCoursework(
        TENANT_ID,
        FACULTY_USER_ID,
        COURSE_ID,
        SECTION_ID,
        injected
      );

      assert.deepEqual(decision, { allowed: false, reason: "NO_FACULTY_RECORD" });
      assert.deepEqual(pairAsked, [], "refused before any ownership question is asked");
      assert.deepEqual(courseAsked, []);
    });
  });

  describe("the refusals are reportable", () => {
    it("every reason has a message, and none of them carries an id", () => {
      const reasons = ["NO_FACULTY_RECORD", "NOT_YOUR_COURSE", "NOT_YOUR_CLASS"] as const;

      for (const reason of reasons) {
        const message = FACULTY_COURSEWORK_REFUSALS[reason];
        assert.ok(message.length > 0, `${reason} must have a message`);
        // The caller chose one course from their own screen, so naming the rule
        // that stopped them discloses nothing — but the message must not go
        // further and carry a record identifier.
        assert.ok(!/[A-Za-z]+_[0-9]/.test(message), `${reason} must not carry an id`);
      }
    });
  });
});

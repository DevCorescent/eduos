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

// ============================================================================
// TESTS: Class scheduling — conflict detection and time rules.
//
// WHAT IS EXERCISED DIRECTLY
//   `overlaps` and `describeSlot` are pure and are called for real. So is every
//   schema in lib/validations/timetable.ts.
//
//   `findScheduleConflicts` and `resolveReferences` reach the database and this
//   suite has none — see package.json, which runs node --test over lib/**
//   with no DB and no DOM — so the guarantees that need rows are pinned as
//   source contracts, in the way this project already pins them elsewhere
//   (lib/validations/courseListing.validation.test.ts and its siblings), and the
//   behaviours that need real data are covered by live verification against the
//   running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeSlot, overlaps } from "./timetableScheduling";
import {
  createTimetableSchema,
  isBefore,
  timetableQuerySchema,
  updateTimetableSchema,
} from "@/lib/validations/timetable";

const scheduling = readFileSync(
  join(process.cwd(), "lib/services/timetableScheduling.ts"),
  "utf8"
);
const collectionRoute = readFileSync(
  join(process.cwd(), "app/api/timetables/route.ts"),
  "utf8"
);
const detailRoute = readFileSync(
  join(process.cwd(), "app/api/timetables/[id]/route.ts"),
  "utf8"
);
const teaching = readFileSync(join(process.cwd(), "lib/services/facultyTeaching.ts"), "utf8");

/**
 * One handler's body, so an ordering assertion cannot be satisfied by the
 * import block at the top of the file.
 *
 * `resolveReferences` and `facultyMayScheduleClass` are both imported before
 * either is called, and in the opposite order to the one the flow requires — so
 * indexOf over the whole file answers a question about the imports rather than
 * about the code.
 */
function handlerBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);

  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const postHandler = handlerBody(collectionRoute, "POST");
const patchHandler = handlerBody(detailRoute, "PATCH");

// ============================================================================
// Time overlap — the rule every conflict check is built on.
// ============================================================================

describe("overlaps — half-open ranges", () => {
  it("detects a plain overlap", () => {
    assert.equal(overlaps("09:00", "10:00", "09:30", "10:30"), true);
    assert.equal(overlaps("09:30", "10:30", "09:00", "10:00"), true);
  });

  it("detects containment, in both directions", () => {
    assert.equal(overlaps("09:00", "12:00", "10:00", "11:00"), true);
    assert.equal(overlaps("10:00", "11:00", "09:00", "12:00"), true);
  });

  it("detects an identical period", () => {
    assert.equal(overlaps("09:00", "10:00", "09:00", "10:00"), true);
  });

  it("ALLOWS back-to-back classes", () => {
    // The half-open reading, and the only one that makes a period grid
    // schedulable: a class ending at 10:00 does not clash with one starting at
    // 10:00. If this ever flips, every consecutive period in the product
    // becomes unschedulable.
    assert.equal(overlaps("09:00", "10:00", "10:00", "11:00"), false);
    assert.equal(overlaps("10:00", "11:00", "09:00", "10:00"), false);
  });

  it("allows periods that do not touch", () => {
    assert.equal(overlaps("09:00", "10:00", "14:00", "15:00"), false);
  });

  it("compares across the whole 24-hour range, not just morning", () => {
    // Zero-padded HH:mm is what makes string comparison equal clock comparison.
    // "9:00" would sort after "10:00" and break this; the schema is what
    // guarantees the padding.
    assert.equal(overlaps("09:00", "10:00", "09:30", "23:59"), true);
    assert.equal(overlaps("00:00", "00:30", "23:00", "23:59"), false);
  });
});

describe("isBefore — one definition of 'earlier'", () => {
  it("agrees with clock order for zero-padded times", () => {
    assert.equal(isBefore("09:00", "10:00"), true);
    assert.equal(isBefore("10:00", "09:00"), false);
    assert.equal(isBefore("09:00", "09:00"), false);
    assert.equal(isBefore("09:59", "10:00"), true);
  });

  it("is the function overlaps is built from, not a second copy", () => {
    assert.match(scheduling, /import \{ isBefore \} from "@\/lib\/validations\/timetable"/);
    assert.match(scheduling, /return isBefore\(startA, endB\) && isBefore\(startB, endA\)/);
  });
});

// ============================================================================
// VALIDATION — what the API accepts before any row is read.
// ============================================================================

/** A complete, valid body, so each test varies exactly one thing. */
const VALID = {
  semesterId: "sem_1",
  sectionId: "sec_1",
  courseId: "crs_1",
  facultyId: "fac_1",
  day: "MONDAY",
  startTime: "09:00",
  endTime: "10:00",
} as const;

describe("createTimetableSchema — required fields", () => {
  it("accepts a complete body", () => {
    assert.equal(createTimetableSchema.safeParse(VALID).success, true);
  });

  for (const field of [
    "semesterId",
    "sectionId",
    "courseId",
    "facultyId",
    "day",
    "startTime",
    "endTime",
  ] as const) {
    it(`REFUSES a body missing ${field}`, () => {
      const body: Record<string, unknown> = { ...VALID };
      delete body[field];
      assert.equal(createTimetableSchema.safeParse(body).success, false);
    });
  }

  it("REFUSES an empty reference id", () => {
    assert.equal(
      createTimetableSchema.safeParse({ ...VALID, sectionId: "" }).success,
      false
    );
    assert.equal(
      createTimetableSchema.safeParse({ ...VALID, sectionId: "   " }).success,
      false
    );
  });

  it("leaves roomNo, sessionType and isActive optional", () => {
    const parsed = createTimetableSchema.safeParse(VALID);
    assert.ok(parsed.success);
    assert.equal(parsed.data.roomNo, undefined);
    assert.equal(parsed.data.sessionType, undefined);
  });

  it("STRIPS tenantId from a body that supplies one", () => {
    // The whole reason a client cannot schedule into another tenant: the column
    // is not in the schema, so it is dropped rather than rejected, and the route
    // writes the tenant it resolved from the session.
    const parsed = createTimetableSchema.safeParse({ ...VALID, tenantId: "other_tenant" });
    assert.ok(parsed.success);
    assert.ok(!("tenantId" in parsed.data));
  });
});

describe("createTimetableSchema — the time range", () => {
  it("REFUSES an inverted range", () => {
    assert.equal(
      createTimetableSchema.safeParse({ ...VALID, startTime: "10:00", endTime: "09:00" })
        .success,
      false
    );
  });

  it("REFUSES a zero-length range", () => {
    assert.equal(
      createTimetableSchema.safeParse({ ...VALID, startTime: "09:00", endTime: "09:00" })
        .success,
      false
    );
  });

  it("REFUSES a time that is not zero-padded 24-hour HH:mm", () => {
    for (const bad of ["9:00", "09:00:00", "9 AM", "24:00", "23:60", "0900", ""]) {
      assert.equal(
        createTimetableSchema.safeParse({ ...VALID, startTime: bad }).success,
        false,
        `startTime "${bad}" must be refused`
      );
    }
  });

  it("accepts the edges of the day", () => {
    assert.equal(
      createTimetableSchema.safeParse({ ...VALID, startTime: "00:00", endTime: "23:59" })
        .success,
      true
    );
  });

  it("REFUSES a day that is not a DayOfWeek", () => {
    assert.equal(createTimetableSchema.safeParse({ ...VALID, day: "FUNDAY" }).success, false);
  });

  it("REFUSES a session type that is not a SessionType", () => {
    assert.equal(
      createTimetableSchema.safeParse({ ...VALID, sessionType: "NAP" }).success,
      false
    );
  });
});

describe("updateTimetableSchema", () => {
  it("accepts a single field", () => {
    assert.equal(updateTimetableSchema.safeParse({ roomNo: "LH-202" }).success, true);
    assert.equal(updateTimetableSchema.safeParse({ isActive: false }).success, true);
  });

  it("REFUSES an empty body", () => {
    // A no-op edit would re-run every conflict check and re-notify a whole
    // section about a change that did not happen.
    assert.equal(updateTimetableSchema.safeParse({}).success, false);
  });

  it("checks the range only when BOTH times arrive", () => {
    assert.equal(
      updateTimetableSchema.safeParse({ startTime: "10:00", endTime: "09:00" }).success,
      false
    );
    // Legal on its own — the route checks it against the STORED end time,
    // because that value is only known there.
    assert.equal(updateTimetableSchema.safeParse({ startTime: "10:00" }).success, true);
    assert.equal(updateTimetableSchema.safeParse({ endTime: "09:00" }).success, true);
  });

  it("allows roomNo to be cleared with null", () => {
    assert.equal(updateTimetableSchema.safeParse({ roomNo: null }).success, true);
  });

  it("still refuses a malformed time", () => {
    assert.equal(updateTimetableSchema.safeParse({ startTime: "9:00" }).success, false);
  });

  it("STRIPS tenantId here too", () => {
    const parsed = updateTimetableSchema.safeParse({ roomNo: "X", tenantId: "other" });
    assert.ok(parsed.success);
    assert.ok(!("tenantId" in parsed.data));
  });
});

describe("timetableQuerySchema — the filters the screen sends", () => {
  it("accepts every filter", () => {
    const parsed = timetableQuerySchema.safeParse({
      semesterId: "sem_1",
      sectionId: "sec_1",
      courseId: "crs_1",
      facultyId: "fac_1",
      day: "MONDAY",
      sessionType: "LAB",
    });

    assert.ok(parsed.success);
    assert.equal(parsed.data.sectionId, "sec_1");
    assert.equal(parsed.data.day, "MONDAY");
    assert.equal(parsed.data.sessionType, "LAB");
  });

  it('treats "" as no filter, which is what every reset writes', () => {
    const parsed = timetableQuerySchema.safeParse({
      semesterId: "",
      sectionId: "",
      courseId: "",
      facultyId: "",
      day: "",
      sessionType: "",
    });

    assert.ok(parsed.success, "an empty filter must not be a 400");
    assert.equal(parsed.data.sectionId, undefined);
    assert.equal(parsed.data.day, undefined);
    assert.equal(parsed.data.sessionType, undefined);
  });

  it("REFUSES a day that is not a DayOfWeek", () => {
    assert.equal(timetableQuerySchema.safeParse({ day: "NOTADAY" }).success, false);
  });

  it("keeps the shared pagination contract", () => {
    const parsed = timetableQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(typeof parsed.data.page, "number");
    assert.equal(typeof parsed.data.limit, "number");
  });

  it("accepts NO tenantId — the tenant is never a query parameter", () => {
    const parsed = timetableQuerySchema.safeParse({ tenantId: "other_tenant" });
    assert.ok(parsed.success);
    assert.ok(!("tenantId" in parsed.data));
  });
});

// ============================================================================
// describeSlot — the one sentence every notification is built from.
// ============================================================================

describe("describeSlot", () => {
  const LABELS = {
    courseCode: "CS101",
    courseName: "Introduction to Programming",
    facultyName: "Asha Rao",
    sectionName: "A",
  };

  it("names the course, section, period, room and lecturer", () => {
    const text = describeSlot(
      {
        day: "MONDAY",
        startTime: "09:00",
        endTime: "10:00",
        roomNo: "LH-101",
        sessionType: "LECTURE",
      },
      LABELS
    );

    assert.match(text, /CS101/);
    assert.match(text, /Introduction to Programming/);
    assert.match(text, /Section A/);
    assert.match(text, /09:00–10:00 on Monday/);
    assert.match(text, /Room LH-101/);
    assert.match(text, /Asha Rao/);
  });

  it("omits the room when there is none", () => {
    const text = describeSlot(
      { day: "FRIDAY", startTime: "14:00", endTime: "15:00", roomNo: null },
      LABELS
    );

    assert.ok(!/Room/.test(text));
  });

  it("names a non-lecture session type and stays quiet about a lecture", () => {
    const lab = describeSlot(
      { day: "TUESDAY", startTime: "11:00", endTime: "13:00", sessionType: "LAB" },
      LABELS
    );
    const lecture = describeSlot(
      { day: "TUESDAY", startTime: "11:00", endTime: "13:00", sessionType: "LECTURE" },
      LABELS
    );

    assert.match(lab, /LAB/);
    assert.ok(!/LECTURE/.test(lecture));
  });

  it("carries no id — a notification names a class, not a cuid", () => {
    // The defect this replaced: the original POST handler interpolated
    // `timetable.courseId` and `timetable.sectionId` into the student's message.
    const text = describeSlot(
      { day: "MONDAY", startTime: "09:00", endTime: "10:00" },
      LABELS
    );

    assert.ok(!/[a-z0-9]{20,}/.test(text), "no cuid may appear in a notification body");
  });
});

// ============================================================================
// CONFLICT DETECTION — the contract the route depends on.
// ============================================================================

describe("findScheduleConflicts — the query it issues", () => {
  it("is scoped to the tenant and the day", () => {
    assert.match(scheduling, /where: \{\s*tenantId,\s*day: slot\.day,/);
  });

  it("considers only ACTIVE slots", () => {
    // A cancelled slot still holding its room would make the period
    // permanently unusable.
    assert.match(scheduling, /isActive: true,/);
  });

  it("narrows to rows that share a faculty member, a section or a room", () => {
    assert.match(scheduling, /\{ facultyId: slot\.facultyId \}/);
    assert.match(scheduling, /\{ sectionId: slot\.sectionId \}/);
    assert.match(scheduling, /roomNo \? \[\{ roomNo \}\] : \[\]/);
  });

  it("excludes the row being edited from its own scan", () => {
    // Without this a slot always collides with itself and nothing could ever
    // be rescheduled.
    assert.match(scheduling, /excludeSlotId \? \{ id: \{ not: excludeSlotId \} \} : \{\}/);
  });

  it("reports all four kinds", () => {
    for (const kind of ["DUPLICATE", "FACULTY", "SECTION", "ROOM"]) {
      assert.match(scheduling, new RegExp(`kind: "${kind}"`), `must report ${kind}`);
    }
  });

  it("compares EVERY scheduling column for a duplicate", () => {
    // Semester and course are read by no overlap rule, so if the duplicate
    // check skipped them, two different courses taught to one section at one
    // time would be reported as "already on the timetable" rather than as the
    // section clash it is.
    for (const column of [
      "semesterId",
      "sectionId",
      "courseId",
      "facultyId",
      "day",
      "startTime",
      "endTime",
      "roomNo",
      "sessionType",
    ]) {
      assert.match(
        scheduling,
        new RegExp(`candidate\\.${column} ===|\\(candidate\\.${column} \\?\\? null\\) ===`),
        `the duplicate check must compare ${column}`
      );
    }
  });

  it("selects the three columns only the duplicate check needs", () => {
    const select = scheduling.slice(
      scheduling.indexOf("const candidates = await prisma.timetable.findMany"),
      scheduling.indexOf("const sessionType = slot.sessionType")
    );

    for (const column of ["semesterId", "courseId", "sessionType"]) {
      assert.match(select, new RegExp(`${column}: true`), `${column} must be projected`);
    }
  });

  it("defaults the proposed session type the way the column does", () => {
    // A body omitting sessionType creates a LECTURE. Comparing `undefined`
    // against the stored "LECTURE" would make an identical re-submission look
    // like a different class and slip past the duplicate check into three
    // overlap errors.
    assert.match(scheduling, /const sessionType = slot\.sessionType \?\? "LECTURE";/);
    assert.match(scheduling, /candidate\.sessionType === sessionType/);
  });

  it("returns the duplicate ALONE, before the overlap scan runs", () => {
    // Reported alongside the other three it would describe the very slot being
    // scheduled back at the caller as three separate booking problems.
    const duplicateReturn = scheduling.indexOf('kind: "DUPLICATE"');
    const conflictsArray = scheduling.indexOf("const conflicts: ScheduleConflict[] = []");

    assert.ok(duplicateReturn > 0 && conflictsArray > 0);
    assert.ok(
      duplicateReturn < conflictsArray,
      "the duplicate must short-circuit before any overlap is accumulated"
    );
    assert.match(scheduling, /if \(duplicate\) \{\s*return \[/);
  });

  it("books no room when no room is named", () => {
    assert.match(scheduling, /const roomNo = slot\.roomNo\?\.trim\(\) \? slot\.roomNo\.trim\(\) : null;/);
    assert.match(scheduling, /if \(roomNo && candidate\.roomNo === roomNo\)/);
  });

  it("never reads a client-supplied tenant", () => {
    assert.ok(
      !/tenantId: (input|body|parsed|query)/.test(scheduling),
      "the tenant must come from the caller's session, never the request"
    );
  });
});

describe("resolveReferences — tenant ownership of all four ids", () => {
  it("scopes every one of the four lookups to the tenant", () => {
    for (const model of ["semester", "section", "course", "facultyMember"]) {
      assert.match(
        scheduling,
        new RegExp(`prisma\\.${model}\\.findFirst\\(\\{\\s*where: \\{ id: ids\\.\\w+, tenantId \\}`),
        `${model} must be looked up within the tenant`
      );
    }
  });

  it("reports the four misses in a fixed precedence", () => {
    const order = ["semester", "section", "course", "faculty"].map((name) =>
      scheduling.indexOf(`missing: "${name}"`)
    );

    assert.ok(
      order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])),
      "precedence must follow the schema's column order"
    );
  });

  it("returns the labels the notification needs", () => {
    for (const label of ["courseCode", "courseName", "facultyName", "sectionName"]) {
      assert.match(scheduling, new RegExp(label), `references must carry ${label}`);
    }
  });
});

// ============================================================================
// AUTHORIZATION — who may write a slot.
// ============================================================================

describe("POST /api/timetables — authorization", () => {
  it("is guarded by requireFacultyTimetableAccess, not requireRole alone", () => {
    assert.match(collectionRoute, /await requireFacultyTimetableAccess\(\)/);
  });

  it("applies the faculty confinement ONLY to a non-elevated caller", () => {
    // An administrator holds no FacultyMember row, so running them through the
    // ownership test would refuse them for a record they were never meant to
    // have.
    assert.match(collectionRoute, /if \(scope === "OWN"\)/);
    assert.match(collectionRoute, /facultyMayScheduleClass\(/);
  });

  it("writes the facultyId from the DECISION, never from the body", () => {
    assert.match(collectionRoute, /facultyId = decision\.facultyId;/);
    assert.match(collectionRoute, /data: \{ \.\.\.input, facultyId, tenantId \}/);
  });

  it("checks references BEFORE ownership, so a foreign id is a 404 not a 403", () => {
    assert.ok(
      postHandler.indexOf("resolveReferences") <
        postHandler.indexOf("facultyMayScheduleClass"),
      "a cross-tenant id must not be confirmed to exist by a 403"
    );
  });

  it("checks ownership BEFORE scanning for conflicts", () => {
    assert.ok(
      postHandler.indexOf("facultyMayScheduleClass") <
        postHandler.indexOf("findScheduleConflicts"),
      "a lecturer must not learn a colleague's free periods by probing"
    );
  });

  it("answers a conflict with 409 and the composed message", () => {
    assert.match(postHandler, /conflicts\.map\(\(conflict\) => conflict\.message\)\.join\(" "\)/);
    assert.match(postHandler, /"CONFLICT"\),\s*\{ status: 409 \}/);
  });

  it("takes the tenant from the guard and never from the body", () => {
    assert.ok(
      !/tenantId: (input|body)\./.test(collectionRoute),
      "the tenant must come from the guard"
    );
  });
});

describe("GET /api/timetables — the institution-wide read", () => {
  it("stays UNIVERSITY_ADMIN", () => {
    // Widening it would hand FACULTY the whole tenant's schedule through a
    // query string, which is exactly the scope the authorization model denies.
    assert.match(collectionRoute, /export async function GET[\s\S]{0,400}requireRole\("UNIVERSITY_ADMIN"\)/);
  });

  it("parses the filter schema, not bare pagination", () => {
    assert.match(collectionRoute, /timetableQuerySchema\.safeParse/);
    assert.ok(
      !/paginationQuerySchema\.safeParse/.test(collectionRoute),
      "the filters were dropped by parsing pagination alone — that is the defect"
    );
  });

  it("leads the where clause with the tenant and ANDs every filter onto it", () => {
    assert.match(
      collectionRoute,
      /const where: Prisma\.TimetableWhereInput = \{\s*tenantId: tenant\.id,/
    );
    for (const filter of ["semesterId", "sectionId", "courseId", "facultyId", "day", "sessionType"]) {
      assert.match(
        collectionRoute,
        new RegExp(`\\.\\.\\.\\(${filter} \\? \\{ ${filter} \\} : \\{\\}\\)`),
        `${filter} must be applied`
      );
    }
  });

  it("uses ONE where for both the page and the count", () => {
    assert.match(collectionRoute, /prisma\.timetable\.findMany\(\{\s*where,/);
    assert.match(collectionRoute, /prisma\.timetable\.count\(\{ where \}\)/);
  });
});

describe("PATCH /api/timetables/[id] — reschedule and cancel", () => {
  it("exists", () => {
    assert.match(detailRoute, /export async function PATCH\(/);
  });

  it("proves tenant ownership of the row before anything else", () => {
    assert.match(detailRoute, /where: \{ id: timetableId, tenantId \}/);
  });

  it("re-runs EVERY check against the MERGED slot, not the stored one", () => {
    assert.match(detailRoute, /const merged = \{/);
    assert.match(detailRoute, /resolveReferences\(tenantId, merged\)/);
    assert.match(detailRoute, /sectionId: merged\.sectionId, courseId: merged\.courseId/);
    assert.match(detailRoute, /findScheduleConflicts\(\s*tenantId,\s*\{ \.\.\.merged, facultyId \},\s*timetableId\s*\)/);
  });

  it("checks the merged time range, which the schema alone cannot", () => {
    assert.match(detailRoute, /if \(!isBefore\(merged\.startTime, merged\.endTime\)\)/);
  });

  it("skips the conflict scan when the class is being cancelled", () => {
    assert.match(detailRoute, /if \(merged\.isActive\) \{[\s\S]{0,400}findScheduleConflicts/);
  });

  it("scopes the write by tenantId as well as id", () => {
    assert.match(detailRoute, /prisma\.timetable\.update\(\{\s*where: \{ id: timetableId, tenantId \}/);
  });

  it("emits exactly one notification per transition", () => {
    assert.match(detailRoute, /if \(existing\.isActive && !updated\.isActive\)/);
    assert.match(detailRoute, /else if \(!existing\.isActive && updated\.isActive\)/);
    assert.match(detailRoute, /else if \(previousDescription !== notice\.description\)/);
  });

  it("does NOT hard-delete on cancel", () => {
    // The cancel path is a PATCH setting isActive false. DELETE still exists as
    // a separate administrative action and is untouched — but nothing in the
    // scheduling flow reaches it.
    assert.match(detailRoute, /export async function DELETE\(/);
    assert.ok(
      !/prisma\.timetable\.delete/.test(patchHandler),
      "cancelling must never destroy the row — Attendance references it"
    );
    assert.match(patchHandler, /prisma\.timetable\.update\(/);
  });
});

describe("facultyMayScheduleClass — the ownership rule", () => {
  it("resolves the faculty id from the SUBJECT, never from the body", () => {
    assert.match(teaching, /const facultyId = await deps\.findFacultyIdForUser\(tenantId, userId\)/);
  });

  it("refuses an account with no faculty record", () => {
    assert.match(teaching, /if \(facultyId === null\) return \{ allowed: false, reason: "NO_FACULTY_RECORD" \}/);
  });

  it("refuses a body naming another faculty member", () => {
    assert.match(
      teaching,
      /requestedFacultyId !== undefined && requestedFacultyId !== facultyId/
    );
    assert.match(teaching, /reason: "OTHER_FACULTY"/);
  });

  it("refuses a pair the lecturer does not teach", () => {
    assert.match(teaching, /deps\.teachesPair\(tenantId, facultyId, pair\.sectionId, pair\.courseId\)/);
    assert.match(teaching, /reason: "NOT_YOUR_CLASS"/);
  });

  it("returns the caller's OWN id on success", () => {
    assert.match(teaching, /return \{ allowed: true, facultyId \}/);
  });

  it("consults teachesPair rather than a second ownership implementation", () => {
    // The whole reason lib/services/facultyTeaching.ts exists: the rule that
    // decides who may WRITE a slot must be the rule that decides who may read
    // one. A private copy here would drift from the roster and attendance
    // paths.
    assert.equal(
      (teaching.match(/export async function teachesPair/g) ?? []).length,
      1,
      "teachesPair must be defined exactly once"
    );
  });

  it("carries a distinct message for each refusal", () => {
    const messages = new Set(
      [...teaching.matchAll(/^\s{2}(NO_FACULTY_RECORD|NOT_YOUR_CLASS|OTHER_FACULTY): "(.+)",$/gm)].map(
        (match) => match[2]
      )
    );

    assert.equal(messages.size, 3, "each refusal needs its own message");
  });
});

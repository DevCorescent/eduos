// ============================================================================
// TESTS: Class scheduling notifications, and who can see a scheduled class.
//
// WHAT IS EXERCISED DIRECTLY
//   NotificationEmitterService is constructed against a recording writer port,
//   so the three class-scheduling events are called for real and the rows they
//   would write are inspected. That is the same technique
//   notificationEmitter.service.test.ts already uses, and it is what makes
//   "students outside the section receive nothing" a statement about behaviour
//   rather than about source text.
//
//   The recipient RESOLUTION reaches the database — findStudentUserIdsForSection
//   and its two siblings are Prisma queries — and this suite has none, so the
//   audience rule is pinned as a source contract and proven end to end by live
//   verification against the running API.
// ============================================================================

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NotificationEmitterService,
  type EmitInput,
} from "@/lib/services/notificationEmitter.service";

const controller = readFileSync(
  join(process.cwd(), "lib/controllers/classScheduling.controller.ts"),
  "utf8"
);
const emitterController = readFileSync(
  join(process.cwd(), "lib/controllers/notificationEmitter.controller.ts"),
  "utf8"
);
const studentRoute = readFileSync(
  join(process.cwd(), "app/api/student/timetable/route.ts"),
  "utf8"
);
const facultyRoute = readFileSync(
  join(process.cwd(), "app/api/timetables/faculty/[facultyId]/route.ts"),
  "utf8"
);
const teachingRoute = readFileSync(
  join(process.cwd(), "app/api/faculty/me/teaching/route.ts"),
  "utf8"
);

/** Records what would be written, so the rows can be asserted on. */
class RecordingWriter {
  written: EmitInput[] = [];
  async createMany(rows: readonly EmitInput[]): Promise<void> {
    this.written.push(...rows);
  }
}

const TENANT = "tenant_1";
const IN_SECTION = ["user_student_a", "user_student_b"];
const LECTURER = "user_faculty_1";

const NOTICE = {
  tenantId: TENANT,
  slotId: "slot_1",
  courseLabel: "CS101 — Introduction to Programming",
  description:
    "CS101 — Introduction to Programming · Section A · 09:00–10:00 on Monday · Room LH-101 · Asha Rao",
};

describe("classScheduled", () => {
  let writer: RecordingWriter;
  let emitter: NotificationEmitterService;

  beforeEach(() => {
    writer = new RecordingWriter();
    emitter = new NotificationEmitterService(writer);
  });

  it("writes one notification per recipient", async () => {
    await emitter.classScheduled({
      ...NOTICE,
      recipientUserIds: [...IN_SECTION, LECTURER],
    });

    assert.equal(writer.written.length, 3);
    assert.deepEqual(
      writer.written.map((row) => row.userId).sort(),
      [...IN_SECTION, LECTURER].sort()
    );
  });

  it("writes NOTHING for a student outside the section", async () => {
    // The audience is decided by the caller; this is the half that must not
    // invent recipients of its own. A row addressed to someone not in the list
    // would be a class appearing in a stranger's bell.
    await emitter.classScheduled({ ...NOTICE, recipientUserIds: IN_SECTION });

    assert.ok(
      !writer.written.some((row) => row.userId === "user_student_elsewhere"),
      "no recipient may be invented"
    );
    assert.equal(writer.written.length, IN_SECTION.length);
  });

  it("is a no-op for an empty audience rather than an error", async () => {
    // A section with no students admitted yet is ordinary at the start of a
    // term, and refusing to schedule a class over it would be absurd.
    await emitter.classScheduled({ ...NOTICE, recipientUserIds: [] });
    assert.equal(writer.written.length, 0);
  });

  it("files under the TIMETABLE category", async () => {
    await emitter.classScheduled({ ...NOTICE, recipientUserIds: IN_SECTION });
    assert.ok(writer.written.every((row) => row.category === "TIMETABLE"));
  });

  it("names the course, day, period and room in the body", async () => {
    await emitter.classScheduled({ ...NOTICE, recipientUserIds: IN_SECTION });

    const [row] = writer.written;
    assert.match(row.subject, /Class scheduled/);
    assert.match(row.subject, /CS101/);
    assert.match(row.body, /09:00–10:00 on Monday/);
    assert.match(row.body, /Room LH-101/);
    assert.match(row.body, /Section A/);
    assert.match(row.body, /Asha Rao/);
  });

  it("carries the slot id and the event in data", async () => {
    await emitter.classScheduled({ ...NOTICE, recipientUserIds: IN_SECTION });
    assert.deepEqual(writer.written[0].data, { slotId: "slot_1", event: "SCHEDULED" });
  });
});

describe("classRescheduled", () => {
  it("names BOTH the old period and the new one", async () => {
    const writer = new RecordingWriter();
    const emitter = new NotificationEmitterService(writer);

    await emitter.classRescheduled({
      ...NOTICE,
      recipientUserIds: IN_SECTION,
      previousDescription:
        "CS101 — Introduction to Programming · Section A · 09:00–10:00 on Monday",
      description:
        "CS101 — Introduction to Programming · Section A · 14:00–15:00 on Thursday",
    });

    const [row] = writer.written;
    // Without the old period the message is unactionable for a student who has
    // already written the old time down.
    assert.match(row.body, /09:00–10:00 on Monday/);
    assert.match(row.body, /14:00–15:00 on Thursday/);
    assert.match(row.subject, /Class rescheduled/);
    assert.equal((row.data as { event: string }).event, "RESCHEDULED");
  });
});

describe("classCancelled", () => {
  it("tells the recipient the class is off, and which one", async () => {
    const writer = new RecordingWriter();
    const emitter = new NotificationEmitterService(writer);

    await emitter.classCancelled({ ...NOTICE, recipientUserIds: IN_SECTION });

    const [row] = writer.written;
    assert.match(row.subject, /Class cancelled/);
    assert.match(row.body, /removed from your timetable/);
    assert.match(row.body, /09:00–10:00 on Monday/);
    assert.equal((row.data as { event: string }).event, "CANCELLED");
    assert.equal(writer.written.length, IN_SECTION.length);
  });
});

describe("emission never breaks the write it describes", () => {
  it("swallows a writer failure", async () => {
    const emitter = new NotificationEmitterService({
      async createMany() {
        throw new Error("database is down");
      },
    });

    // If this threw, a timetable change that already committed would be
    // reported to its caller as a 500 — and on a create that means the class is
    // scheduled and the user is told it failed.
    await emitter.classScheduled({ ...NOTICE, recipientUserIds: IN_SECTION });
  });

  it("wraps recipient RESOLUTION in notifyAfterCommit too, not just the emit", () => {
    // The lookups are bare Prisma queries. A pool timeout there throws OUTSIDE
    // the emitter's own try/catch, so the whole block has to be inside
    // notifyAfterCommit or the swallow is a fiction at the call site.
    for (const fn of [
      "notifyClassScheduled",
      "notifyClassRescheduled",
      "notifyClassCancelled",
    ]) {
      const start = controller.indexOf(`export async function ${fn}`);
      assert.ok(start > 0, `${fn} must exist`);

      const body = controller.slice(start, controller.indexOf("\n}", start));
      assert.match(body, /await notifyAfterCommit\(scope, async \(\) => \{/);
      assert.match(body, /await audienceFor\(notice\)/);
    }
  });
});

describe("the audience — who hears about a scheduled class", () => {
  it("unions the course registrations with the section roster", () => {
    // Neither is complete alone: registrations are empty before registration
    // opens, which is exactly when a timetable is published, and the section
    // roster misses a student registered through a section since changed.
    assert.match(controller, /findStudentUserIdsForCourse\(notice\.tenantId, notice\.courseId, notice\.sectionId\)/);
    assert.match(controller, /findStudentUserIdsForSection\(notice\.tenantId, notice\.sectionId\)/);
  });

  it("adds the teaching faculty and the slot's own lecturer", () => {
    assert.match(controller, /findFacultyUserIdsForUnit\(notice\.tenantId, notice\.courseId, notice\.sectionId\)/);
    assert.match(controller, /notice\.facultyUserId \? \[notice\.facultyUserId\] : \[\]/);
  });

  it("deduplicates, so one person is notified once", () => {
    assert.match(controller, /\.\.\.new Set\(\[/);
  });

  it("BOTH student lookups are narrowed to the section", () => {
    // This is what makes "a student outside the section is not notified" true.
    // A course-wide registration lookup would reach every section taking the
    // course.
    assert.match(
      emitterController,
      /where: \{ tenantId, sectionId, status: "ACTIVE" \}/,
      "the section roster must filter on sectionId"
    );
    assert.match(
      emitterController,
      /\.\.\.\(sectionId \? \{ sectionId \} : \{\}\)/,
      "the registration lookup must narrow by section when one is given"
    );
  });

  it("excludes students who have left", () => {
    assert.match(emitterController, /status: "ACTIVE"/);
  });

  it("bounds the recipient list", () => {
    assert.match(emitterController, /take: MAX_RECIPIENTS/);
  });
});

// ============================================================================
// VISIBILITY — which timetable each role can read.
// ============================================================================

describe("GET /api/student/timetable", () => {
  it("resolves the student from the SESSION, never from a parameter", () => {
    assert.match(studentRoute, /where: \{ userId, tenantId \}/);
    assert.ok(
      !/studentId/.test(studentRoute.replace(/^\/\/.*$/gm, "")),
      "no studentId may be accepted anywhere in this route"
    );
  });

  it("returns only the caller's own section", () => {
    assert.match(
      studentRoute,
      /where: \{ tenantId, sectionId: student\.sectionId, isActive: true \}/
    );
  });

  it("HIDES cancelled classes", () => {
    // A cancelled class on a personal timetable is an instruction to attend
    // something that is not happening.
    assert.match(studentRoute, /isActive: true/);
  });

  it("answers an empty list for a student with no section", () => {
    // Not the whole university's timetable, and not a 404.
    assert.match(studentRoute, /if \(!student\?\.sectionId\) \{[\s\S]{0,120}timetables: \[\] \}/);
  });

  it("is guarded, and by the student-self guard rather than an open role check", () => {
    assert.match(studentRoute, /await requireStudentProfileAccess\(\)/);
  });

  it("exposes no mutation — a student cannot write a timetable", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.ok(
        !new RegExp(`export async function ${method}\\(`).test(studentRoute),
        `${method} must not exist on the student timetable route`
      );
    }
  });
});

describe("GET /api/timetables/faculty/[facultyId]", () => {
  it("confines a faculty caller to their own record", () => {
    assert.match(facultyRoute, /if \(scope === "OWN" && faculty\.userId !== userId\)/);
    assert.match(facultyRoute, /"Forbidden", "FORBIDDEN"/);
  });

  it("proves tenant ownership before the confinement check", () => {
    // So a cross-tenant id answers 404 rather than a 403 that would confirm the
    // record exists somewhere.
    assert.ok(
      facultyRoute.indexOf("Faculty member not found") <
        facultyRoute.indexOf('scope === "OWN"'),
      "an unknown or foreign id must 404 before any 403 is reachable"
    );
  });
});

describe("GET /api/faculty/me/teaching", () => {
  it("takes no facultyId of any kind", () => {
    assert.match(teachingRoute, /findFacultyIdForUser\(tenantId, guard\.session\.sub\)/);
    assert.ok(
      !/params/.test(teachingRoute),
      "a route with no dynamic segment must read none"
    );
  });

  it("mirrors teachesPair — assignments OR existing slots", () => {
    // If it offered only assignments, a lecturer with a timetabled class and no
    // assignment row would be shown an empty form for classes the API accepts.
    assert.match(teachingRoute, /prisma\.facultyCourseAssignment\.findMany/);
    assert.match(teachingRoute, /prisma\.timetable\.findMany/);
  });

  it("skips a course-wide assignment that names no section", () => {
    // teachesPair matches sectionId exactly, including the null case, so an
    // assignment without one proves nothing about a particular section.
    assert.match(teachingRoute, /sectionId: \{ not: null \}/);
  });

  it("scopes every read to the tenant", () => {
    assert.match(teachingRoute, /where: \{ tenantId, facultyId, isActive: true/);
    assert.match(teachingRoute, /where: \{ tenantId, facultyId \}/);
    assert.match(teachingRoute, /where: \{ tenantId, id: \{ in: sectionIds \} \}/);
  });

  it("is a convenience, and says so — never the authorization", () => {
    assert.match(teachingRoute, /never the authorization/i);
  });
});

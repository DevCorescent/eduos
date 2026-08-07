// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the one property every caller depends on — that emission
//          NEVER throws — and that each event addresses the right people with
//          the right category.
//
//          A lock that succeeded but could not notify must still be a lock. If
//          this module ever propagated an error, a bell-entry failure would
//          roll back a legal academic record.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NotificationCategory } from "@/app/generated/prisma/enums";
import {
  NotificationEmitterService,
  type EmitInput,
  type NotificationWriterPort,
} from "@/lib/services/notificationEmitter.service";

const TENANT_ID = "tenant_1";

function makeHarness(options: { throws?: boolean } = {}) {
  const written: EmitInput[][] = [];

  const writer: NotificationWriterPort = {
    async createMany(rows) {
      if (options.throws) throw new Error("database unavailable");
      written.push([...rows]);
    },
  };

  return { service: new NotificationEmitterService(writer), written };
}

describe("NotificationEmitterService.emitQuietly", () => {
  it("NEVER throws when the write fails", async () => {
    // The contract every caller relies on. A propagated error here would let a
    // bell-entry failure roll back the change it was describing.
    const { service } = makeHarness({ throws: true });

    await service.emitQuietly([
      {
        tenantId: TENANT_ID,
        userId: "user_1",
        category: NotificationCategory.ATTENDANCE,
        subject: "s",
        body: "b",
      },
    ]);
  });

  it("does not call the writer for an empty list", async () => {
    const { service, written } = makeHarness();

    await service.emitQuietly([]);

    assert.equal(written.length, 0);
  });
});

describe("attendanceLockChanged", () => {
  it("addresses every assigned faculty member with the ATTENDANCE category", async () => {
    const { service, written } = makeHarness();

    await service.attendanceLockChanged({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1", "u2"],
      locked: true,
      courseLabel: "CS301",
      sectionLabel: "A",
      reason: "Semester finalised",
      lockId: "lock_1",
    });

    assert.equal(written[0].length, 2);
    assert.equal(written[0][0].category, NotificationCategory.ATTENDANCE);
    assert.match(written[0][0].subject, /locked/);
    assert.match(written[0][0].body, /Semester finalised/);
  });

  it("distinguishes an unlock from a lock in the message", async () => {
    const { service, written } = makeHarness();

    await service.attendanceLockChanged({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1"],
      locked: false,
      courseLabel: "CS301",
      sectionLabel: "A",
      reason: null,
      lockId: "lock_1",
    });

    assert.match(written[0][0].subject, /unlocked/);
    assert.match(written[0][0].body, /may be corrected/);
  });

  it("is a NO-OP when the unit has no assigned faculty", async () => {
    // A course with no faculty is unusual, not a fault. Refusing the lock over
    // it would be absurd.
    const { service, written } = makeHarness();

    await service.attendanceLockChanged({
      tenantId: TENANT_ID,
      recipientUserIds: [],
      locked: true,
      courseLabel: "CS301",
      sectionLabel: "A",
      reason: null,
      lockId: "lock_1",
    });

    assert.equal(written.length, 0);
  });
});

describe("assignmentSubmitted", () => {
  it("notifies the assignment author", async () => {
    const { service, written } = makeHarness();

    await service.assignmentSubmitted({
      tenantId: TENANT_ID,
      facultyUserId: "faculty_user",
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      isResubmission: false,
    });

    assert.equal(written[0][0].userId, "faculty_user");
    assert.equal(written[0][0].category, NotificationCategory.ASSIGNMENT);
    assert.match(written[0][0].subject, /New submission/);
  });

  it("distinguishes a resubmission", async () => {
    const { service, written } = makeHarness();

    await service.assignmentSubmitted({
      tenantId: TENANT_ID,
      facultyUserId: "faculty_user",
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      isResubmission: true,
    });

    assert.match(written[0][0].subject, /Resubmission/);
    assert.match(written[0][0].body, /preserved in its history/);
  });

  it("writes NOTHING when the author id resolves to nobody", async () => {
    // Assignment.createdBy is unconstrained (TD-C) and may name a deleted user.
    // A row addressed to a non-existent id is one no bell can ever show.
    const { service, written } = makeHarness();

    await service.assignmentSubmitted({
      tenantId: TENANT_ID,
      facultyUserId: null,
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      isResubmission: false,
    });

    assert.equal(written.length, 0);
  });
});

describe("assignmentEvaluated", () => {
  it("reports the mark against the assignment maximum", async () => {
    const { service, written } = makeHarness();

    await service.assignmentEvaluated({
      tenantId: TENANT_ID,
      studentUserId: "student_user",
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      marks: 18,
      maxMarks: 20,
    });

    assert.equal(written[0][0].userId, "student_user");
    assert.match(written[0][0].body, /18 out of 20/);
  });

  it("writes nothing when the student cannot be resolved to a user", async () => {
    const { service, written } = makeHarness();

    await service.assignmentEvaluated({
      tenantId: TENANT_ID,
      studentUserId: null,
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      marks: 18,
      maxMarks: 20,
    });

    assert.equal(written.length, 0);
  });
});

describe("examResourcePublished", () => {
  it("calls a QUESTION_PAPER a question paper", async () => {
    const { service, written } = makeHarness();

    await service.examResourcePublished({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1"],
      resourceId: "r1",
      resourceType: "QUESTION_PAPER",
      title: "Mid-semester paper",
      courseLabel: "CS301",
    });

    assert.match(written[0][0].subject, /Question paper uploaded/);
    assert.equal(written[0][0].category, NotificationCategory.ACADEMIC);
  });

  it("calls a SOLUTION, ANSWER_KEY or MARKING_SCHEME a solution", async () => {
    // The README lists "Question Paper Uploaded" and "Solution Uploaded" as
    // separate student events; one publication action raises whichever fits.
    for (const type of ["SOLUTION", "ANSWER_KEY", "MARKING_SCHEME"]) {
      const { service, written } = makeHarness();

      await service.examResourcePublished({
        tenantId: TENANT_ID,
        recipientUserIds: ["u1"],
        resourceId: "r1",
        resourceType: type,
        title: "Answers",
        courseLabel: "CS301",
      });

      assert.match(written[0][0].subject, /Solution uploaded/, `${type} was misreported`);
    }
  });

  it("addresses every registered student", async () => {
    const { service, written } = makeHarness();

    await service.examResourcePublished({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1", "u2", "u3"],
      resourceId: "r1",
      resourceType: "QUESTION_PAPER",
      title: "Mid-semester paper",
      courseLabel: "CS301",
    });

    assert.equal(written[0].length, 3);
  });
});

describe("attendanceMarked", () => {
  it("addresses each student once, with the ATTENDANCE category", async () => {
    const { service, written } = makeHarness();

    await service.attendanceMarked({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1", "u2"],
      courseLabel: "CS301",
      date: "2026-03-15",
    });

    assert.equal(written[0].length, 2);
    assert.equal(written[0][0].category, NotificationCategory.ATTENDANCE);
    assert.match(written[0][0].body, /2026-03-15/);
  });
});

describe("lowAttendanceWarning", () => {
  it("reports the student's percentage AND the threshold it was judged against", async () => {
    // Reporting only "you are below" leaves a student unable to tell how far.
    const { service, written } = makeHarness();

    await service.lowAttendanceWarning({
      tenantId: TENANT_ID,
      studentUserId: "u1",
      courseLabel: "CS301",
      percentage: 62.5,
      threshold: 75,
    });

    assert.match(written[0][0].body, /62\.5%/);
    assert.match(written[0][0].body, /75%/);
    assert.equal(written[0][0].data?.threshold, 75);
  });
});

describe("assignmentPublished", () => {
  it("names the due date when there is one", async () => {
    const { service, written } = makeHarness();

    await service.assignmentPublished({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1"],
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      dueDate: "2026-04-01",
    });

    assert.match(written[0][0].body, /due on 2026-04-01/);
  });

  it("omits the due-date sentence when the assignment has none", async () => {
    // An assignment with no deadline must not be described as having one.
    const { service, written } = makeHarness();

    await service.assignmentPublished({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1"],
      assignmentTitle: "Problem set 3",
      assignmentId: "a1",
      dueDate: null,
    });

    assert.doesNotMatch(written[0][0].body, /due on/);
  });
});

describe("feeDemandGenerated", () => {
  it("uses the FEE category and names no amount", async () => {
    // The amount belongs on the ledger, which applies the tenant's own
    // formatting; quoting it here would be a second place it could be wrong.
    const { service, written } = makeHarness();

    await service.feeDemandGenerated({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1", "u2"],
      count: 2,
    });

    assert.equal(written[0][0].category, NotificationCategory.FEE);
    assert.equal(written[0].length, 2);
  });
});

describe("certificateIssued", () => {
  it("names the certificate number", async () => {
    const { service, written } = makeHarness();

    await service.certificateIssued({
      tenantId: TENANT_ID,
      studentUserId: "u1",
      certificateType: "DEGREE",
      certificateNo: "CERT-2026-001",
      certificateId: "c1",
    });

    assert.equal(written[0][0].category, NotificationCategory.CERTIFICATE);
    assert.match(written[0][0].body, /CERT-2026-001/);
  });

  it("writes nothing when the student cannot be resolved", async () => {
    const { service, written } = makeHarness();

    await service.certificateIssued({
      tenantId: TENANT_ID,
      studentUserId: null,
      certificateType: "DEGREE",
      certificateNo: "CERT-2026-001",
      certificateId: "c1",
    });

    assert.equal(written.length, 0);
  });
});

describe("timetableUpdated", () => {
  it("uses the TIMETABLE category for students and faculty alike", async () => {
    // The README lists this event under BOTH audiences; one method serves both.
    const { service, written } = makeHarness();

    await service.timetableUpdated({
      tenantId: TENANT_ID,
      recipientUserIds: ["student_u", "faculty_u"],
      courseLabel: "CS301",
      sectionLabel: "A",
    });

    assert.equal(written[0].length, 2);
    assert.equal(written[0][0].category, NotificationCategory.TIMETABLE);
  });
});

describe("studentFeedbackReceived", () => {
  it("carries NO student identity and NO rating", async () => {
    // Phase 20's whole design is anonymity above a disclosure threshold. A bell
    // entry naming the submitter or quoting a score would defeat it in one line.
    const { service, written } = makeHarness();

    await service.studentFeedbackReceived({
      tenantId: TENANT_ID,
      facultyUserId: "faculty_u",
      courseLabel: "CS301",
    });

    const row = written[0][0];
    assert.deepEqual(row.data, {});
    assert.doesNotMatch(row.body, /\d\s*\/\s*5|rating|score/i);
    assert.match(row.body, /anonymous/i);
  });

  it("writes nothing when the faculty member cannot be resolved", async () => {
    const { service, written } = makeHarness();

    await service.studentFeedbackReceived({
      tenantId: TENANT_ID,
      facultyUserId: null,
      courseLabel: null,
    });

    assert.equal(written.length, 0);
  });
});

describe("newAdmission", () => {
  it("addresses the administrators", async () => {
    const { service, written } = makeHarness();

    await service.newAdmission({
      tenantId: TENANT_ID,
      recipientUserIds: ["admin_1", "admin_2"],
      studentName: "2026CS001",
      enrollmentNo: "2026CS001",
      studentId: "s1",
    });

    assert.equal(written[0].length, 2);
    assert.match(written[0][0].subject, /2026CS001/);
  });
});

describe("openElectiveAllocated", () => {
  it("notifies every candidate, not only those who got a seat", async () => {
    // A student who did NOT get a seat most needs to know the run happened.
    const { service, written } = makeHarness();

    await service.openElectiveAllocated({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1", "u2", "u3"],
      semesterId: "sem_1",
    });

    assert.equal(written[0].length, 3);
  });
});

describe("emergencyAnnouncement", () => {
  it("uses the EMERGENCY category", async () => {
    const { service, written } = makeHarness();

    await service.emergencyAnnouncement({
      tenantId: TENANT_ID,
      recipientUserIds: ["u1"],
      title: "Campus closed",
      announcementId: "ann_1",
    });

    assert.equal(written[0][0].category, NotificationCategory.EMERGENCY);
    assert.equal(written[0][0].subject, "Campus closed");
  });
});

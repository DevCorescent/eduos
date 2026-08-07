// ============================================================================
// OWNER      : Gauransh
// MODULE     : Notification Center & Announcement System (Phase 27)
// LAYER      : Service
// PURPOSE    : Write the in-app notifications the README's Phase 27 event lists
//              name, for the events Phases 22, 24 and 26 actually own.
//
// WHY THIS EXISTS SEPARATELY FROM NotificationCenterService
//   That service READS a user's notifications. This one WRITES them, and its
//   callers are other modules — the attendance-lock service, the assignment
//   service, the exam-resource service. Keeping the two apart means a module
//   that only emits does not acquire the ability to read anyone's bell, and the
//   read service stays free of write concerns.
//
// SCOPE: THE EVENTS PHASES 21-27 OWN, AND NO OTHERS
//   The README's Phase 27 lists twenty-nine notification events across three
//   audiences. Most belong to OTHER phases — "Fee Demand Generated" is Phase
//   11's, "Certificate Issued" is Phase 12's, "New Admission" is Phase 6's —
//   and emitting them would mean editing Phase 1-20 write paths this assignment
//   excludes. What this module covers is exactly the events raised by the
//   phases in scope:
//
//     ATTENDANCE_LOCK        Phase 22 · faculty notification
//     ATTENDANCE_UNLOCK      Phase 22 · faculty notification
//     ASSIGNMENT_SUBMISSION  Phase 24 · faculty notification
//     ASSIGNMENT_EVALUATED   Phase 24 · student notification
//     QUESTION_PAPER_UPLOADED / SOLUTION_UPLOADED
//                            Phase 26 · student notification
//     HOD_ANNOUNCEMENT       Phase 27 · faculty notification
//
//   The remaining events are recorded as out-of-scope in the final report
//   rather than silently omitted.
//
// EMISSION NEVER FAILS ITS CALLER
//   Every method swallows its own errors. A lock that succeeded but could not
//   notify must still be a lock: rolling back a legal academic record because a
//   bell entry could not be written would be the wrong trade in every case.
//   Callers therefore do not await this inside their transaction and do not
//   handle its failures — see `emitQuietly`.
//
// TYPE IS IN_APP, ALWAYS
//   Phase 13's NotificationType is a DELIVERY CHANNEL. Nothing in this project
//   transmits — POST /api/notifications/send explicitly records without sending
//   — so writing EMAIL here would claim a delivery that did not happen. IN_APP
//   is the honest channel for a row whose only consumer is the notification
//   bell this phase built.
// ============================================================================

import { NotificationCategory, NotificationType } from "@/app/generated/prisma/enums";

/** One notification to write. */
export interface EmitInput {
  readonly tenantId: string;
  /** The recipient. A row with no recipient is one no bell can ever show. */
  readonly userId: string;
  readonly category: NotificationCategory;
  readonly subject: string;
  readonly body: string;
  /** Structured context a client can act on — ids, not prose. */
  readonly data?: Record<string, unknown>;
}

/**
 * The one write this module performs.
 *
 * A NARROW PORT so every calling service can be unit-tested with no database.
 * It returns nothing: no caller needs the generated ids, and selecting them
 * would add a RETURNING clause to every emission in the system.
 */
export interface NotificationWriterPort {
  createMany(rows: readonly EmitInput[]): Promise<void>;
}

export class NotificationEmitterService {
  constructor(private readonly writer: NotificationWriterPort) {}

  /**
   * Write notifications, never throwing.
   *
   * THE CONTRACT EVERY CALLER RELIES ON. An emission failure is logged and
   * swallowed, so a caller can fire it after its own transaction has committed
   * without wrapping it in a try/catch at every site — and without the risk
   * that a bell-entry failure rolls back the change it was describing.
   *
   * Deliberately NOT called inside a caller's transaction: doing so would make
   * a failed notification abort the business write, which is precisely the
   * coupling this method exists to prevent.
   */
  async emitQuietly(rows: readonly EmitInput[]): Promise<void> {
    if (rows.length === 0) return;

    try {
      await this.writer.createMany(rows);
    } catch (err) {
      // Logged with a stable scope so an operator can find it, and swallowed so
      // the caller's already-committed work is unaffected.
      console.error("[NotificationEmitter]", err);
    }
  }

  /**
   * Phase 22 — the README's "Faculty Notification", and its Phase 27 faculty
   * events "Attendance Lock" and "Attendance Unlock".
   *
   * Addressed to the faculty members who teach the locked unit. An empty
   * recipient list is a no-op rather than an error: a course with no assigned
   * faculty is unusual but not a fault, and refusing the lock over it would be
   * absurd.
   */
  async attendanceLockChanged(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    locked: boolean;
    courseLabel: string;
    sectionLabel: string;
    reason: string | null;
    lockId: string;
  }): Promise<void> {
    const action = input.locked ? "locked" : "unlocked";

    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.ATTENDANCE,
        subject: `Attendance ${action}: ${input.courseLabel}`,
        body: input.locked
          ? `Attendance for ${input.courseLabel} (${input.sectionLabel}) has been locked and can no longer be edited.${input.reason ? ` Reason: ${input.reason}` : ""}`
          : `Attendance for ${input.courseLabel} (${input.sectionLabel}) has been unlocked and may be corrected.${input.reason ? ` Reason: ${input.reason}` : ""}`,
        data: { lockId: input.lockId, locked: input.locked },
      }))
    );
  }

  /**
   * Phase 24 — the Phase 27 faculty event "Assignment Submission".
   *
   * Addressed to the assignment's author. `createdBy` is an unconstrained
   * identity column (TD-C), so the caller supplies it and a null means nobody
   * is notified rather than a row addressed to an id that resolves to no one.
   */
  async assignmentSubmitted(input: {
    tenantId: string;
    facultyUserId: string | null;
    assignmentTitle: string;
    assignmentId: string;
    isResubmission: boolean;
  }): Promise<void> {
    if (!input.facultyUserId) return;

    await this.emitQuietly([
      {
        tenantId: input.tenantId,
        userId: input.facultyUserId,
        category: NotificationCategory.ASSIGNMENT,
        subject: input.isResubmission
          ? `Resubmission received: ${input.assignmentTitle}`
          : `New submission: ${input.assignmentTitle}`,
        body: input.isResubmission
          ? `A student has resubmitted their work for "${input.assignmentTitle}". The previous attempt has been preserved in its history.`
          : `A student has submitted their work for "${input.assignmentTitle}".`,
        data: { assignmentId: input.assignmentId, isResubmission: input.isResubmission },
      },
    ]);
  }

  /**
   * Phase 24 — the Phase 27 student event "Assignment Evaluated".
   *
   * Addressed to the student whose submission was graded.
   */
  async assignmentEvaluated(input: {
    tenantId: string;
    studentUserId: string | null;
    assignmentTitle: string;
    assignmentId: string;
    marks: number;
    maxMarks: number;
  }): Promise<void> {
    if (!input.studentUserId) return;

    await this.emitQuietly([
      {
        tenantId: input.tenantId,
        userId: input.studentUserId,
        category: NotificationCategory.ASSIGNMENT,
        subject: `Assignment evaluated: ${input.assignmentTitle}`,
        body: `Your submission for "${input.assignmentTitle}" has been graded: ${input.marks} out of ${input.maxMarks}.`,
        data: {
          assignmentId: input.assignmentId,
          marks: input.marks,
          maxMarks: input.maxMarks,
        },
      },
    ]);
  }

  /**
   * Phase 26 — the Phase 27 student events "Question Paper Uploaded" and
   * "Solution Uploaded".
   *
   * Addressed to every student registered for the resource's course. The
   * SUBJECT distinguishes the two events by resource type, which is why the
   * README lists them separately while one publication action raises both.
   *
   * Emitted only on PUBLICATION, never on upload: a draft is invisible to
   * students, and telling them about a paper they cannot open would be worse
   * than silence.
   */
  async examResourcePublished(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    resourceId: string;
    resourceType: string;
    title: string;
    courseLabel: string;
  }): Promise<void> {
    const isSolution =
      input.resourceType === "SOLUTION" ||
      input.resourceType === "ANSWER_KEY" ||
      input.resourceType === "MARKING_SCHEME";

    const label = isSolution ? "Solution uploaded" : "Question paper uploaded";

    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.ACADEMIC,
        subject: `${label}: ${input.courseLabel}`,
        body: `"${input.title}" is now available for ${input.courseLabel}.`,
        data: { resourceId: input.resourceId, resourceType: input.resourceType },
      }))
    );
  }

  /**
   * Phase 27 student event "Attendance Updated".
   *
   * Raised by Phase 9's bulk mark. Addressed to the students whose attendance
   * was recorded — one notification each, not one per record, so a register of
   * thirty marks produces thirty notifications rather than thirty times the
   * number of sessions.
   */
  async attendanceMarked(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    courseLabel: string;
    date: string;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.ATTENDANCE,
        subject: `Attendance updated: ${input.courseLabel}`,
        body: `Your attendance for ${input.courseLabel} on ${input.date} has been recorded.`,
        data: { courseLabel: input.courseLabel, date: input.date },
      }))
    );
  }

  /**
   * Phase 27 student event "Attendance Below 75%".
   *
   * THE THRESHOLD IS NOT DEFINED HERE. It is the same 75% line Phase 15's
   * attendance analytics already exposes as `alerts.lowAttendance`; restating
   * it as a literal in this module would create a second definition, and the
   * day one moved the dashboard and the warning would disagree about whether a
   * student is at risk. The caller passes the threshold it used.
   */
  async lowAttendanceWarning(input: {
    tenantId: string;
    studentUserId: string;
    courseLabel: string;
    percentage: number;
    threshold: number;
  }): Promise<void> {
    await this.emitQuietly([
      {
        tenantId: input.tenantId,
        userId: input.studentUserId,
        category: NotificationCategory.ATTENDANCE,
        subject: `Low attendance warning: ${input.courseLabel}`,
        body: `Your attendance in ${input.courseLabel} is ${input.percentage}%, below the required ${input.threshold}%.`,
        data: {
          courseLabel: input.courseLabel,
          percentage: input.percentage,
          threshold: input.threshold,
        },
      },
    ]);
  }

  /** Phase 27 student event "Assignment Published". Raised by Phase 10. */
  async assignmentPublished(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    assignmentTitle: string;
    assignmentId: string;
    dueDate: string | null;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.ASSIGNMENT,
        subject: `New assignment: ${input.assignmentTitle}`,
        body: input.dueDate
          ? `"${input.assignmentTitle}" has been published. It is due on ${input.dueDate}.`
          : `"${input.assignmentTitle}" has been published.`,
        data: { assignmentId: input.assignmentId, dueDate: input.dueDate },
      }))
    );
  }

  /** Phase 27 student event "Fee Demand Generated". Raised by Phase 11. */
  async feeDemandGenerated(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    count: number;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.FEE,
        subject: "New fee demand generated",
        body: "A new fee demand has been raised on your account. See your fee ledger for the amount and due date.",
        data: { generatedCount: input.count },
      }))
    );
  }

  /** Phase 27 student event "Certificate Issued". Raised by Phase 12. */
  async certificateIssued(input: {
    tenantId: string;
    studentUserId: string | null;
    certificateType: string;
    certificateNo: string;
    certificateId: string;
  }): Promise<void> {
    if (!input.studentUserId) return;

    await this.emitQuietly([
      {
        tenantId: input.tenantId,
        userId: input.studentUserId,
        category: NotificationCategory.CERTIFICATE,
        subject: `Certificate issued: ${input.certificateType}`,
        body: `Your ${input.certificateType} certificate (${input.certificateNo}) has been issued.`,
        data: { certificateId: input.certificateId, certificateNo: input.certificateNo },
      },
    ]);
  }

  /**
   * Phase 27 event "Timetable Updated".
   *
   * Listed under BOTH the student and faculty audiences in the README, and this
   * one method serves both — the caller supplies whichever recipients the
   * change affects, because a slot change affects the section's students and
   * the member teaching it alike.
   */
  async timetableUpdated(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    courseLabel: string;
    sectionLabel: string | null;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.TIMETABLE,
        subject: `Timetable updated: ${input.courseLabel}`,
        body: input.sectionLabel
          ? `The timetable for ${input.courseLabel} (${input.sectionLabel}) has changed.`
          : `The timetable for ${input.courseLabel} has changed.`,
        data: { courseLabel: input.courseLabel },
      }))
    );
  }

  /**
   * Phase 27 faculty event "Student Feedback".
   *
   * CARRIES NO STUDENT IDENTITY AND NO SCORE. Phase 20's whole design is that
   * feedback is anonymous and only reportable in aggregate above a disclosure
   * threshold; a notification naming the submitter, or quoting a rating, would
   * defeat that in one line. The faculty member is told that feedback arrived
   * and directed to the report, which applies the anonymity rules properly.
   */
  async studentFeedbackReceived(input: {
    tenantId: string;
    facultyUserId: string | null;
    courseLabel: string | null;
  }): Promise<void> {
    if (!input.facultyUserId) return;

    await this.emitQuietly([
      {
        tenantId: input.tenantId,
        userId: input.facultyUserId,
        category: NotificationCategory.ACADEMIC,
        subject: "New student feedback received",
        body: input.courseLabel
          ? `New anonymous student feedback has been submitted for ${input.courseLabel}. See your feedback report for the aggregate.`
          : "New anonymous student feedback has been submitted. See your feedback report for the aggregate.",
        // No submissionId, no studentId, no rating. Deliberate.
        data: {},
      },
    ]);
  }

  /** Phase 27 administration event "New Admission". Raised by Phase 6. */
  async newAdmission(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    studentName: string;
    enrollmentNo: string;
    studentId: string;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.ACADEMIC,
        subject: `New admission: ${input.enrollmentNo}`,
        body: `${input.studentName} (${input.enrollmentNo}) has been enrolled.`,
        data: { studentId: input.studentId, enrollmentNo: input.enrollmentNo },
      }))
    );
  }

  /**
   * Phase 27 student event "Open Elective Window".
   *
   * Raised by Phase 19's allocation run, which is the moment a student's
   * elective outcome becomes knowable — the README names the event but the
   * project has no "open the window" action to hang it on, so allocation is the
   * one real trigger that exists.
   */
  async openElectiveAllocated(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    semesterId: string;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.ACADEMIC,
        subject: "Open elective allocation published",
        body: "Open elective allocation has been completed. Check your allocation status.",
        data: { semesterId: input.semesterId },
      }))
    );
  }

  /**
   * Phase 27 — the faculty event "HOD Announcement".
   *
   * A DELIBERATE EXCEPTION to the no-fan-out rule, and a narrow one. Ordinary
   * announcement READS are resolved on demand precisely so a batch-wide post is
   * one row; this writes a bell entry only for the EMERGENCY category, where
   * the point is that a recipient is interrupted rather than waiting to browse
   * a list.
   *
   * The caller supplies the recipients and is responsible for bounding them —
   * this module writes what it is given.
   */
  async emergencyAnnouncement(input: {
    tenantId: string;
    recipientUserIds: readonly string[];
    title: string;
    announcementId: string;
  }): Promise<void> {
    await this.emitQuietly(
      input.recipientUserIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: NotificationCategory.EMERGENCY,
        subject: input.title,
        body: `An emergency announcement has been published: "${input.title}".`,
        data: { announcementId: input.announcementId },
      }))
    );
  }
}

/** The delivery channel every row this module writes carries. See the header. */
export const EMITTED_NOTIFICATION_TYPE = NotificationType.IN_APP;

// ============================================================================
// OWNER  : Gauransh
// MODULE : Parent Portal reads (W2 — PRD §32)
// LAYER  : Service — parent-safe projections over EXISTING models.
// ACCESS : Called only after requireParent / requireParentChild has proven both
//          the parent and, where a child is named, the StudentParent link.
//
// WHY A PARENT-SPECIFIC SERVICE RATHER THAN REUSING THE STAFF ONES
//   The existing attendance, results and fee endpoints are guarded for staff or
//   for the student themselves. Widening those guards to admit parents would
//   weaken them for every other caller — the brief forbids it, and rightly.
//   These functions read the same tables through NARROWER projections.
//
// EVERY QUERY IS SCOPED TWICE
//   By the student id the guard proved, AND by tenantId. The first is the
//   ownership boundary and the second is the tenancy boundary; neither is
//   sufficient alone, and a row that satisfies only one is not returned.
//
// WHAT IS DELIBERATELY NOT SELECTED
//   No passwordHash, no internal actor ids (markedBy, verifiedBy, createdById),
//   no gateway metadata. A parent sees their child's record, not the
//   institution's operational trail. Selects are explicit column lists so a new
//   column cannot silently become parent-visible.
// ============================================================================

import { prisma } from "@/lib/db/prisma";

/** One child of the signed-in parent, for the dashboard's selector. */
export interface ParentChild {
  studentId: string;
  enrollmentNo: string;
  firstName: string;
  lastName: string;
  status: string;
  currentSemester: number;
  programmeName: string | null;
  /** Whether this parent is the primary contact. From StudentParent. */
  isPrimary: boolean;
  relation: string;
}

/**
 * The signed-in parent's children.
 *
 * Driven from StudentParent, so the list IS the relationship — there is no
 * separate notion of "which children a parent may see". Scoped by tenant as
 * well, so a link that somehow crossed universities yields nothing.
 */
export async function listChildren(
  parentId: string,
  tenantId: string
): Promise<ParentChild[]> {
  const links = await prisma.studentParent.findMany({
    where: { parentId, student: { tenantId } },
    select: {
      isPrimary: true,
      parent: { select: { relation: true } },
      student: {
        select: {
          id: true,
          enrollmentNo: true,
          status: true,
          currentSemester: true,
          user: { select: { firstName: true, lastName: true } },
          // Programme is read through the student's own relation rather than by
          // a second query keyed on an id the client could influence.
          programmeId: true,
        },
      },
    },
  });

  // One lookup for the names rather than a join per row.
  const programmeIds = links
    .map((l) => l.student.programmeId)
    .filter((id): id is string => Boolean(id));

  const programmes = programmeIds.length
    ? await prisma.programme.findMany({
        where: { id: { in: programmeIds }, tenantId },
        select: { id: true, name: true },
      })
    : [];
  const programmeName = new Map(programmes.map((p) => [p.id, p.name]));

  return links.map((link) => ({
    studentId: link.student.id,
    enrollmentNo: link.student.enrollmentNo,
    firstName: link.student.user.firstName,
    lastName: link.student.user.lastName,
    status: link.student.status,
    currentSemester: link.student.currentSemester,
    programmeName: link.student.programmeId
      ? (programmeName.get(link.student.programmeId) ?? null)
      : null,
    isPrimary: link.isPrimary,
    relation: link.parent.relation,
  }));
}

/** §32 "Student attendance" — the child's own records, newest first. */
export async function childAttendance(studentId: string, tenantId: string, limit: number) {
  const [rows, total] = await prisma.$transaction([
    prisma.attendance.findMany({
      where: { studentId, tenantId },
      // markedBy and facultyId are omitted: who took the register is the
      // institution's business, not the parent's.
      select: {
        id: true,
        date: true,
        status: true,
        sessionType: true,
        remarks: true,
        // Attendance.courseId has no declared relation (recorded as TD-B), so
        // the course cannot be joined here and is resolved below instead.
        courseId: true,
      },
      orderBy: { date: "desc" },
      take: limit,
    }),
    prisma.attendance.count({ where: { studentId, tenantId } }),
  ]);

  // One lookup for the whole page rather than a query per row. Scoped by
  // tenant, so an unconstrained courseId pointing elsewhere resolves to null
  // rather than leaking another university's course name.
  const courseIds = [...new Set(rows.map((r) => r.courseId).filter((id): id is string => Boolean(id)))];
  const courses = courseIds.length
    ? await prisma.course.findMany({
        where: { id: { in: courseIds }, tenantId },
        select: { id: true, code: true, name: true },
      })
    : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const records = rows.map(({ courseId, ...row }) => ({
    ...row,
    course: courseId ? (courseById.get(courseId) ?? null) : null,
  }));

  // PRD §13 names attendance percentage and shortage alerts; the summary here
  // is only what these rows can support — a count per status. Nothing about
  // eligibility thresholds is computed, because §32 defines none.
  const present = records.filter((r) => r.status === "PRESENT").length;

  return {
    records,
    summary: { returned: records.length, total, presentInReturned: present },
  };
}

/**
 * §32 "Timetable" — the child's applicable timetable.
 *
 * Applicable means the section the student is in. A student with no section has
 * no timetable, which is an empty list rather than the whole university's.
 */
export async function childTimetable(studentId: string, tenantId: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId },
    select: { sectionId: true },
  });

  if (!student?.sectionId) return [];

  return prisma.timetable.findMany({
    where: { tenantId, sectionId: student.sectionId, isActive: true },
    select: {
      id: true,
      day: true,
      startTime: true,
      endTime: true,
      roomNo: true,
      sessionType: true,
      course: { select: { code: true, name: true } },
      faculty: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: [{ day: "asc" }, { startTime: "asc" }],
  });
}

/**
 * §32 "Examination results" and "Academic progress" — PUBLISHED results only.
 *
 * `publishedAt: { not: null }` is the whole of the visibility rule and it is not
 * negotiable: an unpublished result is provisional, and a parent seeing a mark
 * before the institution has released it is exactly the failure §18's
 * "Parent-accessible report cards" implies must not happen.
 *
 * No grade is computed here. Grade and gradePoint are read as stored, because
 * the evaluation engine owns that arithmetic and a second implementation would
 * eventually disagree with it.
 */
export async function childResults(studentId: string, tenantId: string) {
  return prisma.examResult.findMany({
    where: {
      studentId,
      publishedAt: { not: null },
      // ExamResult carries no tenantId of its own (recorded as TD-A), so
      // tenancy is anchored through the examination it belongs to.
      examination: { tenantId },
    },
    select: {
      id: true,
      marksObtained: true,
      grade: true,
      gradePoint: true,
      isPassed: true,
      isAbsent: true,
      publishedAt: true,
      examination: {
        select: {
          id: true,
          title: true,
          type: true,
          date: true,
          maxMarks: true,
          course: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: { publishedAt: "desc" },
  });
}

/**
 * §32 "Fee status" — demands and payments, read-only.
 *
 * NO payment is initiated from here. §32 also names "Online payments", but the
 * gateway, provider and reconciliation behaviour are defined nowhere in the
 * PRD, so nothing that takes money exists in this module.
 *
 * Decimal columns are serialised by the route's existing helper; they are
 * returned as stored so no rounding is invented on the way out.
 */
export async function childFees(studentId: string, tenantId: string) {
  const [demands, payments] = await prisma.$transaction([
    prisma.feeDemand.findMany({
      where: { studentId, tenantId },
      select: {
        id: true,
        dueDate: true,
        totalAmount: true,
        paidAmount: true,
        waivedAmount: true,
        status: true,
        feeStructure: { select: { name: true } },
        semester: { select: { name: true } },
      },
      orderBy: { dueDate: "desc" },
    }),
    prisma.payment.findMany({
      where: { studentId, tenantId },
      // transactionId, gatewayRef and gatewayMeta are omitted: they are
      // reconciliation detail, and gatewayMeta is untyped JSON that could carry
      // anything a provider returned.
      select: {
        id: true,
        receiptNo: true,
        amount: true,
        method: true,
        status: true,
        paidAt: true,
      },
      orderBy: { paidAt: "desc" },
    }),
  ]);

  return { demands, payments };
}

/**
 * §32 "Notices" — published announcements that reach this child.
 *
 * Audience is honoured exactly as the model defines it: INSTITUTION reaches
 * everybody, and DEPARTMENT / BATCH / SECTION reach only their own. A parent
 * therefore sees what their child's cohort was told and nothing wider.
 *
 * DRAFT and expired notices are excluded — a draft is not yet a notice.
 */
export async function childNotices(studentId: string, tenantId: string, limit: number) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId },
    select: { batchId: true, sectionId: true, programmeId: true },
  });

  if (!student) return [];

  // The department a student belongs to, reached through their programme.
  const programme = student.programmeId
    ? await prisma.programme.findFirst({
        where: { id: student.programmeId, tenantId },
        select: { departmentId: true },
      })
    : null;

  const now = new Date();

  return prisma.announcement.findMany({
    where: {
      tenantId,
      status: "PUBLISHED",
      OR: [
        { audience: "INSTITUTION" },
        ...(programme?.departmentId
          ? [{ audience: "DEPARTMENT" as const, departmentId: programme.departmentId }]
          : []),
        ...(student.batchId ? [{ audience: "BATCH" as const, batchId: student.batchId }] : []),
        ...(student.sectionId
          ? [{ audience: "SECTION" as const, sectionId: student.sectionId }]
          : []),
      ],
      AND: [
        { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    select: {
      id: true,
      title: true,
      body: true,
      category: true,
      audience: true,
      isPinned: true,
      publishAt: true,
      createdAt: true,
    },
    orderBy: [{ isPinned: "desc" }, { publishAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

/**
 * §32 "Download documents" — the child's own documents and certificates.
 *
 * Two different things are returned separately rather than merged: a
 * StudentDocument is something the student supplied, a Certificate is something
 * the institution issued, and flattening them would lose that distinction.
 *
 * A REVOKED certificate is excluded. Handing a parent a revoked credential to
 * download is worse than showing nothing.
 */
export async function childDocuments(studentId: string, tenantId: string) {
  const [documents, certificates] = await Promise.all([
    prisma.studentDocument.findMany({
      // StudentDocument carries no tenantId, so tenancy is anchored through the
      // student — whose tenant the guard already proved.
      where: { studentId, student: { tenantId } },
      // verifiedBy is omitted: which staff member verified it is internal.
      select: {
        id: true,
        type: true,
        fileName: true,
        fileUrl: true,
        mimeType: true,
        isVerified: true,
        verifiedAt: true,
      },
      orderBy: { verifiedAt: "desc" },
    }),
    prisma.certificate.findMany({
      where: { studentId, tenantId, isRevoked: false },
      select: {
        id: true,
        certificateNo: true,
        type: true,
        issuedAt: true,
        expiresAt: true,
        pdfUrl: true,
      },
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  return { documents, certificates };
}

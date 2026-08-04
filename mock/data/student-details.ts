// ============================================================================
// MODULE : Mock Data — Student Sub-Resources
// PURPOSE: The five things a student profile shows beyond the record itself:
//          personal details, documents, guardians, examinations and results.
//
//          Each has its own endpoint under /api/students/[id]/…, so each is
//          generated independently and keyed by studentId rather than nested
//          inside the student — which is what the profile's tabs actually
//          fetch.
//
//          Deliberate gaps throughout: not every student has personal details
//          filled in, not every document is verified, and some results are
//          unpublished. A fixture where every record is complete leaves every
//          empty state and every "not yet" branch unrendered and untested.
// ============================================================================

import type {
  ExamResult,
  Examination,
  Parent,
  StudentDocument,
  StudentParent,
  StudentPersonal,
} from "@/types";
import { BLOOD_GROUP_VALUES, GENDER_VALUES } from "@/types";
import { daysAgo, seededInt, seededPick } from "../utils";
import { MOCK_TENANT_ID, mockId } from "./context";
import { CURRENT_SEMESTER, MOCK_SEMESTERS } from "./academics";
import { MOCK_COURSES } from "./courses";
import { MOCK_STUDENTS, MOCK_STUDENT_USERS } from "./people";

const CITIES = ["Jaipur", "Udaipur", "Kota", "Ajmer", "Jodhpur", "Bikaner"];
const RELIGIONS = ["Hindu", "Muslim", "Sikh", "Christian", "Jain", "Buddhist"];
const CATEGORIES = ["General", "OBC", "SC", "ST", "EWS"];
const LANGUAGES = ["Hindi", "English", "Marwari", "Punjabi", "Gujarati"];
const OCCUPATIONS = [
  "Business", "Government Service", "Private Service", "Teacher",
  "Doctor", "Farmer", "Engineer", "Homemaker",
];

// --- Personal details -------------------------------------------------------

/**
 * Roughly four in five students have their personal record completed.
 *
 * The rest exercise the "not filled in yet" branch on the Personal tab, which
 * is a real state — the record is created at enrolment and completed later.
 */
export const MOCK_STUDENT_PERSONAL: StudentPersonal[] = MOCK_STUDENTS.filter(
  (student) => seededInt(0, 9, `${student.id}-haspersonal`) > 1
).map((student, i): StudentPersonal => {
  const seed = `personal-${student.id}`;
  const city = seededPick(CITIES, `${seed}-city`);

  return {
    id: mockId("perso", i + 1, 4),
    studentId: student.id,
    // 18-24 years before the fixture epoch, which is the real range for an
    // undergraduate register.
    dateOfBirth: daysAgo(seededInt(18 * 365, 24 * 365, `${seed}-dob`)),
    gender: seededPick(GENDER_VALUES, `${seed}-gender`),
    bloodGroup: seededPick(BLOOD_GROUP_VALUES, `${seed}-blood`),
    nationality: "Indian",
    religion: seededPick(RELIGIONS, `${seed}-religion`),
    category: seededPick(CATEGORIES, `${seed}-category`),
    motherTongue: seededPick(LANGUAGES, `${seed}-language`),
    permanentAddr: {
      line1: `${seededInt(1, 400, `${seed}-house`)}, ${seededPick(["Civil Lines", "Malviya Nagar", "Vaishali Nagar", "Bapu Nagar"], `${seed}-area`)}`,
      city,
      state: "Rajasthan",
      postalCode: String(302000 + seededInt(1, 40, `${seed}-pin`)),
      country: "India",
    },
    // Only some students live away from home; the rest have no separate local
    // address, and the field renders as "same as permanent".
    localAddr:
      seededInt(0, 9, `${seed}-local`) > 5
        ? { line1: "University Hostel Block C", city: "Jaipur", state: "Rajasthan", country: "India" }
        : null,
    emergencyContact: {
      name: `${seededPick(["Suresh", "Kamla", "Rajesh", "Sunita"], `${seed}-ename`)} ${seededPick(["Sharma", "Verma", "Patel"], `${seed}-esur`)}`,
      relation: seededPick(["Father", "Mother", "Guardian"], `${seed}-erel`),
      phone: `+91 ${seededInt(70000, 99999, `${seed}-ep1`)} ${seededInt(10000, 99999, `${seed}-ep2`)}`,
    },
    // A small share, matching real registers — this drives the accessibility
    // support flag on the profile.
    disability: seededInt(0, 49, `${seed}-disability`) === 0,
    disabilityDesc: null,
    updatedAt: daysAgo(seededInt(10, 300, `${seed}-updated`)),
  };
});

export const PERSONAL_BY_STUDENT = new Map(
  MOCK_STUDENT_PERSONAL.map((personal) => [personal.studentId, personal])
);

// --- Documents --------------------------------------------------------------

/** What a student is asked to upload at enrolment, in the order requested. */
const REQUIRED_DOCUMENTS: { type: StudentDocument["type"]; fileName: string }[] = [
  { type: "PHOTO", fileName: "photograph.jpg" },
  { type: "AADHAAR", fileName: "aadhaar.pdf" },
  { type: "MARKSHEET", fileName: "class-12-marksheet.pdf" },
  { type: "TRANSFER_CERTIFICATE", fileName: "transfer-certificate.pdf" },
  { type: "CATEGORY_CERTIFICATE", fileName: "category-certificate.pdf" },
];

export const MOCK_STUDENT_DOCUMENTS: StudentDocument[] = MOCK_STUDENTS.flatMap(
  (student, studentIndex) => {
    // Students upload a prefix of the list, not a random subset — a register
    // shows people part-way through the same checklist, so "3 of 5 uploaded"
    // is the state that matters.
    const uploaded = seededInt(0, REQUIRED_DOCUMENTS.length, `${student.id}-doccount`);

    return REQUIRED_DOCUMENTS.slice(0, uploaded).map((doc, docIndex): StudentDocument => {
      const seed = `doc-${student.id}-${docIndex}`;
      const isVerified = seededInt(0, 9, `${seed}-verified`) > 3;
      const uploadedAt = daysAgo(seededInt(20, 380, `${seed}-uploaded`));

      return {
        id: mockId("doc", studentIndex * 10 + docIndex + 1, 5),
        studentId: student.id,
        type: doc.type,
        fileName: doc.fileName,
        fileUrl: `https://cdn.eduos.dev/documents/${student.id}/${doc.fileName}`,
        fileSize: seededInt(80_000, 3_500_000, `${seed}-size`),
        mimeType: doc.fileName.endsWith(".jpg") ? "image/jpeg" : "application/pdf",
        isVerified,
        verifiedBy: isVerified ? "usr_emp_001" : null,
        verifiedAt: isVerified ? daysAgo(seededInt(5, 19, `${seed}-vdate`)) : null,
        uploadedAt,
      };
    });
  }
);

// --- Guardians --------------------------------------------------------------

const STUDENT_USER_BY_ID = new Map(MOCK_STUDENT_USERS.map((u) => [u.id, u]));

/**
 * One or two guardians per student, sharing the student's surname.
 *
 * A father is always present and always primary; a mother is recorded for
 * about two thirds. Randomising the surname would make a guardian list read as
 * unrelated strangers.
 */
export const MOCK_PARENTS: Parent[] = MOCK_STUDENTS.flatMap((student, studentIndex) => {
  const user = STUDENT_USER_BY_ID.get(student.userId);
  const surname = user?.lastName ?? "Sharma";
  const seed = `parent-${student.id}`;

  const father: Parent = {
    id: mockId("par", studentIndex * 10 + 1, 5),
    tenantId: MOCK_TENANT_ID,
    firstName: seededPick(
      ["Rajesh", "Suresh", "Mahesh", "Dinesh", "Ramesh", "Vinod", "Ashok"],
      `${seed}-fname`
    ),
    lastName: surname,
    email: `${surname.toLowerCase()}.family${studentIndex}@gmail.com`,
    phone: `+91 ${seededInt(70000, 99999, `${seed}-fp1`)} ${seededInt(10000, 99999, `${seed}-fp2`)}`,
    occupation: seededPick(OCCUPATIONS, `${seed}-focc`),
    // Decimal(12,2) — kept as a string, as it arrives over the wire.
    annualIncome: `${seededInt(180, 2400, `${seed}-income`) * 1000}.00`,
    relation: "Father",
    createdAt: student.createdAt,
  };

  if (seededInt(0, 9, `${seed}-hasmother`) < 3) return [father];

  const mother: Parent = {
    id: mockId("par", studentIndex * 10 + 2, 5),
    tenantId: MOCK_TENANT_ID,
    firstName: seededPick(
      ["Sunita", "Kamla", "Meena", "Rekha", "Anita", "Pushpa"],
      `${seed}-mname`
    ),
    lastName: surname,
    email: null,
    phone: `+91 ${seededInt(70000, 99999, `${seed}-mp1`)} ${seededInt(10000, 99999, `${seed}-mp2`)}`,
    occupation: seededPick(OCCUPATIONS, `${seed}-mocc`),
    annualIncome: null,
    relation: "Mother",
    createdAt: student.createdAt,
  };

  return [father, mother];
});

export const PARENT_BY_ID = new Map(MOCK_PARENTS.map((parent) => [parent.id, parent]));

/** The student-to-guardian links. The father is the primary contact. */
export const MOCK_STUDENT_PARENTS: StudentParent[] = MOCK_STUDENTS.flatMap(
  (student, studentIndex) => {
    const fatherId = mockId("par", studentIndex * 10 + 1, 5);
    const motherId = mockId("par", studentIndex * 10 + 2, 5);

    const links: StudentParent[] = [
      { studentId: student.id, parentId: fatherId, isPrimary: true },
    ];

    if (PARENT_BY_ID.has(motherId)) {
      links.push({ studentId: student.id, parentId: motherId, isPrimary: false });
    }

    return links;
  }
);

// --- Examinations & results -------------------------------------------------

const GRADE_BANDS: { min: number; grade: string; point: string }[] = [
  { min: 90, grade: "A+", point: "10.00" },
  { min: 80, grade: "A", point: "9.00" },
  { min: 70, grade: "B+", point: "8.00" },
  { min: 60, grade: "B", point: "7.00" },
  { min: 50, grade: "C", point: "6.00" },
  { min: 40, grade: "D", point: "5.00" },
  { min: 0, grade: "F", point: "0.00" },
];

function gradeFor(percentage: number) {
  return GRADE_BANDS.find((band) => percentage >= band.min)!;
}

/**
 * Mid-term and end-term examinations for a sample of courses, across the last
 * three semesters.
 *
 * Scoped to a slice of the catalogue rather than every course: results are
 * generated per student per examination, and the full cross-product would be
 * tens of thousands of rows that no screen ever pages through.
 */
const EXAMINED_COURSES = MOCK_COURSES.filter((course) => course.isActive).slice(0, 12);
const EXAMINED_SEMESTERS = MOCK_SEMESTERS.slice(-3);

export const MOCK_EXAMINATIONS: Examination[] = EXAMINED_SEMESTERS.flatMap(
  (semester, semesterIndex) =>
    EXAMINED_COURSES.flatMap((course, courseIndex) =>
      (["MID_TERM", "END_TERM"] as const).map((type, typeIndex): Examination => {
        const seed = `exam-${semester.id}-${course.id}-${type}`;
        // A past semester's examinations are complete; the current one's are
        // still scheduled, which is what makes the "not yet published" branch
        // reachable on a transcript.
        const isPast = semester.id !== CURRENT_SEMESTER.id;

        return {
          // The multipliers must exceed the range of everything below them, or
          // ids collide silently. With 12 courses the previous 100/10 spacing
          // overflowed — semester 1 course 0 and semester 0 course 10 both
          // produced 101 — and a scheduled paper then inherited another paper's
          // results. 1000/10 leaves room for 100 courses per semester.
          id: mockId("exm", semesterIndex * 1000 + courseIndex * 10 + typeIndex + 1, 5),
          tenantId: MOCK_TENANT_ID,
          semesterId: semester.id,
          courseId: course.id,
          title: `${course.code} ${type === "MID_TERM" ? "Mid-Term" : "End-Term"}`,
          type,
          status: isPast ? "COMPLETED" : "SCHEDULED",
          date: isPast
            ? daysAgo(seededInt(40, 400, `${seed}-date`))
            : daysAgo(-seededInt(10, 80, `${seed}-future`)),
          startTime: "10:00",
          endTime: type === "MID_TERM" ? "11:30" : "13:00",
          venue: `Block ${seededPick(["A", "B", "C"], `${seed}-venue`)}, Room ${seededInt(101, 320, `${seed}-room`)}`,
          maxMarks: type === "MID_TERM" ? 50 : 100,
          passMark: type === "MID_TERM" ? 20 : 40,
          duration: type === "MID_TERM" ? 90 : 180,
          instructions: null,
          createdAt: semester.startDate,
          updatedAt: semester.startDate,
        };
      })
    )
);

export const EXAMINATION_BY_ID = new Map(MOCK_EXAMINATIONS.map((exam) => [exam.id, exam]));

/**
 * Results for completed examinations only.
 *
 * A scheduled examination has no results yet — generating them would put marks
 * against a paper nobody has sat.
 */
export const MOCK_EXAM_RESULTS: ExamResult[] = MOCK_EXAMINATIONS.filter(
  (exam) => exam.status === "COMPLETED"
).flatMap((exam, examIndex) =>
  MOCK_STUDENTS.filter(
    // Only a slice of the register sat any given paper — a course is taken by
    // one programme's students, not all 186.
    (student) => seededInt(0, 9, `${exam.id}-${student.id}-sat`) > 6
  ).map((student, studentIndex): ExamResult => {
    const seed = `result-${exam.id}-${student.id}`;
    const isAbsent = seededInt(0, 39, `${seed}-absent`) === 0;

    if (isAbsent) {
      return {
        id: mockId("res", examIndex * 1000 + studentIndex + 1, 6),
        examinationId: exam.id,
        studentId: student.id,
        marksObtained: null,
        grade: null,
        gradePoint: null,
        isPassed: false,
        isAbsent: true,
        remarks: "Absent",
        publishedAt: daysAgo(seededInt(20, 90, `${seed}-pub`)),
        createdAt: exam.date ?? exam.createdAt,
        updatedAt: exam.date ?? exam.createdAt,
      };
    }

    // Weighted towards passing, with a genuine failing tail — a register where
    // nobody fails makes the pass/fail badge decorative.
    const marks = seededInt(
      Math.round(exam.maxMarks * 0.25),
      exam.maxMarks,
      `${seed}-marks`
    );
    const percentage = (marks / exam.maxMarks) * 100;
    const band = gradeFor(percentage);

    return {
      id: mockId("res", examIndex * 1000 + studentIndex + 1, 6),
      examinationId: exam.id,
      studentId: student.id,
      // Decimal(6,2) over the wire.
      marksObtained: `${marks}.00`,
      grade: band.grade,
      gradePoint: band.point,
      isPassed: exam.passMark !== null ? marks >= exam.passMark : null,
      isAbsent: false,
      remarks: null,
      // A few results are held back — the "awaiting publication" state.
      publishedAt:
        seededInt(0, 19, `${seed}-held`) === 0
          ? null
          : daysAgo(seededInt(20, 90, `${seed}-pub`)),
      createdAt: exam.date ?? exam.createdAt,
      updatedAt: exam.date ?? exam.createdAt,
    };
  })
);

export const RESULTS_BY_STUDENT = new Map<string, ExamResult[]>();
for (const result of MOCK_EXAM_RESULTS) {
  const existing = RESULTS_BY_STUDENT.get(result.studentId);
  if (existing) existing.push(result);
  else RESULTS_BY_STUDENT.set(result.studentId, [result]);
}

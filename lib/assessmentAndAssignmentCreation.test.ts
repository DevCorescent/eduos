// ============================================================================
// TESTS: the two confirmed creation gaps.
//
//   ISSUE 1 — the Controller of Examination had no way to CREATE an assessment
//             event. POST /api/assessment-events had existed all along under
//             ASSESSMENT_EVENT_MANAGE_ROLES; nothing in the UI ever called it.
//             The fix is a create control on the existing page, gated on the
//             same constant the endpoint applies. No role set moved.
//
//   ISSUE 2 — a lecturer had no way to CREATE an assignment. Here the backend
//             was NOT simply waiting to be called: POST /api/assignments
//             admitted FACULTY and checked only TENANT membership, so any
//             lecturer could set work on any colleague's course — and publish
//             it to that colleague's students. The UI gap and that hole are
//             fixed together, because adding the button without the rule would
//             have shipped the hole as a feature.
//
// The routes reach a database and this suite has none (see package.json), so
// route guarantees are pinned as source contracts and the decision logic itself
// is unit-tested for real in lib/services/facultyTeaching.test.ts. The schemas
// below ARE exercised for real — they are pure Zod and need nothing.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createAssessmentEventSchema } from "./validations/assessmentEvent";
import { createAssignmentSchema } from "./validations/assignment";
import {
  ASSESSMENT_EVENT_MANAGE_ROLES,
  ASSESSMENT_EVENT_READ_ROLES,
} from "./constants/assessmentEvent";
import { FACULTY_READ_ROLES } from "./constants/departmentAcademics";
import {
  courseworkTargetOptions,
  decodeCourseworkTarget,
  encodeCourseworkTarget,
} from "@/components/shared/assignmentFields";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with comments stripped, for "this is gone" assertions. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** One handler's body, so an assertion cannot be satisfied by a sibling. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const assessmentRoute = read("app/api/assessment-events/route.ts");
const assessmentPage = read("app/(university)/evaluation/assessment-events/page.tsx");
const assessmentFields = read("components/shared/assessmentEventFields.ts");
const evaluationActions = read("actions/evaluation.ts");
const evaluationService = read("services/evaluation.ts");

const assignmentRoute = read("app/api/assignments/route.ts");
const publishRoute = read("app/api/assignments/[id]/publish/route.ts");
const teaching = read("lib/services/facultyTeaching.ts");
const facultyAssignments = read("app/(portals)/faculty/assignments/page.tsx");
const assignmentDetail = read("app/(portals)/faculty/assignments/[id]/page.tsx");
const assignmentActions = read("actions/assignments.ts");

// ============================================================================
// ISSUE 1 — the Controller of Examination can create an assessment event
// ============================================================================

describe("#1 — the create control exists, and is gated on the manage roles", () => {
  it("the Assessment Events page renders a create action", () => {
    // The whole defect: the page listed sittings and offered no way to add one.
    assert.match(assessmentPage, /EntityCreateButton/);
    assert.match(assessmentPage, /label="Schedule assessment"/);
    assert.match(assessmentPage, /action=\{scheduleAssessmentEventAction\}/);
  });

  it("it is withheld from a caller outside ASSESSMENT_EVENT_MANAGE_ROLES", () => {
    // This portal also admits DEPARTMENT_HOD and CAMPUS_ADMIN, who read the
    // calendar and do not write it. An ungated button would be one that always
    // answers 403.
    assert.match(
      assessmentPage,
      /hasAnyRole\(session\?\.roles \?\? \[\], ASSESSMENT_EVENT_MANAGE_ROLES\)/
    );
    assert.match(assessmentPage, /canOpenDialog \? \(/);
  });

  it("the gate reads the SAME constant the endpoint applies, not a copy", () => {
    // A second list would drift the first time either changed, and the screen
    // would then disagree with the API about who may schedule.
    assert.match(
      assessmentPage,
      /import \{ ASSESSMENT_EVENT_MANAGE_ROLES \} from "@\/lib\/constants\/assessmentEvent"/
    );
    assert.match(
      assessmentRoute,
      /const guard = await requireRole\(\.\.\.ASSESSMENT_EVENT_MANAGE_ROLES\)/
    );
  });

  it("the roles are resolved from the session, never from the URL", () => {
    assert.match(assessmentPage, /const session = await getPortalSession\(\)/);
    assert.ok(
      !/roles.*searchParams|searchParams.*roles/i.test(code(assessmentPage)),
      "no role may be read from a query string"
    );
  });
});

describe("#1 — no permission was broadened to make this work", () => {
  it("CONTROLLER_OF_EXAMINATION could already manage assessment events", () => {
    // The backend was never the gap. Stated so a later reader does not look for
    // a role change that is deliberately absent.
    assert.deepEqual(
      [...ASSESSMENT_EVENT_MANAGE_ROLES],
      ["UNIVERSITY_ADMIN", "CONTROLLER_OF_EXAMINATION"]
    );
  });

  it("DEPARTMENT_HOD remains READ-ONLY", () => {
    assert.ok(
      ASSESSMENT_EVENT_READ_ROLES.includes("DEPARTMENT_HOD"),
      "a head of department reads the assessment calendar"
    );
    assert.ok(
      !(ASSESSMENT_EVENT_MANAGE_ROLES as readonly string[]).includes("DEPARTMENT_HOD"),
      "and does not write it"
    );
  });

  it("FACULTY remains read-only, and STUDENT reaches nothing", () => {
    assert.ok(ASSESSMENT_EVENT_READ_ROLES.includes("FACULTY"));
    assert.ok(!(ASSESSMENT_EVENT_MANAGE_ROLES as readonly string[]).includes("FACULTY"));
    assert.ok(!(ASSESSMENT_EVENT_READ_ROLES as readonly string[]).includes("STUDENT"));
    assert.ok(!(ASSESSMENT_EVENT_READ_ROLES as readonly string[]).includes("PARENT"));
  });

  it("the COE was NOT added to the faculty registry to populate a picker", () => {
    // conductedById is optional on the model and would have needed a faculty
    // list. FACULTY_READ_ROLES excluding the COE is a locked decision from
    // tester issue #48; the field is omitted instead of the decision reversed.
    assert.ok(!(FACULTY_READ_ROLES as readonly string[]).includes("CONTROLLER_OF_EXAMINATION"));
    assert.ok(
      !/conductedById/.test(code(assessmentFields)),
      "the form must not offer a field the COE cannot fill"
    );
  });
});

describe("#1 — the form offers only what the API accepts", () => {
  it("components come from ACTIVE regulations only", () => {
    // AssessmentEventService.create refuses a component whose scheme is not
    // ACTIVE, so offering a draft's components would be a choice that 409s.
    assert.match(evaluationService, /status: "ACTIVE"/);
    assert.match(evaluationService, /export async function schedulableComponents/);
  });

  it("the section field is omitted when the caller cannot enumerate sections", () => {
    // GET /api/batches is requireRole("UNIVERSITY_ADMIN"), so the examination
    // office resolves no sections. A permanently empty select is a control that
    // cannot be used; the column is nullable, so the field is simply absent.
    assert.match(assessmentFields, /options\.sections\.length > 0/);
  });

  it("the server never lets a client choose the sitting number or its status", () => {
    // Both are absent from the schema and therefore stripped from any body.
    const parsed = createAssessmentEventSchema.safeParse({
      evaluationComponentId: "c1",
      courseId: "co1",
      semesterId: "s1",
      title: "Mid-Semester Test",
      sequenceNumber: 99,
      status: "PUBLISHED",
    });

    assert.equal(parsed.success, true);
    assert.ok(!("sequenceNumber" in parsed.data!));
    assert.ok(!("status" in parsed.data!));
  });

  it("the three references are required, so an empty form cannot be submitted", () => {
    assert.equal(createAssessmentEventSchema.safeParse({ title: "Test" }).success, false);
    assert.equal(
      createAssessmentEventSchema.safeParse({
        evaluationComponentId: "c1",
        courseId: "co1",
        title: "Test",
      }).success,
      false,
      "a missing semester is refused"
    );
  });

  it("a title shorter than the bound is refused", () => {
    const parsed = createAssessmentEventSchema.safeParse({
      evaluationComponentId: "c1",
      courseId: "co1",
      semesterId: "s1",
      title: "T",
    });

    assert.equal(parsed.success, false);
  });

  it("maxMarks may be omitted, and the service fills it from the component", () => {
    const parsed = createAssessmentEventSchema.safeParse({
      evaluationComponentId: "c1",
      courseId: "co1",
      semesterId: "s1",
      title: "Mid-Semester Test",
    });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.maxMarks, undefined);
  });
});

describe("#1 — the action delegates rather than re-deciding", () => {
  it("it posts through the service and states no authorization of its own", () => {
    assert.match(evaluationActions, /return scheduleAssessmentEvent\(input\)/);
    assert.ok(
      !/requireRole|ASSESSMENT_EVENT_MANAGE_ROLES/.test(code(evaluationActions)),
      "an action re-checking the guard would be a second, weaker opinion"
    );
  });

  it("a blank section is sent as ABSENT, not as an empty string", () => {
    // The column is nullable and the schema treats a missing key as "every
    // section"; "" would be a validation failure rather than a whole-course
    // sitting.
    assert.match(evaluationActions, /sectionId: optionalStr\(values, "sectionId"\)/);
  });

  it("no tenant id is ever sent — the endpoint derives it from the session", () => {
    assert.ok(!/tenantId/.test(code(evaluationActions)));
    assert.ok(!/tenantId/.test(code(assessmentFields)));
  });
});

// ============================================================================
// ISSUE 2 — a lecturer can create an assignment, confined to what they teach
// ============================================================================

describe("#2 — the create control exists on My Assignments", () => {
  it("the page renders a Set assignment action", () => {
    assert.match(facultyAssignments, /EntityCreateButton/);
    assert.match(facultyAssignments, /label="Set assignment"/);
    assert.match(facultyAssignments, /action=\{createAssignmentAction\}/);
  });

  it("its options come from the lecturer's OWN teaching endpoint", () => {
    // GET /api/faculty/me/teaching has no [facultyId] segment and resolves the
    // lecturer from session.sub, so this cannot be asked about a colleague.
    assert.match(facultyAssignments, /getMyTeaching\(\)/);
    assert.match(facultyAssignments, /courseworkTargetOptions\(teaching\)/);
  });

  it("the control is withheld — with a reason — when they teach nothing", () => {
    assert.match(facultyAssignments, /canSetWork \? \(/);
    assert.match(facultyAssignments, /No course to set work for/);
  });

  it("the existing search and list behaviour is untouched", () => {
    // Tester issues #39/#45 fixed the search on this screen. A create button
    // must not regress it.
    assert.ok(!/unsupported=/.test(facultyAssignments));
    assert.match(
      facultyAssignments,
      /listFacultyAssignments\(faculty\.userId, \{ page: 1, limit: 100, q \}\)/
    );
  });
});

describe("#2 — the class encoding carries a course, and a section only if chosen", () => {
  it("a whole-course target encodes as the bare course id", () => {
    assert.equal(encodeCourseworkTarget("course_1"), "course_1");
    assert.deepEqual(decodeCourseworkTarget("course_1"), { courseId: "course_1" });
  });

  it("a sectioned target round-trips both ids", () => {
    const encoded = encodeCourseworkTarget("course_1", "section_2");
    assert.deepEqual(decodeCourseworkTarget(encoded), {
      courseId: "course_1",
      sectionId: "section_2",
    });
  });

  it("an untouched select decodes to null rather than a half-formed body", () => {
    assert.equal(decodeCourseworkTarget(""), null);
  });

  it("every course contributes one whole-course option and one per section", () => {
    const options = courseworkTargetOptions([
      {
        courseId: "c1",
        courseCode: "CS101",
        courseName: "Programming",
        sectionId: "s2",
        sectionName: "B",
      },
      {
        courseId: "c1",
        courseCode: "CS101",
        courseName: "Programming",
        sectionId: "s1",
        sectionName: "A",
      },
    ]);

    // One course, two sections — three options, the broader one first so it is
    // never buried beneath the narrower ones.
    assert.deepEqual(
      options.map((option) => option.value),
      ["c1", "c1|s1", "c1|s2"]
    );
    assert.match(options[0].label, /All sections/);
  });

  it("offers nothing at all for a lecturer who teaches nothing", () => {
    assert.deepEqual(courseworkTargetOptions([]), []);
  });
});

describe("#2 — the server confines a lecturer to their own teaching load", () => {
  const post = handler(assignmentRoute, "POST");

  it("POST /api/assignments applies facultyMaySetCoursework", () => {
    // THE HOLE THIS CLOSES: before this, both lookups proved only that the
    // course and section were in the caller's TENANT — which every lecturer in
    // the university satisfies for every course in it.
    assert.match(post, /facultyMaySetCoursework\(/);
    assert.match(post, /FACULTY_COURSEWORK_REFUSALS\[decision\.reason\]/);
    assert.match(post, /"FORBIDDEN"\),[\s\S]{0,40}status: 403/);
  });

  it("it reuses the module the register and the timetable already consult", () => {
    // One statement about whose class this is, so the three write paths cannot
    // disagree.
    assert.match(
      assignmentRoute,
      /from "@\/lib\/services\/facultyTeaching"/
    );
    assert.match(teaching, /export async function facultyMaySetCoursework/);
    assert.match(teaching, /export async function teachesCourse/);
  });

  it("UNIVERSITY_ADMIN is exempt, and the precedence cannot downgrade a 401", () => {
    // An administrator sets work on behalf of a department and holds no
    // FacultyMember row, so confining them would refuse them for that alone.
    assert.match(post, /const elevatedGuard = await requireRole\("UNIVERSITY_ADMIN"\)/);
    assert.match(post, /const facultyGuard = await requireRole\("FACULTY"\)/);
    assert.match(post, /if \(!facultyGuard\.authorized\) return facultyGuard\.response/);
    assert.match(post, /if \(!isElevated\)/);
  });

  it("authority is the session subject — no facultyId is read from the body", () => {
    assert.match(post, /session\.sub/);
    assert.match(post, /createdBy: session\.sub/);
    assert.ok(
      !/facultyId/.test(code(post)),
      "the body carries no facultyId, and none is trusted"
    );
  });

  it("the confinement runs AFTER the tenant lookups, so a 403 never crosses tenants", () => {
    const tenantCheck = post.indexOf("prisma.course.findFirst");
    const confinement = post.indexOf("facultyMaySetCoursework");
    assert.ok(tenantCheck > 0 && confinement > tenantCheck);
  });

  it("tenant isolation is unchanged — every reference is scoped, none comes from the body", () => {
    assert.match(post, /where: \{ id: scalars\.courseId, tenantId: tenant\.id \}/);
    assert.match(post, /where: \{ id: scalars\.sectionId, tenantId: tenant\.id \}/);
    assert.match(post, /tenantId: tenant\.id,/);
    assert.ok(!/tenantId: (parsed|input|query|body|scalars)/.test(post));
  });
});

describe("#2 — publishing is confined by the same rule", () => {
  const publish = handler(publishRoute, "POST");

  it("a lecturer may only publish work on a course they teach", () => {
    // Publication is what makes work visible AND notifies the cohort, so an
    // unconfined publish would let a lecturer announce work on a course they
    // have nothing to do with.
    assert.match(publish, /facultyMaySetCoursework\(/);
    assert.match(publish, /FACULTY_COURSEWORK_REFUSALS\[decision\.reason\]/);
  });

  it("it asks about the STORED row, not about anything the caller sent", () => {
    // The request body is empty; the only client input is the id in the URL.
    assert.match(publish, /select: \{ status: true, courseId: true, sectionId: true \}/);
    assert.match(publish, /existing\.courseId/);
    assert.match(publish, /existing\.sectionId/);
  });

  it("the refusal does not depend on whether the assignment is already published", () => {
    // Whether a stranger's assignment is a draft is a fact about a record this
    // caller has no business reading, so the confinement precedes the
    // transition guard.
    const confinement = publish.indexOf("facultyMaySetCoursework");
    const transition = publish.indexOf('existing.status !== "DRAFT"');
    assert.ok(confinement > 0 && transition > confinement);
  });

  it("the tenant-scoped lookup still comes first, so a 403 never crosses tenants", () => {
    const lookup = publish.indexOf("prisma.assignment.findFirst");
    const confinement = publish.indexOf("facultyMaySetCoursework");
    assert.ok(lookup > 0 && confinement > lookup);
  });
});

describe("#2 — the lifecycle is preserved, and students can still see the work", () => {
  it("a new assignment is always a DRAFT — status is not settable on create", () => {
    const parsed = createAssignmentSchema.safeParse({
      courseId: "c1",
      title: "Problem Set 3",
      status: "PUBLISHED",
      publishedAt: new Date().toISOString(),
      createdBy: "someone_else",
      tenantId: "other_tenant",
    });

    assert.equal(parsed.success, true);
    assert.ok(!("status" in parsed.data!));
    assert.ok(!("publishedAt" in parsed.data!));
    assert.ok(!("createdBy" in parsed.data!), "authorship is never a client claim");
    assert.ok(!("tenantId" in parsed.data!), "the tenant is never a client claim");
  });

  it("the section is optional, because work set for a whole course is ordinary", () => {
    const parsed = createAssignmentSchema.safeParse({ courseId: "c1", title: "Essay" });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.sectionId, undefined);
  });

  it("a course and a title are required, and maxMarks must be a positive integer", () => {
    assert.equal(createAssignmentSchema.safeParse({ title: "Essay" }).success, false);
    assert.equal(createAssignmentSchema.safeParse({ courseId: "c1" }).success, false);
    assert.equal(
      createAssignmentSchema.safeParse({ courseId: "c1", title: "E", maxMarks: 0 }).success,
      false
    );
    assert.equal(
      createAssignmentSchema.safeParse({ courseId: "c1", title: "E", maxMarks: 2.5 }).success,
      false
    );
  });

  it("the detail page offers Publish, and only from DRAFT", () => {
    // Without this a lecturer could set work no student would ever see: a
    // student reads only assignments whose publishedAt is set.
    assert.ok(
      existsSync(
        join(process.cwd(), "app/(portals)/faculty/assignments/[id]/PublishAssignmentButton.tsx")
      )
    );
    assert.match(assignmentDetail, /assignment\.status === "DRAFT" &&/);
    assert.match(assignmentDetail, /<PublishAssignmentButton/);
  });

  it("the publish action sends only an id", () => {
    assert.match(assignmentActions, /export async function publishAssignmentAction\(\s*id: string/);
    assert.match(assignmentActions, /return publishAssignment\(id\)/);
  });

  it("student visibility is unchanged — publishedAt is still the predicate", () => {
    const get = handler(assignmentRoute, "GET");
    assert.match(get, /publishedAt: \{ not: null \}/);
    assert.match(get, /const studentGuard = await requireRole\("STUDENT"\)/);
  });

  it("the existing publish notification is reused, not replaced", () => {
    // Phase 27 already notifies the course's registered students, narrowed to
    // the section when the assignment names one. Nothing new was invented.
    assert.match(publishRoute, /notificationEmitter\.assignmentPublished/);
    assert.match(publishRoute, /findStudentUserIdsForCourse/);
  });
});

describe("#2 — the action delegates rather than re-deciding", () => {
  it("it posts through the service and states no authorization of its own", () => {
    assert.match(assignmentActions, /return createAssignment\(input\)/);
    assert.ok(
      !/requireRole|facultyMaySetCoursework|teachesPair/.test(code(assignmentActions)),
      "an action re-checking the guard would be a second, weaker opinion"
    );
  });

  it("no facultyId, createdBy or tenantId is ever sent", () => {
    const stripped = code(assignmentActions);
    assert.ok(!/facultyId/.test(stripped));
    assert.ok(!/createdBy/.test(stripped));
    assert.ok(!/tenantId/.test(stripped));
  });
});

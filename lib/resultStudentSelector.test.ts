// ============================================================================
// TESTS: the result-scoped student selector — tester issue #48.
//
// THE DEFECT
//   "Select a Student shows no list for the Controller of Examination, and the
//   same list loads for the head of department."
//
//   The Transcript picker filled itself from GET /api/students, which is
//   STUDENT_READ_ROLES — [UNIVERSITY_ADMIN, DEPARTMENT_HOD]. The examination
//   office is deliberately absent from that set and a test asserts the
//   exclusion, calling it "the boundary the locked decision draws". So this was
//   not a wiring fault: the office could read any student's TRANSCRIPT and had
//   no permitted way to name its subject.
//
// THE FIX IS NARROWER THAN THE ALTERNATIVE
//   GET /api/results/students, gated on requireResultAccess — the SAME boundary
//   the transcript itself applies — returning three columns instead of the
//   registry's fifteen. Adding the COE to STUDENT_READ_ROLES would have handed
//   the examination office the whole student registry to solve a picker, and
//   deleted a boundary a test exists to protect.
//
//   These assertions pin BOTH halves: the office can now choose a student, AND
//   the registry boundary is exactly where it was.
//
// The route reaches a database and this suite has none (see package.json), so
// its guarantees are pinned as source contracts, and the behaviours that need
// rows are covered by live verification against the running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with comments stripped, for "this is gone" assertions. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const selector = read("app/api/results/students/route.ts");
const evaluationService = read("services/evaluation.ts");
const transcriptPage = read("app/(university)/evaluation/transcript/page.tsx");
const studentResultsPage = read("app/(university)/evaluation/results/student/page.tsx");
const registry = read("lib/constants/departmentAcademics.ts");
const resultRoles = read("lib/constants/result.ts");
const resultService = read("lib/services/result.service.ts");

// ============================================================================
// 4 — THE BOUNDARY THIS FIX REFUSED TO MOVE
// ============================================================================

describe("#48 — the student registry boundary is untouched", () => {
  it("STUDENT_READ_ROLES still does NOT contain CONTROLLER_OF_EXAMINATION", () => {
    // The whole point. Solving the picker by widening this would have been the
    // wrong fix, and lib/api-department-scope.test.ts asserts the same thing.
    const start = registry.indexOf("export const STUDENT_READ_ROLES");
    const block = registry.slice(start, registry.indexOf("]", start));

    assert.ok(!/CONTROLLER_OF_EXAMINATION/.test(block));
  });

  it("FACULTY_READ_ROLES is likewise unchanged", () => {
    const start = registry.indexOf("export const FACULTY_READ_ROLES");
    const block = registry.slice(start, registry.indexOf("]", start));

    assert.ok(!/CONTROLLER_OF_EXAMINATION/.test(block));
  });

  it("the selector does not reach the student registry endpoint", () => {
    assert.ok(
      !/api\/students/.test(code(selector)),
      "this route must not proxy the registry it exists to avoid"
    );
  });
});

// ============================================================================
// 1 / 2 — COE REACHES THE SELECTOR, AND GETS THE THREE COLUMNS
// ============================================================================

describe("#48 — the selector exists and is gated on the result boundary", () => {
  it("the route exists", () => {
    assert.ok(existsSync(join(process.cwd(), "app/api/results/students/route.ts")));
  });

  it("it is guarded by requireResultAccess, not a role list of its own", () => {
    // Reusing the authority rather than restating it is what guarantees the
    // picker and the transcript agree about who may see whom.
    assert.match(selector, /const guard = await requireResultAccess\(\)/);
    assert.match(selector, /if \(!guard\.granted\) return guard\.response/);
    assert.ok(
      !/requireRole\(/.test(code(selector)),
      "a second role list here would drift from the transcript's"
    );
  });

  it("RESULT_READ_ANY_ROLES — which that guard consults — admits the COE", () => {
    const start = resultRoles.indexOf("export const RESULT_READ_ANY_ROLES");
    const block = resultRoles.slice(start, resultRoles.indexOf("]", start));

    assert.match(block, /CONTROLLER_OF_EXAMINATION/);
  });

  it("it returns id, name and enrolment number", () => {
    assert.match(selector, /id: student\.id/);
    assert.match(selector, /enrollmentNo: student\.enrollmentNo/);
    assert.match(selector, /name:/);
  });

  it("the name is joined from the User, which the registry listing never gave", () => {
    assert.match(selector, /user: \{ select: \{ firstName: true, lastName: true, displayName: true \} \}/);
  });

  it("it returns ONLY those three — not the registry's projection", () => {
    // programmeId, batchId, sectionId, currentSemester, admissionDate and the
    // rest are exactly what the examination office has no business reading.
    const select = selector.slice(
      selector.indexOf("const SELECTOR_SELECT"),
      selector.indexOf("} as const", selector.indexOf("const SELECTOR_SELECT"))
    );

    for (const forbidden of [
      "programmeId",
      "batchId",
      "sectionId",
      "specialisationId",
      "currentSemester",
      "admissionDate",
      "graduationDate",
      "userId",
    ]) {
      assert.ok(!new RegExp(`${forbidden}: true`).test(select), `${forbidden} must not be returned`);
    }
  });
});

// ============================================================================
// 3 / 6 / 8 — SCOPE AND ISOLATION
// ============================================================================

describe("#48 — every scope is applied, and the tenant leads all of them", () => {
  it("the tenant comes from requireTenant, never the request", () => {
    assert.match(selector, /const tenantGuard = await requireTenant\(\)/);
    assert.match(selector, /const tenantId = tenantGuard\.tenant\.id/);
    assert.ok(!/tenantId: (parsed|query|body|input|request)/.test(selector));
  });

  it("the route accepts NO client input at all", () => {
    // With no parameter there is no filter for a forged value to widen. This is
    // why the handler takes no arguments.
    assert.match(selector, /export async function GET\(\)/);
    assert.ok(!/searchParams/.test(code(selector)));
    assert.ok(!/await request\.json\(\)/.test(code(selector)));
  });

  it("the tenant predicate leads the default predicate", () => {
    assert.match(selector, /let where: Prisma\.StudentWhereInput = \{ tenantId \}/);
  });

  it("OWN is confined to the caller's own user id", () => {
    // A student picks themselves or nobody.
    assert.match(selector, /if \(access\.scope === "OWN"\)/);
    assert.match(selector, /where = \{ tenantId, userId: access\.userId \}/);
  });

  it("DEPARTMENT is confined to that department's programmes", () => {
    assert.match(selector, /access\.scope === "DEPARTMENT"/);
    assert.match(selector, /programmeIdsForDepartment\(tenantId, access\.departmentId\)/);
    assert.match(selector, /where = \{ tenantId, programmeId: \{ in: programmeIds \} \}/);
  });

  it("the department id comes from the SESSION, through the guard", () => {
    // requireResultAccess resolves it via resolveDepartmentScope from the
    // authenticated subject; nothing here reads it from the caller.
    assert.match(selector, /access\.departmentId/);
    assert.ok(!/departmentId: (parsed|query|body)/.test(selector));
  });

  it("it mirrors the confinement result.service applies per student", () => {
    // If these two ever disagree, the picker offers a student whose transcript
    // is then refused — which is the failure this design exists to prevent.
    assert.match(resultService, /access\.scope === "OWN"/);
    assert.match(resultService, /access\.scope === "DEPARTMENT"/);
    assert.match(resultService, /departmentOwnsProgramme\(/);
  });

  it("the result list is bounded", () => {
    assert.match(selector, /take: MAX_OPTIONS/);
  });
});

// ============================================================================
// 5 / 7 — THE SCREENS
// ============================================================================

describe("#48 — the Transcript page uses it, and HOD behaviour is preserved", () => {
  it("it no longer reads the student registry", () => {
    assert.ok(
      !/listStudents/.test(transcriptPage),
      "the registry listing is what excluded the examination office"
    );
    assert.ok(!/@\/services\/students/.test(transcriptPage));
  });

  it("it reads the result-scoped selector instead", () => {
    assert.match(transcriptPage, /import \{ getTranscript, listResultStudents \} from "@\/services\/evaluation"/);
    assert.match(transcriptPage, /await listResultStudents\(\)/);
  });

  it("the option shows the name AND the enrolment number", () => {
    // "students along with their Enrollment Numbers", as reported.
    assert.match(transcriptPage, /label: `\$\{student\.name\} — \$\{student\.enrollmentNo\}`/);
  });

  it("selecting a student still loads the SAME transcript API", () => {
    // No duplicate transcript implementation: the flow is unchanged below the
    // picker.
    assert.match(transcriptPage, /paramKey="studentId"/);
    assert.match(transcriptPage, /await getTranscript\(studentId\)/);
  });

  it("the empty and failure states are unchanged", () => {
    assert.match(transcriptPage, /title="Choose a student"/);
    assert.match(transcriptPage, /resolveFailureState\(result\)/);
  });
});

describe("#48 — the Student Results page picker gets the same fix", () => {
  it("it too reads the result-scoped selector", () => {
    // Same screen family, same gap: this page is reachable by the COE and its
    // picker was filled from the registry.
    assert.match(studentResultsPage, /await listResultStudents\(\)/);
    assert.ok(!/listStudents/.test(studentResultsPage));
  });

  it("and shows name plus enrolment number", () => {
    assert.match(studentResultsPage, /label: `\$\{student\.name\} — \$\{student\.enrollmentNo\}`/);
  });

  it("its result call is unchanged", () => {
    assert.match(studentResultsPage, /await getStudentResult\(studentId\)/);
  });
});

describe("#48 — the service layer", () => {
  it("listResultStudents reads the new endpoint", () => {
    assert.match(evaluationService, /apiRequest<\{ students: ResultStudentOption\[\] \}>\(\s*"\/api\/results\/students"\s*\)/);
  });

  it("it exposes exactly the three fields the picker needs", () => {
    const iface = evaluationService.slice(
      evaluationService.indexOf("export interface ResultStudentOption"),
      evaluationService.indexOf("}", evaluationService.indexOf("export interface ResultStudentOption"))
    );

    assert.match(iface, /id: string/);
    assert.match(iface, /name: string/);
    assert.match(iface, /enrollmentNo: string/);
    assert.ok(!/programmeId|batchId|admissionDate/.test(iface));
  });

  it("no duplicate transcript service was added", () => {
    assert.equal(
      (evaluationService.match(/export async function getTranscript/g) ?? []).length,
      1
    );
  });
});

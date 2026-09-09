// ============================================================================
// TESTS: Semester Result Approval — PRD §17.4 · §49.4 stage 8.
//
// WHAT THE STATE WAS
//   Nothing recorded that a human had approved a cohort. A semester result is
//   COMPUTED on every request from CourseRegistration and persists nothing, so
//   there was no row to carry a sign-off — and ResultPublicationStatus, created
//   by the Phase 16 migration, sat in Postgres attached to no column at all.
//
//   Approval could not be derived the way publication is. C6.3 records that
//   publication "DELIBERATELY GETS NO NEW TABLE" because it IS derivable — a
//   result is publishable exactly when every sitting feeding it is PUBLISHED.
//   Approval is an act: WHO signed off and WHEN are the two facts it exists to
//   record, and no arrangement of marks recomputes them.
//
// The service's own behaviour is exercised for real against an injected fake
// repository — no database, no request context. The route's guards are pinned
// as source contracts, and the live role matrix is verified separately against
// the running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RESULT_MESSAGE,
  SEMESTER_APPROVAL_TARGET_STATUS,
  SEMESTER_APPROVAL_TERMINAL_STATUSES,
  SEMESTER_RESULT_APPROVE_ROLES,
  SEMESTER_RESULT_READ_ROLES,
  RESULT_READ_ANY_ROLES,
} from "./constants/result";
import { approveSemesterResultSchema } from "./validations/result";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with comments stripped, for "this is gone" assertions. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * One method's body, bounded by the next method's declaration.
 *
 * Slicing to end-of-file would sweep in every later method and make a "this
 * name does not appear" assertion pass or fail for reasons elsewhere.
 */
function method(source: string, name: string): string {
  const start = source.indexOf(`async ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = source.slice(start + 1).search(/\n {2}(?:private |protected )?async \w+\(/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

const approveRoute = read("app/api/results/semester/[semesterId]/approve/route.ts");
const readRoute = read("app/api/results/semester/[semesterId]/route.ts");
const service = read("lib/services/result.service.ts");
const repository = read("lib/repositories/result.repository.ts");
const page = read("app/(university)/evaluation/results/semester/page.tsx");
const button = read("app/(university)/evaluation/results/semester/ApproveResultButton.tsx");
const actions = read("actions/evaluation.ts");
const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260906000000_semester_result_approval/migration.sql"
);

// ============================================================================
// The authorization matrix
// ============================================================================

describe("only the Controller of Examination may approve", () => {
  it("the approve set is COE and nothing else", () => {
    assert.deepEqual([...SEMESTER_RESULT_APPROVE_ROLES], ["CONTROLLER_OF_EXAMINATION"]);
  });

  it("UNIVERSITY_ADMIN reads the cohort report but does NOT approve", () => {
    // The confirmed product decision, pinned so widening it must be deliberate.
    const approve = SEMESTER_RESULT_APPROVE_ROLES as readonly string[];
    const readRoles = SEMESTER_RESULT_READ_ROLES as readonly string[];

    assert.ok(readRoles.includes("UNIVERSITY_ADMIN"), "admin still reads");
    assert.ok(!approve.includes("UNIVERSITY_ADMIN"), "admin does NOT approve");
  });

  it("DEPARTMENT_HOD can neither read the cohort report nor approve", () => {
    const approve = SEMESTER_RESULT_APPROVE_ROLES as readonly string[];
    const readRoles = SEMESTER_RESULT_READ_ROLES as readonly string[];

    assert.ok(!readRoles.includes("DEPARTMENT_HOD"), "no cohort read — unchanged");
    assert.ok(!approve.includes("DEPARTMENT_HOD"));
  });

  it("HOD's EXISTING per-student result access is untouched", () => {
    // This task must not narrow what a head of department already had.
    assert.ok((RESULT_READ_ANY_ROLES as readonly string[]).includes("DEPARTMENT_HOD"));
  });

  it("FACULTY, STUDENT and PARENT reach neither set", () => {
    const approve = SEMESTER_RESULT_APPROVE_ROLES as readonly string[];
    const readRoles = SEMESTER_RESULT_READ_ROLES as readonly string[];

    for (const role of ["FACULTY", "STUDENT", "PARENT"]) {
      assert.ok(!approve.includes(role), `${role} must not approve`);
      assert.ok(!readRoles.includes(role), `${role} must not read the cohort`);
    }
  });

  it("the read endpoint's own role set did not move", () => {
    assert.deepEqual(
      [...SEMESTER_RESULT_READ_ROLES],
      ["UNIVERSITY_ADMIN", "CONTROLLER_OF_EXAMINATION"]
    );
    assert.match(readRoute, /requireRole\(\.\.\.SEMESTER_RESULT_READ_ROLES\)/);
  });
});

describe("the endpoint enforces it server-side", () => {
  it("POST applies SEMESTER_RESULT_APPROVE_ROLES before anything else", () => {
    assert.match(approveRoute, /export async function POST\(/);
    assert.match(approveRoute, /requireRole\(\.\.\.SEMESTER_RESULT_APPROVE_ROLES\)/);
    assert.match(approveRoute, /if \(!guard\.authorized\) return guard\.response/);

    // Role, then tenant — so a 403 never confirms a tenant, and an anonymous
    // caller gets requireAuth's 401 from the guard rather than a 404.
    const role = approveRoute.indexOf("requireRole");
    const tenant = approveRoute.indexOf("requireTenant");
    assert.ok(role > 0 && tenant > role);
  });

  it("it names no role inline — the constant is the only source", () => {
    assert.ok(!/requireRole\("/.test(code(approveRoute)));
  });

  it("the approver is the authenticated subject, never a body field", () => {
    assert.match(approveRoute, /guard\.session\.sub/);
    assert.ok(
      !/approvedById:\s*(parsedBody|body|rawBody)/.test(code(approveRoute)),
      "approvedById must never come from the request"
    );
  });

  it("the tenant comes from requireTenant, never from the request", () => {
    assert.match(approveRoute, /tenantGuard\.tenant\.id/);
    assert.ok(!/tenantId: (parsedBody|body|rawBody|parsedParam)/.test(code(approveRoute)));
  });

  it("the semester id comes from the route param, not the body", () => {
    assert.match(approveRoute, /semesterResultParamSchema\.safeParse\(await context\.params\)/);
    assert.match(approveRoute, /parsedParam\.data\.semesterId/);
  });
});

describe("the body schema refuses to let a client dictate the decision", () => {
  it("strips status, approvedAt, approvedById and semesterId", () => {
    const parsed = approveSemesterResultSchema.safeParse({
      status: "PUBLISHED",
      approvedAt: "2020-01-01T00:00:00.000Z",
      approvedById: "someone_else",
      semesterId: "another_semester",
      tenantId: "another_tenant",
      remarks: "Signed off.",
    });

    assert.equal(parsed.success, true);
    for (const key of [
      "status",
      "approvedAt",
      "approvedById",
      "semesterId",
      "tenantId",
    ]) {
      assert.ok(!(key in parsed.data!), `${key} must not be settable`);
    }
    assert.equal(parsed.data!.remarks, "Signed off.");
  });

  it("an empty body is valid — the ordinary approval carries no remark", () => {
    const parsed = approveSemesterResultSchema.safeParse({});
    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.remarks, undefined);
  });

  it("a blank remark is stored as absence, not as an empty string", () => {
    assert.equal(approveSemesterResultSchema.safeParse({ remarks: "   " }).data!.remarks, undefined);
  });

  it("the route treats a missing body as an empty one rather than a 400", () => {
    assert.match(approveRoute, /rawBody = \(await request\.json\(\)\) \?\? \{\}/);
    assert.match(approveRoute, /catch \{[\s\S]{0,40}rawBody = \{\}/);
  });
});

// ============================================================================
// Persistence — the schema and the migration
// ============================================================================

describe("approval state is durable, and reuses the existing enum", () => {
  it("the model exists with one row per (tenant, semester)", () => {
    assert.match(schema, /model SemesterResultApproval \{/);
    assert.match(schema, /@@unique\(\[tenantId, semesterId\]\)/);
  });

  it("it stores the actor and the timestamp — the two facts a sign-off is", () => {
    const model = schema.slice(
      schema.indexOf("model SemesterResultApproval {"),
      schema.indexOf("}", schema.indexOf("model SemesterResultApproval {"))
    );

    assert.match(model, /approvedAt\s+DateTime\?/);
    assert.match(model, /approvedById\s+String\?/);
    assert.match(model, /status\s+ResultPublicationStatus\s+@default\(DRAFT\)/);
    assert.match(model, /remarks\s+String\?/);
  });

  it("it reuses ResultPublicationStatus rather than declaring a second enum", () => {
    // The enum existed and was attached to nothing. This is what finally uses
    // it — a parallel lifecycle vocabulary is exactly what the brief forbade.
    const enums = [...schema.matchAll(/enum (\w*(?:Approval|Publication)\w*) \{/g)].map(
      (m) => m[1]
    );
    assert.deepEqual(enums, ["ResultPublicationStatus"], "no second lifecycle enum");
  });

  it("the migration is additive and does NOT re-create the enum", () => {
    assert.match(migration, /CREATE TABLE "SemesterResultApproval"/);
    assert.ok(
      !/CREATE TYPE "ResultPublicationStatus"/.test(migration),
      "the type already exists — re-creating it would fail with 42710"
    );
    // SQL comments stripped first: the header legitimately says "rolling back
    // is a single DROP TABLE", which is documentation, not a statement.
    const statements = migration.replace(/^\s*--.*$/gm, "");
    assert.ok(
      !/DROP |ALTER COLUMN|DELETE FROM|TRUNCATE/.test(statements),
      "nothing existing is touched"
    );
  });

  it("the foreign keys protect the sign-off and survive a user deletion", () => {
    assert.match(migration, /"SemesterResultApproval_semesterId_fkey"[\s\S]{0,120}ON DELETE NO ACTION/);
    assert.match(migration, /"SemesterResultApproval_approvedById_fkey"[\s\S]{0,120}ON DELETE SET NULL/);
  });

  it("the write is the only place APPROVED is stored, and it is transactional", () => {
    assert.match(repository, /async approveSemesterResult\(/);
    assert.match(repository, /prisma\.\$transaction\(async \(tx\) =>/);
    // The guard is re-read INSIDE the transaction, so two controllers pressing
    // Approve together cannot both write.
    assert.match(repository, /tx\.semesterResultApproval\.findFirst\(/);
    assert.match(repository, /input\.terminalStatuses\.includes\(existing\.status\)/);
  });

  it("every repository read of the approval is tenant-scoped", () => {
    assert.match(repository, /where: \{ tenantId, semesterId \}/);
    assert.match(repository, /where: \{ tenantId: input\.tenantId, semesterId: input\.semesterId \}/);
  });
});

// ============================================================================
// Lifecycle
// ============================================================================

describe("approval is a stage, not publication", () => {
  it("it writes APPROVED", () => {
    assert.equal(SEMESTER_APPROVAL_TARGET_STATUS, "APPROVED");
  });

  it("it NEVER writes PUBLISHED — §49.4 keeps the stages apart", () => {
    assert.notEqual(SEMESTER_APPROVAL_TARGET_STATUS, "PUBLISHED");
    // Nothing in the service or the route may set it.
    assert.ok(!/["']PUBLISHED["']/.test(code(approveRoute)));
    assert.ok(
      !/status:\s*ResultPublicationStatus\.PUBLISHED/.test(code(service)),
      "approval must not publish"
    );
  });

  it("both terminal statuses refuse a second approval", () => {
    assert.deepEqual([...SEMESTER_APPROVAL_TERMINAL_STATUSES], ["APPROVED", "PUBLISHED"]);
  });

  it("a re-approval is a 409, not a silent success", () => {
    assert.match(service, /RESULT_MESSAGE\.ALREADY_APPROVED/);
    assert.match(service, /HTTP_STATUS\.CONFLICT/);
    assert.equal(
      RESULT_MESSAGE.ALREADY_APPROVED,
      "This semester's result has already been approved"
    );
  });
});

// ============================================================================
// The precondition
// ============================================================================

describe("the approval precondition uses existing computed state only", () => {
  it("it reuses getSemesterResult rather than recomputing anything", () => {
    // So a sign-off can never be granted against a different computation from
    // the one the controller was looking at — and the tenant-scoped 404 comes
    // from that shared path rather than a second lookup.
    assert.match(service, /const result = await this\.getSemesterResult\(tenantId, semesterId\)/);
  });

  it("a cohort with engine failures is refused with 409", () => {
    assert.match(service, /if \(result\.failures\.length > 0\)/);
    assert.match(service, /RESULT_MESSAGE\.APPROVAL_HAS_FAILURES/);
  });

  it("an empty cohort is refused with 409", () => {
    assert.match(service, /if \(result\.students\.length === 0\)/);
    assert.match(service, /RESULT_MESSAGE\.APPROVAL_EMPTY_COHORT/);
  });

  it("NO new moderation state machine was invented", () => {
    // `failures` is batchFailures(outcome) — existing engine output. No
    // AssessmentEvent status is consulted, because no moderation stage exists
    // to read and a sitting outside the semester's registrations is outside
    // the calculation's scope entirely.
    const approve = method(service, "approveSemesterResult");
    assert.ok(!/AssessmentEventStatus|acceptsMarks|LOCKED/.test(approve));
  });

  it("a failed or backlogged STUDENT does not block approval", () => {
    // An academic failure is a computed outcome, not an engine failure. Only
    // `failures` — students the engine could not compute — blocks.
    const approve = method(service, "approveSemesterResult");
    assert.ok(!/isPromoted|backlogCount|statistics\.failed/.test(approve));
  });
});

// ============================================================================
// The DTO — additive, and the existing computation untouched
// ============================================================================

describe("the cohort report gained approval state and lost nothing", () => {
  it("every existing field is still computed the same way", () => {
    for (const field of [
      "statistics:",
      "gradeDistribution:",
      "meritList:",
      "failures:",
      "students:",
    ]) {
      assert.ok(service.includes(field), `${field} must still be produced`);
    }
  });

  it("the approval is READ, never computed into the statistics", () => {
    assert.match(service, /const approval = await this\.repository\.findSemesterApproval\(/);
    // It is attached at the end of the returned object, after every computed
    // field, and feeds none of them.
    const statsAt = service.indexOf("summariseCohort(members, policy)");
    const approvalAt = service.indexOf("approval: this.toApprovalDTO(");
    assert.ok(statsAt > 0 && approvalAt > statsAt);
  });

  it("no row means DRAFT — absence and DRAFT are the same state", () => {
    assert.match(service, /row\?\.status \?\? ResultPublicationStatus\.DRAFT/);
  });

  it("canApprove is derived from the SAME two preconditions the service enforces", () => {
    assert.match(service, /!SEMESTER_APPROVAL_TERMINAL_STATUSES\.includes\(status\)/);
    assert.match(service, /cohort\.failureCount === 0/);
    assert.match(service, /cohort\.cohortSize > 0/);
  });
});

// ============================================================================
// UI
// ============================================================================

describe("the Semester Results page shows the action to COE only", () => {
  it("the button is gated on SEMESTER_RESULT_APPROVE_ROLES", () => {
    assert.match(
      page,
      /hasAnyRole\(session\?\.roles \?\? \[\], SEMESTER_RESULT_APPROVE_ROLES\)/
    );
    assert.match(page, /\{canApprove && \(/);
    assert.match(page, /<ApproveResultButton/);
  });

  it("it imports the SAME constant the endpoint applies", () => {
    assert.match(
      page,
      /import \{ SEMESTER_RESULT_APPROVE_ROLES \} from "@\/lib\/constants\/result"/
    );
  });

  it("roles come from the session, never from the URL", () => {
    assert.match(page, /getPortalSession\(\)/);
    assert.ok(!/roles.*searchParams|searchParams.*roles/i.test(code(page)));
  });

  it("the approval STATUS is shown to every reader, not only to the approver", () => {
    // A university admin must still see whether the result was signed off.
    const statusAt = page.indexOf("Result approval");
    const gateAt = page.indexOf("{canApprove && (");
    assert.ok(statusAt > 0 && gateAt > statusAt, "status renders before the gated action");
  });

  it("it confirms, reports and refreshes", () => {
    assert.match(button, /<ConfirmDialog/);
    assert.match(button, /confirmLabel="Approve"/);
    assert.match(button, /toast\(\{ variant: "success"/);
    assert.match(button, /router\.refresh\(\)/);
  });

  it("the confirmation says approval does not publish", () => {
    assert.match(button, /does NOT publish/i);
  });

  it("the button is disabled — with a reason — when the cohort cannot be approved", () => {
    assert.match(button, /disabled=\{!canApprove\}/);
    assert.match(button, /blockedReason/);
    assert.match(page, /already been approved/);
  });

  it("the semester id is bound on the server, not chosen by the browser", () => {
    assert.match(button, /approveSemesterResultAction\(semesterId\)/);
    assert.match(page, /semesterId=\{activeSemesterId\}/);
  });

  it("the existing dashboard was not redesigned", () => {
    // The statistics, distribution, merit list and failure alert all survive.
    for (const marker of [
      "Pass rate",
      "Average SGPA",
      "Grade distribution",
      "could not be computed",
    ]) {
      assert.ok(page.includes(marker), `${marker} must still render`);
    }
  });
});

describe("the action delegates rather than re-deciding", () => {
  it("it states no authorization and no precondition of its own", () => {
    const approveAction = actions.slice(actions.indexOf("approveSemesterResultAction"));
    assert.ok(!/requireRole|hasAnyRole|SEMESTER_RESULT_APPROVE_ROLES/.test(code(approveAction)));
    assert.ok(!/failures|students\.length/.test(code(approveAction)));
  });

  it("it sends no tenant, no user and no status", () => {
    const approveAction = actions.slice(actions.indexOf("export async function approveSemesterResultAction"));
    const stripped = code(approveAction);
    assert.ok(!/tenantId/.test(stripped));
    assert.ok(!/approvedById|session\./.test(stripped));
    assert.ok(!/status:/.test(stripped));
  });

  it("the route file exists at the dedicated approval path", () => {
    assert.ok(
      existsSync(
        join(process.cwd(), "app/api/results/semester/[semesterId]/approve/route.ts")
      )
    );
  });
});

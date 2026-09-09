// ============================================================================
// TESTS: Evaluation Scheme management, across the whole role matrix.
//
// WHAT WAS WRONG
//   Nothing in the API. Every scheme mutation has been gated on
//   EVALUATION_SCHEME_MANAGE_ROLES — UNIVERSITY_ADMIN and
//   CONTROLLER_OF_EXAMINATION — since the module was written, and every read on
//   EVALUATION_SCHEME_READ_ROLES, which adds DEPARTMENT_HOD and FACULTY.
//
//   The client stack simply never called any of it. services/evaluation.ts
//   exposed reads plus two lifecycle calls that NOTHING invoked; there were no
//   server actions; and neither the list page nor the detail page rendered a
//   single control. So the module presented as read-only to EVERY role,
//   including University Admin — the COE was not specially blocked, the
//   management surface did not exist.
//
//   A second, independent blocker sat underneath: createEvaluationSchemeSchema
//   requires gradeScaleId, and GradeScale had no route, controller, service or
//   validation anywhere. No client could resolve a legal value, so "create a
//   scheme" was unreachable even with a button.
//
// The routes reach a database and this suite has none (see package.json), so
// route guarantees are pinned as source contracts. The role constants, the
// schemas and the field modules are exercised for real — they need nothing.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "./constants/evaluationScheme";
import { ASSESSMENT_EVENT_MANAGE_ROLES } from "./constants/assessmentEvent";
import { MODULE_API_RULES } from "./constants/moduleRoutes";
import {
  createEvaluationSchemeSchema,
  updateEvaluationSchemeSchema,
} from "./validations/evaluationScheme";
import {
  FORM_AUTHORABLE_RULE_OPERATIONS,
  NONE_VALUE,
  componentEditValues,
  isFormAuthorableRule,
  ruleEditValues,
  schemeFields,
} from "@/components/shared/evaluationSchemeFields";
import type { EvaluationRuleDTO } from "@/lib/dto/evaluationRule.dto";
import type { EvaluationComponentDTO } from "@/lib/dto/evaluationComponent.dto";

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

const API = "app/api/evaluation-schemes";

const routes = {
  collection: read(`${API}/route.ts`),
  detail: read(`${API}/[id]/route.ts`),
  activate: read(`${API}/[id]/activate/route.ts`),
  archive: read(`${API}/[id]/archive/route.ts`),
  components: read(`${API}/[id]/components/route.ts`),
  component: read(`${API}/[id]/components/[componentId]/route.ts`),
  rules: read(`${API}/[id]/rules/route.ts`),
  rule: read(`${API}/[id]/rules/[ruleId]/route.ts`),
  criteria: read(`${API}/[id]/passing-criteria/route.ts`),
  criterion: read(`${API}/[id]/passing-criteria/[criterionId]/route.ts`),
};

const gradeScalesRoute = read("app/api/grade-scales/route.ts");
const listPage = read("app/(university)/evaluation/schemes/page.tsx");
const detailPage = read("app/(university)/evaluation/schemes/[id]/page.tsx");
const lifecycle = read("app/(university)/evaluation/schemes/[id]/SchemeLifecycleActions.tsx");
const actions = read("actions/evaluation.ts");
const service = read("services/evaluation.ts");
const fields = read("components/shared/evaluationSchemeFields.ts");

/** Every mutation handler in the module, as (file, handler) pairs. */
const MUTATIONS: ReadonlyArray<readonly [string, string, string]> = [
  ["collection", routes.collection, "POST"],
  ["detail", routes.detail, "PATCH"],
  ["detail", routes.detail, "DELETE"],
  ["activate", routes.activate, "POST"],
  ["archive", routes.archive, "POST"],
  ["components", routes.components, "POST"],
  ["component", routes.component, "PATCH"],
  ["component", routes.component, "DELETE"],
  ["rules", routes.rules, "POST"],
  ["rule", routes.rule, "PATCH"],
  ["rule", routes.rule, "DELETE"],
  ["criteria", routes.criteria, "POST"],
  ["criterion", routes.criterion, "PATCH"],
  ["criterion", routes.criterion, "DELETE"],
];

/** Every read handler in the module. */
const READS: ReadonlyArray<readonly [string, string, string]> = [
  ["collection", routes.collection, "GET"],
  ["detail", routes.detail, "GET"],
  ["components", routes.components, "GET"],
  ["component", routes.component, "GET"],
  ["rules", routes.rules, "GET"],
  ["rule", routes.rule, "GET"],
  ["criteria", routes.criteria, "GET"],
  ["criterion", routes.criterion, "GET"],
];

// ============================================================================
// The role matrix itself
// ============================================================================

describe("the Scheme role matrix", () => {
  it("UNIVERSITY_ADMIN and CONTROLLER_OF_EXAMINATION manage — and only they", () => {
    assert.deepEqual(
      [...EVALUATION_SCHEME_MANAGE_ROLES],
      ["UNIVERSITY_ADMIN", "CONTROLLER_OF_EXAMINATION"]
    );
  });

  it("the COE holds exactly the same management capability as the admin", () => {
    // The point of the whole task: no separate, narrower COE set exists, and
    // nothing may introduce one. Both roles pass the single guard or neither
    // does, so "use an admin login instead" can never be the workaround.
    const manage = EVALUATION_SCHEME_MANAGE_ROLES as readonly string[];
    assert.ok(manage.includes("UNIVERSITY_ADMIN"));
    assert.ok(manage.includes("CONTROLLER_OF_EXAMINATION"));
    assert.equal(manage.length, 2);
  });

  it("DEPARTMENT_HOD and FACULTY read, and are NOT in the manage set", () => {
    const readRoles = EVALUATION_SCHEME_READ_ROLES as readonly string[];
    const manage = EVALUATION_SCHEME_MANAGE_ROLES as readonly string[];

    for (const role of ["DEPARTMENT_HOD", "FACULTY"]) {
      assert.ok(readRoles.includes(role), `${role} must read`);
      assert.ok(!manage.includes(role), `${role} must NOT manage`);
    }
  });

  it("the read set is the manage set plus the two readers — never a separate list", () => {
    // Spread, not restated: widening manage automatically widens read, and the
    // two can never disagree about who may at least look.
    assert.deepEqual(
      [...EVALUATION_SCHEME_READ_ROLES],
      [...EVALUATION_SCHEME_MANAGE_ROLES, "DEPARTMENT_HOD", "FACULTY"]
    );
  });

  it("STUDENT and PARENT reach nothing — read or write", () => {
    const readRoles = EVALUATION_SCHEME_READ_ROLES as readonly string[];
    assert.ok(!readRoles.includes("STUDENT"));
    assert.ok(!readRoles.includes("PARENT"));
  });
});

// ============================================================================
// D — backend security, every mutation and every read
// ============================================================================

describe("every Scheme MUTATION is gated on the manage roles", () => {
  for (const [file, source, method] of MUTATIONS) {
    it(`${method} ${file} applies EVALUATION_SCHEME_MANAGE_ROLES`, () => {
      const body = handler(source, method);
      assert.match(
        body,
        /const guard = await requireRole\(\.\.\.EVALUATION_SCHEME_MANAGE_ROLES\)/,
        `${method} ${file} must apply the manage roles`
      );
      assert.match(body, /if \(!guard\.authorized\) return guard\.response/);
      // No inline role list anywhere: a hand-written set beside the constant is
      // how the two drift.
      assert.ok(
        !/requireRole\("/.test(code(body)),
        `${method} ${file} must not name roles inline`
      );
    });
  }

  it("that is every mutation the module exposes — none was missed", () => {
    // Guards against a new mutation handler landing unguarded: the count here
    // must move whenever the module gains or loses one.
    const found = Object.values(routes).flatMap((source) =>
      [...source.matchAll(/export async function (POST|PATCH|DELETE)\(/g)].map((m) => m[1])
    );
    assert.equal(found.length, MUTATIONS.length);
  });
});

describe("every Scheme READ is gated on the read roles", () => {
  for (const [file, source, method] of READS) {
    it(`${method} ${file} applies EVALUATION_SCHEME_READ_ROLES`, () => {
      assert.match(
        handler(source, method),
        /const guard = await requireRole\(\.\.\.EVALUATION_SCHEME_READ_ROLES\)/,
        `${method} ${file} must apply the read roles`
      );
    });
  }
});

describe("tenant isolation and validation semantics are unchanged", () => {
  it("every handler resolves the tenant from the session, never from the client", () => {
    for (const [file, source] of Object.entries(routes)) {
      assert.match(
        source,
        /const tenantGuard = await requireTenant\(\)/,
        `${file} must resolve its own tenant`
      );
      assert.match(source, /tenantGuard\.tenant\.id/);
      assert.ok(
        !/tenantId: (parsedBody|parsed|body|input|query)/.test(code(source)),
        `${file} must never take a tenantId from the request`
      );
    }
  });

  it("the module gate still runs after role and tenant on every route", () => {
    for (const [file, source] of Object.entries(routes)) {
      assert.match(
        source,
        /requireModule\(tenantGuard\.tenant\.id, request\.nextUrl\.pathname\)/,
        `${file} must keep its module gate`
      );
    }
  });

  it("the guard order is role, then tenant — so a 403 never confirms a tenant", () => {
    for (const [file, source, method] of [...MUTATIONS, ...READS]) {
      const body = handler(source, method);
      const role = body.indexOf("requireRole");
      const tenant = body.indexOf("requireTenant");
      assert.ok(role > 0 && tenant > role, `${method} ${file} must authorise first`);
    }
  });
});

// ============================================================================
// The second blocker: GradeScale had no endpoint at all
// ============================================================================

describe("the grade-scale lookup that made creation possible", () => {
  it("the route exists", () => {
    assert.ok(existsSync(join(process.cwd(), "app/api/grade-scales/route.ts")));
  });

  it("it is READ-ONLY — no mutation handler is exported", () => {
    // It exists solely so a form can resolve the required gradeScaleId.
    // Authoring a grade scale stays outside this project's API surface.
    assert.ok(!/export async function (POST|PATCH|PUT|DELETE)\(/.test(gradeScalesRoute));
    assert.match(gradeScalesRoute, /export async function GET\(/);
  });

  it("it is gated on the SCHEMES' own read set, not a wider one", () => {
    assert.match(
      gradeScalesRoute,
      /const guard = await requireRole\(\.\.\.EVALUATION_SCHEME_READ_ROLES\)/
    );
  });

  it("it is tenant-scoped and takes no client input", () => {
    assert.match(gradeScalesRoute, /tenantId: tenantGuard\.tenant\.id/);
    assert.ok(
      !/searchParams|safeParse/.test(code(gradeScalesRoute)),
      "there is nothing for a client to supply"
    );
  });

  it("it is governed by the same module as the schemes it supports", () => {
    // Leaving it ungoverned would let a university that switched examinations
    // off keep reading the configuration behind its regulations.
    const rule = MODULE_API_RULES.find((r) => r.prefix === "/api/grade-scales");
    assert.ok(rule, "/api/grade-scales must be governed");
    assert.deepEqual([...rule!.modules], ["examinations"]);

    const schemes = MODULE_API_RULES.find((r) => r.prefix === "/api/evaluation-schemes");
    assert.deepEqual([...rule!.modules], [...schemes!.modules]);
  });

  it("the service reads it, which is what makes gradeScaleId resolvable", () => {
    assert.match(service, /export async function listGradeScales/);
    assert.match(service, /apiRequest<\{ gradeScales: GradeScaleOption\[\] \}>\("\/api\/grade-scales"\)/);
  });
});

// ============================================================================
// B — the management UI both roles now see
// ============================================================================

describe("the list page exposes management to the manage roles", () => {
  it("it renders a Create scheme control", () => {
    // The whole defect: the page listed regulations and offered no way to add,
    // amend or discard one — for ANY role.
    assert.match(listPage, /EntityCreateButton/);
    assert.match(listPage, /label="Create scheme"/);
    assert.match(listPage, /action=\{createSchemeAction\}/);
  });

  it("it renders row actions for editing and discarding", () => {
    assert.match(listPage, /EntityRowActions/);
    assert.match(listPage, /updateSchemeAction\.bind\(null, scheme\.id\)/);
    assert.match(listPage, /deleteSchemeAction\.bind\(null, scheme\.id\)/);
  });

  it("every control is gated on EVALUATION_SCHEME_MANAGE_ROLES", () => {
    assert.match(
      listPage,
      /hasAnyRole\(session\?\.roles \?\? \[\], EVALUATION_SCHEME_MANAGE_ROLES\)/
    );
    assert.match(listPage, /canCreate \? \(/);
    // The actions COLUMN itself is withheld, not just its contents — a reader's
    // table does not gain an empty sixth column.
    assert.match(listPage, /\.\.\.\(canManage\s*\?/);
  });

  it("the gate reads the SAME constant the endpoints apply", () => {
    assert.match(
      listPage,
      /import \{ EVALUATION_SCHEME_MANAGE_ROLES \} from "@\/lib\/constants\/evaluationScheme"/
    );
  });

  it("roles come from the session, never from the URL", () => {
    assert.match(listPage, /const session = await getPortalSession\(\)/);
    assert.ok(!/roles.*searchParams|searchParams.*roles/i.test(code(listPage)));
  });

  it("the existing status filter and pagination still work", () => {
    assert.match(listPage, /<ListFilter/);
    assert.match(listPage, /paramKey="status"/);
    assert.match(listPage, /<Pagination/);
    assert.match(listPage, /listSchemes\(\{/);
  });

  it("amending and discarding are offered only on a DRAFT", () => {
    // An ACTIVE or ARCHIVED revision is part of the historical record; the
    // endpoints answer 409 and the row must not offer what cannot succeed.
    assert.match(listPage, /scheme\.status === "DRAFT"[\s\S]{0,120}schemeFields/);
    assert.match(
      listPage,
      /onDelete=\{\s*scheme\.status === "DRAFT"/
    );
  });
});

describe("the detail page exposes the lifecycle and the sub-collections", () => {
  it("it gates on the same constant, from the session", () => {
    assert.match(
      detailPage,
      /hasAnyRole\(session\?\.roles \?\? \[\], EVALUATION_SCHEME_MANAGE_ROLES\)/
    );
    assert.match(detailPage, /const session = await getPortalSession\(\)/);
  });

  it("it offers the two lifecycle transitions the model has", () => {
    assert.match(detailPage, /<SchemeLifecycleActions/);
    assert.match(lifecycle, /activateSchemeAction\(schemeId\)/);
    assert.match(lifecycle, /archiveSchemeAction\(schemeId\)/);
  });

  it("ARCHIVED is terminal, so it renders no transition at all", () => {
    assert.match(lifecycle, /if \(status === "ARCHIVED"\) return null/);
  });

  it("activation is withheld while the component tree does not validate", () => {
    assert.match(detailPage, /canActivate=\{treeResult\.success && treeResult\.data\.validation\.isValid\}/);
  });

  it("it offers add, edit and delete on components, rules and criteria", () => {
    for (const action of [
      "createComponentAction",
      "updateComponentAction",
      "deleteComponentAction",
      "createRuleAction",
      "updateRuleAction",
      "deleteRuleAction",
      "createCriterionAction",
      "updateCriterionAction",
      "deleteCriterionAction",
    ]) {
      assert.ok(detailPage.includes(action), `${action} must be wired up`);
    }
  });

  it("sub-collection editing is withheld unless the scheme is still mutable", () => {
    // isMutable is DERIVED by the backend from the scheme's status and read as
    // given — re-deriving it here would be a second lifecycle implementation.
    assert.match(detailPage, /treeResult\.success && treeResult\.data\.isMutable/);
    assert.match(detailPage, /const canEditContents = canManage && isMutable/);
  });

  it("a rule whose config this form cannot represent is not editable by it", () => {
    // CURVE and CUSTOM_FORMULA carry a nested configuration. Still listed,
    // still deletable — only authoring is out of reach, and that is recorded.
    assert.match(detailPage, /isFormAuthorableRule\(rule\)/);
    assert.match(fields, /CURVE and CUSTOM_FORMULA are deliberately absent/);
  });
});

describe("C — a reader's page keeps its read experience and gains no control", () => {
  it("no control is rendered outside a canManage / canEditContents branch", () => {
    // Hidden, not disabled: the requirement is that a reader does not see them.
    for (const [name, page] of [
      ["list", listPage],
      ["detail", detailPage],
    ] as const) {
      const stripped = code(page);
      const controls = [...stripped.matchAll(/<(EntityCreateButton|EntityRowActions)/g)];
      assert.ok(controls.length > 0, `${name} must render some control`);

      for (const match of controls) {
        // The nearest enclosing guard precedes every control on these pages.
        const before = stripped.slice(0, match.index);
        assert.ok(
          /canManage|canCreate|canEdit(Contents)?\b/.test(
            before.slice(-600)
          ),
          `${name}: a control at ${match.index} is not behind a role gate`
        );
      }
    }
  });

  it("the reader still sees the whole regulation", () => {
    // Settings, components, rules and criteria are rendered unconditionally —
    // read-only means fewer buttons, not less information.
    assert.match(detailPage, /getComponentTree\(id\)/);
    assert.match(detailPage, /getSchemeRules\(id\)/);
    assert.match(detailPage, /getPassingCriteria\(id\)/);
    assert.match(detailPage, /Passing criteria/);
  });

  it("the grade-scale lookup is skipped entirely for a reader", () => {
    assert.match(listPage, /canManage \? listGradeScales\(\) : Promise\.resolve\(null\)/);
  });
});

// ============================================================================
// A — the actions delegate rather than re-deciding
// ============================================================================

describe("the actions state no authorization of their own", () => {
  it("no action re-checks a role or a role set", () => {
    const stripped = code(actions);
    assert.ok(!/requireRole/.test(stripped));
    assert.ok(!/EVALUATION_SCHEME_MANAGE_ROLES/.test(stripped));
    assert.ok(!/hasAnyRole/.test(stripped));
  });

  it("no action sends a tenant id or a user identity", () => {
    const stripped = code(actions);
    assert.ok(!/tenantId/.test(stripped));
    assert.ok(!/userId|createdById|session\./.test(stripped));
  });

  it("every scheme mutation has an action that calls its service function", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["createSchemeAction", "createScheme("],
      ["updateSchemeAction", "updateScheme("],
      ["deleteSchemeAction", "deleteScheme("],
      ["activateSchemeAction", "activateScheme("],
      ["archiveSchemeAction", "archiveScheme("],
      ["createComponentAction", "createComponent("],
      ["updateComponentAction", "updateComponent("],
      ["deleteComponentAction", "deleteComponent("],
      ["createRuleAction", "createRule("],
      ["updateRuleAction", "updateRule("],
      ["deleteRuleAction", "deleteRule("],
      ["createCriterionAction", "createCriterion("],
      ["updateCriterionAction", "updateCriterion("],
      ["deleteCriterionAction", "deleteCriterion("],
    ];

    for (const [action, call] of pairs) {
      assert.ok(actions.includes(`export async function ${action}`), `${action} missing`);
      assert.ok(actions.includes(call), `${action} must delegate to ${call}`);
    }
  });

  it("the lifecycle service calls are no longer dead code", () => {
    // activateScheme and archiveScheme existed and NOTHING invoked them. That
    // is the shape of this whole defect, so it is pinned.
    assert.match(actions, /return activateScheme\(id\)/);
    assert.match(actions, /return archiveScheme\(id\)/);
  });
});

// ============================================================================
// The schemas the forms are built against — exercised for real
// ============================================================================

describe("the Scheme schemas the management forms target", () => {
  const valid = {
    code: "BTECH-R2025",
    name: "B.Tech Regulation 2025",
    gradeScaleId: "gs_1",
  };

  it("accepts a minimal create body", () => {
    assert.equal(createEvaluationSchemeSchema.safeParse(valid).success, true);
  });

  it("requires the grade scale — the field that had no lookup", () => {
    assert.equal(
      createEvaluationSchemeSchema.safeParse({ code: valid.code, name: valid.name })
        .success,
      false
    );
  });

  it("strips server-managed lifecycle fields from any body supplying them", () => {
    const parsed = createEvaluationSchemeSchema.safeParse({
      ...valid,
      status: "ACTIVE",
      version: 9,
      supersededById: "other",
      tenantId: "another-tenant",
    });

    assert.equal(parsed.success, true);
    for (const key of ["status", "version", "supersededById", "tenantId"]) {
      assert.ok(!(key in parsed.data!), `${key} must not be settable`);
    }
  });

  it("refuses to patch the code — it is the identity a revision shares", () => {
    // The name carries EVALUATION_SCHEME_NAME_MIN_LENGTH (2), so a real one is
    // used here — a one-character name would fail for its own reason and prove
    // nothing about the code.
    const parsed = updateEvaluationSchemeSchema.safeParse({
      code: "OTHER",
      name: "Revised regulation",
    });

    assert.equal(parsed.success, true);
    assert.ok(!("code" in parsed.data!));
  });

  it("refuses an empty patch rather than advancing updatedAt for nothing", () => {
    assert.equal(updateEvaluationSchemeSchema.safeParse({}).success, false);
  });
});

// ============================================================================
// The generated forms
// ============================================================================

describe("the Scheme form offers the code on create and never on edit", () => {
  it("create asks for the code", () => {
    const names = schemeFields([{ value: "g", label: "G" }], "create").map((f) => f.name);
    assert.ok(names.includes("code"));
    assert.ok(names.includes("gradeScaleId"));
  });

  it("edit does not — the endpoint would silently discard it", () => {
    const names = schemeFields([{ value: "g", label: "G" }], "edit").map((f) => f.name);
    assert.ok(!names.includes("code"));
    assert.ok(names.includes("name"), "the rest of the form is unchanged");
  });
});

describe("the nullable reference sentinel", () => {
  it("a component with no parent round-trips as the sentinel, not as empty", () => {
    // "" would be indistinguishable from "not yet chosen"; the sentinel is what
    // lets the action send an explicit null, which is what promotes a nested
    // component back to the top level.
    const values = componentEditValues({
      parentComponentId: null,
      aggregation: null,
      rollup: null,
      code: "C",
      name: "N",
      description: null,
      type: "THEORY",
      sourceType: "MANUAL_ENTRY",
      maxMarks: "30",
      weightage: "30",
      sequence: 1,
      isMandatory: true,
    } as unknown as EvaluationComponentDTO);

    assert.equal(values.parentComponentId, NONE_VALUE);
    assert.equal(values.aggregation, NONE_VALUE);
    assert.equal(values.rollup, NONE_VALUE);
  });

  it("the action translates the sentinel back to an explicit null", () => {
    assert.match(actions, /value === "" \|\| value === NONE_VALUE \? null : value/);
  });
});

describe("rule authoring is honest about what it can express", () => {
  it("offers the seven operations whose config is one or two bounded numbers", () => {
    assert.deepEqual(
      [...FORM_AUTHORABLE_RULE_OPERATIONS],
      ["ADD_CONSTANT", "ADD_PERCENTAGE", "SCALE", "CAP", "FLOOR", "GRACE", "MODERATION"]
    );
  });

  it("does not claim to author CURVE or CUSTOM_FORMULA", () => {
    const authorable = FORM_AUTHORABLE_RULE_OPERATIONS as readonly string[];
    assert.ok(!authorable.includes("CURVE"));
    assert.ok(!authorable.includes("CUSTOM_FORMULA"));
  });

  it("a stored rule of either kind is reported as not form-authorable", () => {
    assert.equal(
      isFormAuthorableRule({ operation: "CUSTOM_FORMULA" } as EvaluationRuleDTO),
      false
    );
    assert.equal(isFormAuthorableRule({ operation: "GRACE" } as EvaluationRuleDTO), true);
  });

  it("the action builds config from the OPERATION, never from stray inputs", () => {
    // The endpoint validates config AGAINST operation, and a MODERATION shape
    // on an ADD_CONSTANT rule is exactly the pairing that must not be storable.
    assert.match(actions, /switch \(operation\)/);
    assert.match(actions, /case "MODERATION":[\s\S]{0,200}targetStdDev/);
  });

  it("an unauthorable operation is refused rather than sent with a fabricated config", () => {
    assert.match(actions, /if \(!body\) return UNSUPPORTED_RULE_OPERATION/);
  });

  it("editing a stored rule reads its config back into the right inputs", () => {
    const values = ruleEditValues({
      code: "G5",
      name: "Grace 5",
      description: null,
      phase: "COMPONENT_ADJUSTMENT",
      componentId: "c1",
      operation: "GRACE",
      sequence: 3,
      config: { maxAward: 5 },
    } as unknown as EvaluationRuleDTO);

    assert.equal(values.maxAward, 5);
    assert.equal(values.operation, "GRACE");
    assert.equal(values.componentId, "c1");
    assert.equal(values.sequence, 3);
  });

  it("a rule applying to the course total round-trips as the sentinel", () => {
    const values = ruleEditValues({
      code: "C",
      name: "N",
      description: null,
      phase: "COURSE_ADJUSTMENT",
      componentId: null,
      operation: "CAP",
      sequence: 1,
      config: { limit: 100 },
    } as unknown as EvaluationRuleDTO);

    assert.equal(values.componentId, NONE_VALUE);
    assert.equal(values.limit, 100);
  });
});

// ============================================================================
// F — regression safety
// ============================================================================

describe("no unrelated permission moved", () => {
  it("assessment events keep their own manage set, untouched", () => {
    assert.deepEqual(
      [...ASSESSMENT_EVENT_MANAGE_ROLES],
      ["UNIVERSITY_ADMIN", "CONTROLLER_OF_EXAMINATION"]
    );
  });

  it("the faculty assignment confinement from the previous task still stands", () => {
    const assignments = read("app/api/assignments/route.ts");
    assert.match(assignments, /facultyMaySetCoursework\(/);
    assert.match(
      read("app/api/assignments/[id]/publish/route.ts"),
      /facultyMaySetCoursework\(/
    );
  });

  it("the scheme work added no new mutation endpoint anywhere", () => {
    // The only new route is the read-only grade-scale lookup. Everything else
    // drives endpoints that already existed.
    assert.ok(!/export async function (POST|PATCH|PUT|DELETE)\(/.test(gradeScalesRoute));
  });
});

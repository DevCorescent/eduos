// ============================================================================
// OWNER  : Gauransh
// MODULE : Constants — Module → area mapping
// LAYER  : Unit Tests
// PURPOSE: Pin the access rule that GAP-01 enforcement rests on.
//
// THE PROPERTY THAT MATTERS
//   The navigation filter and the API guard both call pathAllowed against the
//   same rule tables. If they could disagree, a link would appear for a module
//   whose data is refused, or — far worse — a link would be hidden while the
//   endpoint behind it stayed open, and QA would call the bug fixed because the
//   sidebar looked right. These tests assert the shared decision directly.
//
// WHAT "NO CONFIGURATION" MEANS, ASSERTED
//   An empty set means NOTHING is enabled — not everything. That is the whole
//   QA bug, and it is the reading the enabling code must never drift from.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODULE_API_RULES,
  MODULE_PAGE_RULES,
  pathAllowed,
  ruleForPath,
} from "@/lib/constants/moduleRoutes";
import { MODULE_KEYS } from "@/lib/constants/modules";

/** A tenant with nothing configured — the QA scenario. */
const NONE = new Set<string>();

describe("a tenant with ZERO enabled modules", () => {
  it("is refused every governed PAGE", () => {
    for (const rule of MODULE_PAGE_RULES) {
      assert.equal(
        pathAllowed(rule.prefix, NONE, MODULE_PAGE_RULES),
        false,
        `${rule.prefix} must be closed when nothing is enabled`
      );
    }
  });

  it("is refused every governed API", () => {
    for (const rule of MODULE_API_RULES) {
      assert.equal(
        pathAllowed(rule.prefix, NONE, MODULE_API_RULES),
        false,
        `${rule.prefix} must be closed when nothing is enabled`
      );
    }
  });

  it("KEEPS the always-on console — a university is never locked out of itself", () => {
    // The deliberate half of the decision: these correspond to no module key in
    // the PRD catalogue, so a switch cannot reach them.
    for (const path of [
      "/dashboard",
      "/settings",
      "/setup/campuses",
      "/setup/departments",
      "/calendar/academic-years",
      "/calendar/batches",
      "/timetable",
      "/attendance/report",
      "/electives",
      "/users",
      "/users/admins",
      "/governance/audit",
      "/feedback",
    ]) {
      assert.equal(pathAllowed(path, NONE, MODULE_PAGE_RULES), true, `${path} must stay open`);
    }
  });
});

describe("one enabled module opens exactly one area", () => {
  it("students only — Students opens, everything else governed stays closed", () => {
    const enabled = new Set(["students"]);

    assert.equal(pathAllowed("/students", enabled, MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/students/abc123", enabled, MODULE_PAGE_RULES), true);

    for (const path of [
      "/curriculum/courses",
      "/faculty",
      "/employees",
      "/admissions",
      "/evaluation",
      "/certificates/templates",
      "/finance/fee-demands",
      "/website",
    ]) {
      assert.equal(pathAllowed(path, enabled, MODULE_PAGE_RULES), false, `${path} must stay closed`);
    }
  });

  it("governs nested routes, not just the segment root", () => {
    const enabled = new Set(["examinations"]);

    assert.equal(pathAllowed("/evaluation/schemes", enabled, MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/evaluation/results/semester", enabled, MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/evaluation/results/semester", NONE, MODULE_PAGE_RULES), false);
  });

  it("matches on path segments, never on a bare substring", () => {
    // "/studentsomething" must not be governed by the "/students" rule.
    assert.equal(ruleForPath("/studentsomething", MODULE_PAGE_RULES), null);
    assert.equal(ruleForPath("/api/studentsomething", MODULE_API_RULES), null);
  });
});

describe("multiple enabled modules", () => {
  it("opens each independently and nothing else", () => {
    const enabled = new Set(["students", "academics", "faculty"]);

    assert.equal(pathAllowed("/students", enabled, MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/curriculum/courses", enabled, MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/faculty", enabled, MODULE_PAGE_RULES), true);

    assert.equal(pathAllowed("/employees", enabled, MODULE_PAGE_RULES), false);
    assert.equal(pathAllowed("/certificates/templates", enabled, MODULE_PAGE_RULES), false);
  });

  it("opens /finance for EITHER fees or finance", () => {
    // §57 gives this product one Finance destination covering §23 and §24.
    assert.equal(pathAllowed("/finance/fee-demands", new Set(["fees"]), MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/finance/fee-demands", new Set(["finance"]), MODULE_PAGE_RULES), true);
    assert.equal(pathAllowed("/finance/fee-demands", NONE, MODULE_PAGE_RULES), false);
  });
});

describe("portal self-service is never governed by the university's modules", () => {
  it("leaves a lecturer's and a student's own records reachable", () => {
    // A university switching off its staff directory must not take a lecturer's
    // own record away from them — a different decision from the one being made.
    for (const path of [
      "/api/faculty/me",
      "/api/students/me/exam-resources",
      "/api/student/dashboard",
      "/api/parent/children",
      "/api/fees/pending",
      "/api/fees/history",
    ]) {
      assert.equal(pathAllowed(path, NONE, MODULE_API_RULES), true, `${path} must stay open`);
    }
  });

  it("still governs the ADMIN collections those exceptions sit beneath", () => {
    assert.equal(pathAllowed("/api/faculty", NONE, MODULE_API_RULES), false);
    assert.equal(pathAllowed("/api/students", NONE, MODULE_API_RULES), false);
    assert.equal(pathAllowed("/api/fee-demands", NONE, MODULE_API_RULES), false);
  });

  it("leaves public certificate verification open", () => {
    // Unauthenticated by design and keyed on a certificate number; a module
    // switch must not silently break every verification link already issued.
    assert.equal(pathAllowed("/api/certificates/verify/ABC-123", NONE, MODULE_API_RULES), true);
    assert.equal(pathAllowed("/api/certificates", NONE, MODULE_API_RULES), false);
  });
});

describe("the mapping only ever names real catalogue modules", () => {
  it("every module referenced by a rule exists in the PRD catalogue", () => {
    // Guards against a typo becoming an area nothing can ever open.
    for (const rules of [MODULE_PAGE_RULES, MODULE_API_RULES]) {
      for (const rule of rules) {
        for (const key of rule.modules) {
          assert.ok(
            MODULE_KEYS.includes(key),
            `${rule.prefix} references "${key}", which is not a catalogue key`
          );
        }
      }
    }
  });

  it("pairs every governed page area with a governed API area", () => {
    // The QA bug in one assertion: hiding a page while leaving its data open is
    // the failure mode this feature exists to prevent.
    const pageModules = new Set(MODULE_PAGE_RULES.flatMap((r) => r.modules));
    const apiModules = new Set(MODULE_API_RULES.flatMap((r) => r.modules));

    for (const key of pageModules) {
      assert.ok(apiModules.has(key), `${key} gates a page but no API`);
    }
  });
});

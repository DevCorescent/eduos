// ============================================================================
// OWNER  : Gauransh
// MODULE : University module catalogue (W1.5 — PRD §57)
// LAYER  : Constants + partition helper — Unit Tests
// PURPOSE: Hold the catalogue to PRD §57, and prove the one behaviour that
//          protects stored data: an unrecognised key is preserved, never
//          promoted to a module and never silently dropped.
//
//          The catalogue is the second thing in W1.5 transcribed from a
//          document rather than derived from the schema (the first is the §49.1
//          stage list), so it gets the same treatment — a test that fails if
//          anybody edits it without meaning to.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODULE_KEYS,
  TOGGLEABLE_MODULE_KEYS,
  UNIVERSITY_MODULES,
  isModuleKey,
  partitionFeatures,
} from "@/lib/constants/modules";

describe("UNIVERSITY_MODULES (PRD §57 University Administration)", () => {
  it("is §57's navigation, verbatim and in order", () => {
    assert.deepEqual(
      UNIVERSITY_MODULES.map((m) => m.label),
      [
        "Dashboard",
        "Admissions",
        "Students",
        "Academics",
        "Learning",
        "Examinations",
        "Certificates",
        "Fees",
        "Finance",
        "Faculty",
        "Employees",
        "Research",
        "Placements",
        "Alumni",
        "Library",
        "Hostel",
        "Transport",
        "Inventory",
        "Procurement",
        "Support",
        "Analytics",
        "Website CMS",
        "Settings",
      ]
    );
  });

  it("has unique keys", () => {
    assert.equal(new Set(MODULE_KEYS).size, MODULE_KEYS.length);
  });

  it("marks only Dashboard and Settings always-on", () => {
    // Not a judgement about importance — Fees and Examinations matter more and
    // are both switchable. These two are fixed because the PRD never describes
    // a university without them.
    assert.deepEqual(
      UNIVERSITY_MODULES.filter((m) => m.alwaysOn).map((m) => m.key),
      ["dashboard", "settings"]
    );
    assert.equal(TOGGLEABLE_MODULE_KEYS.length, MODULE_KEYS.length - 2);
  });

  it("cites a PRD section for every module", () => {
    for (const m of UNIVERSITY_MODULES) {
      assert.match(m.prdSection, /^§\d/, `${m.key} has no PRD section`);
    }
  });
});

describe("isModuleKey", () => {
  it("accepts catalogue keys and rejects everything else", () => {
    assert.equal(isModuleKey("admissions"), true);
    assert.equal(isModuleKey("jhjj"), false);
    assert.equal(isModuleKey("Admissions"), false, "keys are case-sensitive");
    assert.equal(isModuleKey(""), false);
  });
});

describe("partitionFeatures", () => {
  it("splits catalogue modules from unrecognised keys", () => {
    const { modules, unknown } = partitionFeatures({
      admissions: true,
      fees: false,
      jhjj: true,
    });

    assert.deepEqual(modules, { admissions: true, fees: false });
    // The junk that a real tenant carries. Preserved, not promoted.
    assert.deepEqual(unknown, { jhjj: true });
  });

  it("does NOT coerce a non-boolean under a module key", () => {
    // A string or object under a catalogue key is not a module state. Coercing
    // it to true would rewrite a value the platform may be reading.
    const { modules, unknown } = partitionFeatures({
      admissions: "yes",
      library: { tier: "premium" },
    });

    assert.deepEqual(modules, {});
    assert.deepEqual(unknown, { admissions: "yes", library: { tier: "premium" } });
  });

  it("treats null and undefined as an empty selection", () => {
    for (const value of [null, undefined]) {
      const { modules, unknown } = partitionFeatures(value);
      assert.deepEqual(modules, {});
      assert.deepEqual(unknown, {});
    }
  });

  it("loses nothing — every input key comes back in one bucket or the other", () => {
    const input = { admissions: true, jhjj: 1, fees: false, weird: null };
    const { modules, unknown } = partitionFeatures(input);

    assert.deepEqual(
      [...Object.keys(modules), ...Object.keys(unknown)].sort(),
      Object.keys(input).sort()
    );
  });
});

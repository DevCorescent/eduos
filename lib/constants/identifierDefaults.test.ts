// ============================================================================
// TESTS: default identifier sequences.
//
// generateIdentifier REFUSES to issue without a configured sequence. That is
// correct — no identifier should ever be minted from an invented format — but
// it means an entity type missing from this list is a module that throws 409
// on a fresh tenant with no way for the user to work around it. Admissions and
// Certificates both generate their number and neither has a field to type one
// into, so for them the refusal is total.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ID_FORMAT,
  DEFAULT_ID_PADDING,
  DEFAULT_ID_RESET,
  DEFAULT_ID_SEQUENCES,
} from "./identifierDefaults";
import { IDENTIFIER_ENTITIES } from "@/lib/services/identifier.service";
import { FORMAT_TOKENS } from "@/lib/domain/identifier/format";

describe("DEFAULT_ID_SEQUENCES — one per entity the app issues", () => {
  it("covers EVERY entity type the identifier engine knows", () => {
    // The failure this prevents: a caller reaching generateIdentifier for a
    // type nothing provisioned, and throwing NO_SEQUENCE on a fresh tenant.
    for (const entity of IDENTIFIER_ENTITIES) {
      assert.ok(
        DEFAULT_ID_SEQUENCES.some((s) => s.entityType === entity),
        `${entity} has no default sequence; a fresh tenant cannot issue one`
      );
    }
  });

  it("defines nothing the engine does not know", () => {
    // The reverse drift: a counter provisioned for a type nothing reads.
    const known = new Set<string>(IDENTIFIER_ENTITIES);

    for (const seq of DEFAULT_ID_SEQUENCES) {
      assert.ok(known.has(seq.entityType), `${seq.entityType} is not an identifier entity`);
    }
  });

  it("covers the two entity types that CANNOT fall back to manual entry", () => {
    // Admissions issues both inside its transaction and Certificates has no
    // certificateNo input at all, so for these three a missing sequence is a
    // hard block rather than a degraded experience.
    for (const entity of ["APPLICANT", "APPLICATION", "CERTIFICATE"]) {
      assert.ok(DEFAULT_ID_SEQUENCES.some((s) => s.entityType === entity));
    }
  });

  it("gives each entity a distinct prefix", () => {
    // Identifiers are read by people. APPLICANT and APPLICATION are two
    // different numbers under PRD 9.1 and must not print alike.
    const prefixes = DEFAULT_ID_SEQUENCES.map((s) => s.prefix);

    assert.equal(new Set(prefixes).size, prefixes.length, "prefixes must be unique");
    for (const p of prefixes) assert.ok(p.length > 0, "a blank prefix is not self-describing");
  });

  it("lists each entity exactly once", () => {
    const types = DEFAULT_ID_SEQUENCES.map((s) => s.entityType);
    assert.equal(new Set(types).size, types.length);
  });
});

describe("The default format is renderable by the engine", () => {
  it("uses only tokens the formatter implements", () => {
    const known = new Set<string>(FORMAT_TOKENS);

    for (const [, token] of DEFAULT_ID_FORMAT.matchAll(/\{([A-Z_]+)\}/g)) {
      assert.ok(known.has(token), `{${token}} is not an implemented format token`);
    }
  });

  it("uses only CONTEXT-FREE tokens", () => {
    // {CAMPUS}, {DEPT} and friends resolve against records that do not exist
    // when a tenant is created. A default naming one would render a blank
    // segment into the first identifier the university ever issues.
    for (const contextual of ["CAMPUS", "DEPT", "PROGRAMME", "COURSE", "BATCH", "ROLE"]) {
      assert.ok(
        !DEFAULT_ID_FORMAT.includes(`{${contextual}}`),
        `{${contextual}} needs context provisioning does not have`
      );
    }
  });

  it("includes {SEQ}, or every identifier would be identical", () => {
    assert.ok(DEFAULT_ID_FORMAT.includes("{SEQ}"));
  });

  it("includes {YEAR}, which is what makes a YEARLY reset safe", () => {
    // The counter restarting each January can only be collision-free if the
    // year is part of the rendered value.
    assert.ok(DEFAULT_ID_FORMAT.includes("{YEAR}"));
    assert.equal(DEFAULT_ID_RESET, "YEARLY");
  });

  it("pads wide enough for a real intake", () => {
    assert.ok(DEFAULT_ID_PADDING >= 5, "four digits caps a year at 9,999 issues");
  });
});

describe("Provisioning wires the defaults without overwriting configuration", () => {
  const service = readFileSync(
    join(process.cwd(), "lib/services/universityProvisioning.service.ts"),
    "utf8"
  );

  it("upserts a sequence for every default", () => {
    assert.match(service, /for \(const sequence of DEFAULT_ID_SEQUENCES\)/);
    assert.match(service, /tx\.idSequence\.upsert\(/);
  });

  it("NEVER updates an existing sequence", () => {
    // The rule that makes this safe to re-run and safe to backfill. A populated
    // `update` could reset lastSequence and reissue numbers already printed on
    // certificates, or discard a format an administrator configured.
    const start = service.indexOf("for (const sequence of DEFAULT_ID_SEQUENCES)");
    assert.ok(start >= 0);

    const body = service.slice(start, start + 1400);

    assert.match(body, /update: \{\},/, "an existing sequence must be left exactly as configured");
    assert.ok(
      !/update: \{\s*[a-zA-Z]/.test(body),
      "the upsert must not write any field on the update path"
    );
  });

  it("scopes every default to the unscoped counter", () => {
    const start = service.indexOf("for (const sequence of DEFAULT_ID_SEQUENCES)");
    const body = service.slice(start, start + 1400);

    assert.match(body, /scopeKey: "",/);
  });

  it("creates them ACTIVE, or generateIdentifier would still refuse", () => {
    const start = service.indexOf("for (const sequence of DEFAULT_ID_SEQUENCES)");
    const body = service.slice(start, start + 1400);

    assert.match(body, /isActive: true/);
  });
});

describe("Automated IDs are reachable from the UI", () => {
  it("the student and staff actions OMIT a blank identifier", () => {
    // str() yields "", which fails the API's min(1) rule instead of triggering
    // generation. Only an omitted key reaches the engine.
    const students = readFileSync(join(process.cwd(), "actions/students.ts"), "utf8");
    const staff = readFileSync(join(process.cwd(), "actions/staff.ts"), "utf8");

    assert.match(students, /enrollmentNo: optionalStr\(values, "enrollmentNo"\)/);
    assert.ok(
      !/enrollmentNo: str\(values, "enrollmentNo"\)/.test(students),
      'sending "" would be rejected rather than generating an enrolment number'
    );
    assert.match(staff, /employeeId: optionalStr\(values, "employeeId"\)/);
    assert.ok(!/employeeId: str\(values, "employeeId"\)/.test(staff));
  });

  it("the forms no longer force a manual identifier", () => {
    for (const [page, field] of [
      ["app/(university)/students/page.tsx", "enrollmentNo"],
      ["app/(university)/faculty/page.tsx", "employeeId"],
      ["app/(university)/employees/page.tsx", "employeeId"],
    ] as const) {
      const source = readFileSync(join(process.cwd(), page), "utf8");
      const start = source.indexOf(`name: "${field}"`);
      assert.ok(start >= 0, `${field} not found in ${page}`);

      // The field block ends at the next closing brace of the object literal.
      const block = source.slice(start, source.indexOf("}", start));

      assert.ok(
        !/required: true/.test(block),
        `${page} still forces a manual ${field}, so the automation cannot run`
      );
    }
  });
});

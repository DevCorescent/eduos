// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the boundary rejects what it should and — just as important —
//          accepts what it must, since an over-strict schema on an opaque cuid
//          would turn a legitimate 404 into a misleading 400.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  semesterResultParamSchema,
  studentResultParamSchema,
  studentResultQuerySchema,
} from "@/lib/validations/result";

describe("studentResultParamSchema", () => {
  it("accepts a well-formed id", () => {
    const parsed = studentResultParamSchema.safeParse({ studentId: "clx123abc" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.studentId, "clx123abc");
    }
  });

  it("accepts an UNRECOGNISED but well-formed id", () => {
    // Student.id is an opaque cuid, so no format can distinguish an unknown id
    // from an invalid one. Rejecting here would turn a 404 into a 400 and tell
    // a client the id was malformed when it was merely absent.
    assert.equal(
      studentResultParamSchema.safeParse({ studentId: "does-not-exist" }).success,
      true
    );
  });

  it("rejects an empty id", () => {
    assert.equal(studentResultParamSchema.safeParse({ studentId: "" }).success, false);
  });

  it("rejects an id that is only whitespace", () => {
    assert.equal(studentResultParamSchema.safeParse({ studentId: "   " }).success, false);
  });

  it("rejects a missing id", () => {
    assert.equal(studentResultParamSchema.safeParse({}).success, false);
  });

  it("rejects a non-string id", () => {
    for (const studentId of [123, null, {}, []]) {
      assert.equal(
        studentResultParamSchema.safeParse({ studentId }).success,
        false,
        JSON.stringify(studentId)
      );
    }
  });

  it("strips server-managed keys rather than rejecting them", () => {
    const parsed = studentResultParamSchema.safeParse({
      studentId: "clx1",
      tenantId: "attacker_tenant",
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("tenantId" in parsed.data, false, "the tenant comes from requireTenant");
    }
  });
});

describe("semesterResultParamSchema", () => {
  it("accepts a well-formed id", () => {
    assert.equal(
      semesterResultParamSchema.safeParse({ semesterId: "clxsem1" }).success,
      true
    );
  });

  it("rejects an empty or missing id", () => {
    assert.equal(semesterResultParamSchema.safeParse({ semesterId: "" }).success, false);
    assert.equal(semesterResultParamSchema.safeParse({}).success, false);
  });
});

describe("studentResultQuerySchema", () => {
  it("accepts no query at all — the whole record is the default", () => {
    const parsed = studentResultQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.semesterId, undefined);
    }
  });

  it("accepts a semester filter", () => {
    const parsed = studentResultQuerySchema.safeParse({ semesterId: "clxsem1" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.semesterId, "clxsem1");
    }
  });

  it("rejects an empty semester filter rather than treating it as absent", () => {
    // "?semesterId=" is a client bug, and silently returning the whole record
    // would hide it behind a plausible-looking response.
    assert.equal(studentResultQuerySchema.safeParse({ semesterId: "" }).success, false);
  });

  it("STRIPS an unknown query key rather than rejecting the request", () => {
    // A client appending a cache-busting parameter should not receive a 400.
    const parsed = studentResultQuerySchema.safeParse({ _t: "1730000000" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("_t" in parsed.data, false);
    }
  });
});

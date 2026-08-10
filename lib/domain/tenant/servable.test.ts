// ============================================================================
// OWNER  : Gauransh
// MODULE : Domain — servable tenant statuses (W1.5)
// LAYER  : Unit Tests
// PURPOSE: Regression cover for a defect live verification caught.
//
//          W1.5 added TenantStatus.ARCHIVED. Both places that decide whether a
//          university may serve traffic — tenant resolution and the tenant login
//          route — were deny-lists reading `=== "CANCELLED" || === "SUSPENDED"`,
//          so ARCHIVED fell through both and an archived university went on
//          resolving and issuing sessions.
//
//          The fix is one allow-list. This test is what stops the NEXT status
//          from repeating it: the exhaustiveness assertion below fails the
//          moment a value is added to the enum without a decision being made
//          here about whether it may serve traffic.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isServableStatus } from "@/lib/domain/tenant/servable";
import { TenantStatus } from "@/app/generated/prisma/enums";

describe("isServableStatus", () => {
  it("permits a working university", () => {
    // TRIAL is servable because a trial university is a working one.
    assert.equal(isServableStatus("ACTIVE"), true);
    assert.equal(isServableStatus("TRIAL"), true);
  });

  it("REFUSES every status that takes a university offline", () => {
    assert.equal(isServableStatus("SUSPENDED"), false);
    assert.equal(isServableStatus("CANCELLED"), false);
    // The one the old deny-list missed.
    assert.equal(isServableStatus("ARCHIVED"), false);
  });

  it("refuses an unrecognised status rather than defaulting to servable", () => {
    // The safe direction: a university wrongly offline is a visible bug; one
    // wrongly online after being archived is a silent data exposure.
    assert.equal(isServableStatus("SOMETHING_NEW"), false);
    assert.equal(isServableStatus(""), false);
  });

  it("has a decision recorded for EVERY status in the enum", () => {
    // Exhaustiveness. This does not assert which answer each status gets — it
    // asserts that adding a status to the schema forces somebody to look at
    // this file, which is exactly what did not happen when ARCHIVED was added.
    const decided = new Set(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED", "ARCHIVED"]);

    for (const status of Object.values(TenantStatus)) {
      assert.ok(
        decided.has(status),
        `TenantStatus.${status} has no recorded servability decision — add it to this test and to lib/domain/tenant/servable.ts`
      );
    }
  });
});

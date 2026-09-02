// ============================================================================
// TESTS: attendance correction decision.
//
// These are the refusals a caller can trigger deliberately — deciding a settled
// request twice, or approving one's own. Both are security-relevant: the first
// would re-apply a correction already applied, the second would turn an
// approval workflow into a slower way of editing the record directly.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CORRECTION_REFUSAL,
  CORRECTION_STATUS,
  decideReview,
  isRealChange,
} from "./decision";

const REVIEWER = "user_reviewer";
const REQUESTER = "user_requester";

describe("decideReview — who may decide", () => {
  it("allows a different user to decide a PENDING request", () => {
    assert.deepEqual(
      decideReview({
        status: CORRECTION_STATUS.PENDING,
        requestedById: REQUESTER,
        reviewerId: REVIEWER,
      }),
      { allowed: true }
    );
  });

  it("REFUSES self-review", () => {
    // The PRD names an approval step. An approval the requester grants
    // themselves is not one.
    const decision = decideReview({
      status: CORRECTION_STATUS.PENDING,
      requestedById: REQUESTER,
      reviewerId: REQUESTER,
    });

    assert.equal(decision.allowed, false);
    assert.equal(!decision.allowed && decision.reason, CORRECTION_REFUSAL.SELF_REVIEW);
  });

  it("REFUSES a request that was already approved", () => {
    // A second approval would re-apply a correction that has already been
    // applied to the register.
    const decision = decideReview({
      status: CORRECTION_STATUS.APPROVED,
      requestedById: REQUESTER,
      reviewerId: REVIEWER,
    });

    assert.equal(decision.allowed, false);
    assert.equal(!decision.allowed && decision.reason, CORRECTION_REFUSAL.ALREADY_DECIDED);
  });

  it("REFUSES a request that was already rejected", () => {
    // A second rejection would overwrite the note explaining the first.
    const decision = decideReview({
      status: CORRECTION_STATUS.REJECTED,
      requestedById: REQUESTER,
      reviewerId: REVIEWER,
    });

    assert.equal(!decision.allowed && decision.reason, CORRECTION_REFUSAL.ALREADY_DECIDED);
  });

  it("checks ALREADY_DECIDED before SELF_REVIEW", () => {
    // Precedence matters for the message: telling a requester "you cannot
    // approve your own" about a request that was settled last week sends them
    // to argue the wrong point.
    const decision = decideReview({
      status: CORRECTION_STATUS.APPROVED,
      requestedById: REQUESTER,
      reviewerId: REQUESTER,
    });

    assert.equal(!decision.allowed && decision.reason, CORRECTION_REFUSAL.ALREADY_DECIDED);
  });

  it("allows review when the requester's account no longer exists", () => {
    // requestedById is SET NULL when a user is deleted. Nobody can be that
    // person, so nobody is self-reviewing, and the request must stay decidable
    // rather than becoming permanently stuck.
    assert.deepEqual(
      decideReview({
        status: CORRECTION_STATUS.PENDING,
        requestedById: null,
        reviewerId: REVIEWER,
      }),
      { allowed: true }
    );
  });
});

describe("isRealChange", () => {
  it("accepts a genuine correction", () => {
    assert.equal(isRealChange("ABSENT", "PRESENT"), true);
  });

  it("rejects a no-op", () => {
    // A no-op would occupy the single pending slot for the record and block a
    // real correction behind it.
    assert.equal(isRealChange("PRESENT", "PRESENT"), false);
  });
});

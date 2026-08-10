// ============================================================================
// The state mapping is now the single decision behind every screen's
// non-success branch, so it is tested directly. These assertions are the
// specification: if one changes, a portal's behaviour changed with it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveUiState,
  resolveFailureState,
  isRetryable,
  type UiState,
} from "./ui-state";
import type { ApiResponse } from "@/types";

const ok = <T,>(data: T): ApiResponse<T> => ({ success: true, data });
const fail = (code: string): ApiResponse<never> =>
  ({ success: false, error: "x", code }) as ApiResponse<never>;

describe("resolveUiState — success", () => {
  it("is success when rows came back", () => {
    assert.equal(resolveUiState(ok([1]), { isEmpty: false }), "success");
  });

  it("is empty when the query succeeded and the answer is zero", () => {
    assert.equal(resolveUiState(ok([]), { isEmpty: true }), "empty");
  });
});

describe("resolveUiState — failures", () => {
  it("maps 403 to unavailable, NOT error", () => {
    // The distinction this whole module exists for: a permission boundary is
    // not a fault, and must never offer a retry.
    assert.equal(resolveUiState(fail("FORBIDDEN")), "unavailable");
  });

  it("maps 401 and AUTH_ERROR to unauthorized", () => {
    assert.equal(resolveUiState(fail("UNAUTHORIZED")), "unauthorized");
    assert.equal(resolveUiState(fail("AUTH_ERROR")), "unauthorized");
  });

  it("maps 429 to rateLimited so no retry is offered", () => {
    assert.equal(resolveUiState(fail("RATE_LIMITED")), "rateLimited");
  });

  it("maps 5xx and network failures to error", () => {
    assert.equal(resolveUiState(fail("SERVER_ERROR")), "error");
    assert.equal(resolveUiState(fail("NETWORK_ERROR")), "error");
  });

  it("defaults an unrecognised code to error rather than guessing", () => {
    assert.equal(resolveUiState(fail("SOMETHING_NEW")), "error");
  });
});

describe("resolveUiState — the ambiguous 404", () => {
  it("is notFound by default, because a broken route must not read as 'no data'", () => {
    assert.equal(resolveUiState(fail("NOT_FOUND")), "notFound");
  });

  it("is empty only when the caller says the resource may legitimately be absent", () => {
    assert.equal(
      resolveUiState(fail("NOT_FOUND"), { treatNotFoundAsEmpty: true }),
      "empty"
    );
  });
});

describe("isRetryable", () => {
  it("offers retry for error alone", () => {
    const states: UiState[] = [
      "empty", "unavailable", "unauthorized", "notFound", "rateLimited", "success", "loading",
    ];
    for (const state of states) {
      assert.equal(isRetryable(state), false, `${state} must not offer retry`);
    }
    assert.equal(isRetryable("error"), true);
  });
});

// ---------------------------------------------------------------------------
// The typed-error path. A screen that catches a throw and one that reads an
// envelope must reach the SAME state for the same failure — otherwise the
// behaviour depends on how the data happened to be fetched, which is the
// coupling this module exists to remove.
// ---------------------------------------------------------------------------

import {
  AppError,
  AuthError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
  isAppError,
} from "./errors";

describe("resolveUiState — typed errors agree with envelopes", () => {
  const pairs: [InstanceType<typeof AppError>, UiState][] = [
    [new PermissionError(), "unavailable"],
    [new AuthError(), "unauthorized"],
    [new RateLimitError(), "rateLimited"],
    [new NotFoundError(), "notFound"],
    [new ServerError(), "error"],
    [new ValidationError(), "error"],
    [new ConflictError(), "error"],
  ];

  for (const [error, expected] of pairs) {
    it(`${error.name} -> ${expected}`, () => {
      assert.equal(resolveUiState(error), expected);
      // …and the envelope carrying the same code must agree.
      assert.equal(resolveUiState(fail(error.code)), expected);
    });
  }

  it("honours treatNotFoundAsEmpty for a thrown NotFoundError too", () => {
    assert.equal(
      resolveUiState(new NotFoundError(), { treatNotFoundAsEmpty: true }),
      "empty"
    );
  });
});

describe("resolveUiState — unclassifiable failures", () => {
  it("treats a raw throw as error, the state that offers a retry", () => {
    // Nobody has characterised this fault, so the safest default is the one
    // that lets the reader try again.
    assert.equal(resolveUiState(new TypeError("boom")), "error");
    assert.equal(resolveUiState("a string"), "error");
    assert.equal(resolveUiState(null), "error");
    assert.equal(resolveUiState(undefined), "error");
  });
});

describe("error taxonomy", () => {
  it("pins the status and code together so neither is retyped at a throw site", () => {
    assert.equal(new PermissionError().statusCode, 403);
    assert.equal(new PermissionError().code, "FORBIDDEN");
    assert.equal(new RateLimitError().statusCode, 429);
    assert.equal(new AuthError().statusCode, 401);
    assert.equal(new NotFoundError().statusCode, 404);
    assert.equal(new ConflictError().statusCode, 409);
    assert.equal(new ValidationError().statusCode, 400);
    assert.equal(new ServerError().statusCode, 500);
  });

  it("keeps every subclass an AppError, so existing catch blocks still match", () => {
    for (const error of [
      new ValidationError(), new AuthError(), new PermissionError(),
      new NotFoundError(), new ConflictError(), new RateLimitError(), new ServerError(),
    ]) {
      assert.ok(error instanceof AppError, `${error.name} must extend AppError`);
      assert.ok(isAppError(error));
    }
  });

  it("carries retryAfterSeconds, the one thing a retry button cannot substitute for", () => {
    assert.equal(new RateLimitError("slow down", 30).retryAfterSeconds, 30);
  });

  it("isAppError rejects non-errors rather than throwing on them", () => {
    assert.equal(isAppError(null), false);
    assert.equal(isAppError({ code: "FORBIDDEN" }), false);
    assert.equal(isAppError(new TypeError("x")), false);
  });
});

// ============================================================================
// resolveFailureState is the same mapping with a narrower return type, used in
// branches that have already proved the response failed. These assertions pin
// the "same mapping" part: if the two ever disagree, a screen's treatment would
// depend on which helper it happened to call.
// ============================================================================

describe("resolveFailureState", () => {
  const codes = [
    "UNAUTHORIZED", "AUTH_ERROR", "FORBIDDEN", "NOT_FOUND",
    "RATE_LIMITED", "SERVER_ERROR", "TENANT_ERROR",
  ];

  it("agrees with resolveUiState on every failure code", () => {
    for (const code of codes) {
      assert.equal(
        resolveFailureState(fail(code)),
        resolveUiState(fail(code)),
        `disagreement on ${code}`
      );
    }
  });

  it("maps a 403 to unavailable, which is the whole reason this exists", () => {
    assert.equal(resolveFailureState(fail("FORBIDDEN")), "unavailable");
  });

  it("honours treatNotFoundAsEmpty, so a missing sub-resource stays empty", () => {
    assert.equal(resolveFailureState(fail("NOT_FOUND")), "notFound");
    assert.equal(
      resolveFailureState(fail("NOT_FOUND"), { treatNotFoundAsEmpty: true }),
      "empty"
    );
  });

  it("never returns success or loading, even if handed a successful envelope", () => {
    // Not reachable from a !result.success branch, but a caller can pass
    // anything and the return type must not be a lie.
    const state: Exclude<UiState, "success" | "loading"> = resolveFailureState(ok([1]));
    assert.equal(state, "error");
  });

  it("treats an unclassifiable throw as error, the only retryable state", () => {
    assert.equal(resolveFailureState(new TypeError("boom")), "error");
    assert.ok(isRetryable(resolveFailureState(new TypeError("boom"))));
  });
});

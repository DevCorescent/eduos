// ============================================================================
// The state mapping is now the single decision behind every screen's
// non-success branch, so it is tested directly. These assertions are the
// specification: if one changes, a portal's behaviour changed with it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveUiState, isRetryable, type UiState } from "./ui-state";
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

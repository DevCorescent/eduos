// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the self-service guarantee at the boundary.
//
//          The identity-stripping suite is the one that matters. Phase 18
//          resolves the student from the session and never from the request, so
//          a studentId arriving in a query string must not survive validation —
//          not because a route would honour it today, but because a schema that
//          carried it forward is the first step toward one that does.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AchievementCategory } from "@/app/generated/prisma/enums";
import {
  DEFAULT_NOTIFICATIONS,
  FORBIDDEN_IDENTITY_KEYS,
  MAX_NOTIFICATIONS,
  STUDENT_PROFILE_SCHEMAS,
  achievementQuerySchema,
  dashboardQuerySchema,
  profileQuerySchema,
} from "@/lib/validations/studentProfile.validation";

describe("the self-service guarantee", () => {
  it("STRIPS every identity key from every schema in the module", () => {
    // Iterated rather than named one by one, so a schema added later is covered
    // automatically instead of being forgotten.
    const hostile = Object.fromEntries(
      FORBIDDEN_IDENTITY_KEYS.map((key) => [key, "victim_id"])
    );

    for (const schema of STUDENT_PROFILE_SCHEMAS) {
      const parsed = schema.safeParse({ ...hostile });

      assert.equal(parsed.success, true, "identity keys are stripped, not rejected");

      if (parsed.success) {
        for (const key of FORBIDDEN_IDENTITY_KEYS) {
          assert.equal(
            key in parsed.data,
            false,
            `${key} survived validation — a route could then trust it`
          );
        }
      }
    }
  });

  it("names the three keys a client may never supply", () => {
    assert.deepEqual([...FORBIDDEN_IDENTITY_KEYS], ["studentId", "userId", "tenantId"]);
  });

  it("declares no studentId schema anywhere in the module", () => {
    // The absence is the point: a client-supplied id is unexpressible, not
    // merely ignored.
    const parsed = achievementQuerySchema.safeParse({ studentId: "student_2" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(Object.keys(parsed.data), []);
    }
  });
});

describe("achievementQuerySchema", () => {
  it("accepts an empty query", () => {
    const parsed = achievementQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.category, undefined, "no filter means every achievement");
    }
  });

  it("accepts every category the enum declares", () => {
    for (const category of Object.values(AchievementCategory)) {
      assert.equal(
        achievementQuerySchema.safeParse({ category }).success,
        true,
        category
      );
    }
  });

  it("rejects a category outside the enum", () => {
    for (const category of ["SPORT", "sports", "Athletics", ""]) {
      assert.equal(
        achievementQuerySchema.safeParse({ category }).success,
        false,
        JSON.stringify(category)
      );
    }
  });

  it("STRIPS an unknown key rather than rejecting the request", () => {
    // A client appending a cache-busting parameter should not receive a 400.
    const parsed = achievementQuerySchema.safeParse({ _t: "1730000000" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("_t" in parsed.data, false);
    }
  });

  it("declares no pagination — an achievement list is bounded by the student", () => {
    const parsed = achievementQuerySchema.safeParse({ page: "2", limit: "50" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("page" in parsed.data, false);
      assert.equal("limit" in parsed.data, false);
    }
  });
});

describe("dashboardQuerySchema", () => {
  it("defaults the notification panel", () => {
    const parsed = dashboardQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.notifications, DEFAULT_NOTIFICATIONS);
    }
  });

  it("coerces from a string, as a search param arrives", () => {
    const parsed = dashboardQuerySchema.safeParse({ notifications: "10" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.notifications, 10);
    }
  });

  it("accepts the boundary values", () => {
    assert.equal(dashboardQuerySchema.safeParse({ notifications: "1" }).success, true);
    assert.equal(
      dashboardQuerySchema.safeParse({ notifications: String(MAX_NOTIFICATIONS) }).success,
      true
    );
  });

  it("REJECTS zero, which would be a silently empty panel", () => {
    assert.equal(dashboardQuerySchema.safeParse({ notifications: "0" }).success, false);
  });

  it("rejects a request for the whole table", () => {
    assert.equal(
      dashboardQuerySchema.safeParse({ notifications: String(MAX_NOTIFICATIONS + 1) }).success,
      false
    );
  });

  it("rejects a negative or fractional count", () => {
    assert.equal(dashboardQuerySchema.safeParse({ notifications: "-5" }).success, false);
    assert.equal(dashboardQuerySchema.safeParse({ notifications: "2.5" }).success, false);
  });

  it("rejects a non-numeric value rather than falling back to the default", () => {
    // Silently defaulting would hide a client bug behind a plausible response.
    assert.equal(dashboardQuerySchema.safeParse({ notifications: "all" }).success, false);
  });

  it("keeps the default below the maximum, so the default is always valid", () => {
    assert.ok(DEFAULT_NOTIFICATIONS >= 1);
    assert.ok(DEFAULT_NOTIFICATIONS <= MAX_NOTIFICATIONS);
  });
});

describe("profileQuerySchema", () => {
  it("accepts an empty query", () => {
    assert.equal(profileQuerySchema.safeParse({}).success, true);
  });

  it("offers no field selection — a profile is returned whole", () => {
    // Assembling a partial profile would mean a second shape to test and a
    // second set of nulls to reason about, for no benefit a client cannot get
    // by ignoring fields.
    const parsed = profileQuerySchema.safeParse({ fields: "parents,documents" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(Object.keys(parsed.data), []);
    }
  });
});

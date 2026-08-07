// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the boundary refuses an incoherent preference list.
//
//          The rank-coherence suite is the one that matters. A duplicate rank
//          or a gap would otherwise reach the database and surface as a unique-
//          constraint violation with a message no student could act on — or,
//          worse for a gap, succeed and silently allocate against choices the
//          student did not realise they had lost.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ElectiveAllocationStrategy, OpenElectiveStatus } from "@/app/generated/prisma/enums";
import {
  ALLOCATION_STRATEGIES,
  FORBIDDEN_IDENTITY_KEYS,
  MAX_PREFERENCES,
  MIN_PREFERENCES,
  STUDENT_FACING_SCHEMAS,
  allocateSchema,
  electiveStatusQuerySchema,
  listOfferingsQuerySchema,
  lockSchema,
  submitPreferencesSchema,
} from "@/lib/validations/openElective.validation";

/** A well-formed submission of `count` ranked choices. */
function submission(count: number) {
  return {
    semesterId: "sem_1",
    preferences: Array.from({ length: count }, (_value, index) => ({
      offeringId: `offering_${index}`,
      preferenceRank: index + 1,
    })),
  };
}

describe("submitPreferencesSchema — rank coherence", () => {
  it("accepts a contiguous 1..n list", () => {
    for (const count of [1, 2, 5, MAX_PREFERENCES]) {
      assert.equal(submitPreferencesSchema.safeParse(submission(count)).success, true, `n=${count}`);
    }
  });

  it("REJECTS a duplicate rank", () => {
    // Which of the two is preferred? The question has no answer, so the request
    // has no meaning.
    const body = {
      semesterId: "sem_1",
      preferences: [
        { offeringId: "a", preferenceRank: 1 },
        { offeringId: "b", preferenceRank: 1 },
      ],
    };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });

  it("REJECTS a gap in the ranks", () => {
    // 1, 2, 5 is almost always a client that dropped a row. Honouring it would
    // silently allocate against choices the student did not know they had lost.
    const body = {
      semesterId: "sem_1",
      preferences: [
        { offeringId: "a", preferenceRank: 1 },
        { offeringId: "b", preferenceRank: 2 },
        { offeringId: "c", preferenceRank: 5 },
      ],
    };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });

  it("REJECTS a list that does not start at 1", () => {
    const body = {
      semesterId: "sem_1",
      preferences: [
        { offeringId: "a", preferenceRank: 2 },
        { offeringId: "b", preferenceRank: 3 },
      ],
    };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });

  it("REJECTS the same offering ranked twice", () => {
    const body = {
      semesterId: "sem_1",
      preferences: [
        { offeringId: "a", preferenceRank: 1 },
        { offeringId: "a", preferenceRank: 2 },
      ],
    };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });

  it("accepts ranks supplied OUT OF ORDER, so long as the set is 1..n", () => {
    // Order in the array is presentation; the rank field is the ordering.
    const body = {
      semesterId: "sem_1",
      preferences: [
        { offeringId: "a", preferenceRank: 3 },
        { offeringId: "b", preferenceRank: 1 },
        { offeringId: "c", preferenceRank: 2 },
      ],
    };

    assert.equal(submitPreferencesSchema.safeParse(body).success, true);
  });

  it("names the problem rather than reporting a generic failure", () => {
    const parsed = submitPreferencesSchema.safeParse({
      semesterId: "sem_1",
      preferences: [
        { offeringId: "a", preferenceRank: 1 },
        { offeringId: "b", preferenceRank: 3 },
      ],
    });

    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.ok(
        parsed.error.issues.some((issue) => issue.message.includes("no gaps")),
        "the message does not explain what is wrong"
      );
    }
  });

  it("rejects a rank of zero or a negative rank", () => {
    for (const preferenceRank of [0, -1]) {
      const body = { semesterId: "sem_1", preferences: [{ offeringId: "a", preferenceRank }] };

      assert.equal(submitPreferencesSchema.safeParse(body).success, false, String(preferenceRank));
    }
  });

  it("rejects a fractional rank", () => {
    const body = { semesterId: "sem_1", preferences: [{ offeringId: "a", preferenceRank: 1.5 }] };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });
});

describe("submitPreferencesSchema — bounds", () => {
  it("REFUSES an empty list rather than treating it as a withdrawal", () => {
    // Clearing a preference list is the most destructive thing this endpoint
    // can do; it must not be reachable by the least deliberate action.
    assert.equal(
      submitPreferencesSchema.safeParse({ semesterId: "sem_1", preferences: [] }).success,
      false
    );
  });

  it("accepts the minimum", () => {
    assert.equal(submitPreferencesSchema.safeParse(submission(MIN_PREFERENCES)).success, true);
  });

  it("rejects more than the maximum", () => {
    assert.equal(submitPreferencesSchema.safeParse(submission(MAX_PREFERENCES + 1)).success, false);
  });

  it("requires a semester", () => {
    const body = { preferences: [{ offeringId: "a", preferenceRank: 1 }] };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });

  it("rejects an empty offering id", () => {
    const body = { semesterId: "sem_1", preferences: [{ offeringId: "  ", preferenceRank: 1 }] };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });

  it("is STRICT — a misspelled key on a destructive write is a 400", () => {
    // Lenient about reads, strict about writes that replace a student's whole
    // preference list.
    const body = { ...submission(2), semseterId: "sem_2" };

    assert.equal(submitPreferencesSchema.safeParse(body).success, false);
  });
});

describe("the self-service half strips identity", () => {
  it("strips every identity key from every student-facing schema", () => {
    const hostile = Object.fromEntries(
      FORBIDDEN_IDENTITY_KEYS.map((key) => [key, "victim_id"])
    );

    for (const schema of STUDENT_FACING_SCHEMAS) {
      // submitPreferencesSchema is strict, so identity keys are REJECTED there
      // rather than stripped — an even stronger outcome. Either is acceptable;
      // what must never happen is one surviving into the parsed data.
      const parsed = schema.safeParse({ ...submission(1), semesterId: "sem_1", ...hostile });

      if (parsed.success) {
        for (const key of FORBIDDEN_IDENTITY_KEYS) {
          assert.equal(key in parsed.data, false, `${key} survived validation`);
        }
      }
    }
  });

  it("names the three keys a student may never supply", () => {
    assert.deepEqual([...FORBIDDEN_IDENTITY_KEYS], ["studentId", "userId", "tenantId"]);
  });

  it("never lets a student name themselves on a status query", () => {
    const parsed = electiveStatusQuerySchema.safeParse({
      semesterId: "sem_1",
      studentId: "victim",
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("studentId" in parsed.data, false);
    }
  });
});

describe("listOfferingsQuerySchema", () => {
  it("applies pagination defaults from the SHARED schema", () => {
    const parsed = listOfferingsQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.page, 1);
      assert.equal(parsed.data.limit, 20);
    }
  });

  it("rejects a limit above the shared maximum", () => {
    assert.equal(listOfferingsQuerySchema.safeParse({ limit: "101" }).success, false);
  });

  it("accepts every lifecycle status as a filter", () => {
    for (const status of Object.values(OpenElectiveStatus)) {
      assert.equal(listOfferingsQuerySchema.safeParse({ status }).success, true, status);
    }
  });

  it("rejects a status outside the lifecycle", () => {
    assert.equal(listOfferingsQuerySchema.safeParse({ status: "CLOSED" }).success, false);
  });

  it("STRIPS an unknown key rather than rejecting a read", () => {
    const parsed = listOfferingsQuerySchema.safeParse({ _t: "1730000000" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("_t" in parsed.data, false);
    }
  });
});

describe("electiveStatusQuerySchema", () => {
  it("REQUIRES a semester", () => {
    // Defaulting to "the current semester" would need this layer to decide
    // which semester is current — a determination it cannot make.
    assert.equal(electiveStatusQuerySchema.safeParse({}).success, false);
  });

  it("accepts a semester", () => {
    assert.equal(electiveStatusQuerySchema.safeParse({ semesterId: "sem_1" }).success, true);
  });
});

describe("allocateSchema", () => {
  it("targets ONE offering", () => {
    const parsed = allocateSchema.safeParse({ offeringId: "offering_1" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.offeringId, "offering_1");
    }
  });

  it("defaults force to false, so a re-run is an explicit act", () => {
    const parsed = allocateSchema.safeParse({ offeringId: "offering_1" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.force, false);
    }
  });

  it("accepts an explicit force", () => {
    const parsed = allocateSchema.safeParse({ offeringId: "offering_1", force: true });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.force, true);
    }
  });

  it("REFUSES a strategy in the request body", () => {
    // Strategy is configuration on the offering. Accepting one per request
    // would let a caller override a department's declared policy at allocation
    // time — precisely the hardcoding this design exists to prevent.
    const parsed = allocateSchema.safeParse({
      offeringId: "offering_1",
      strategy: ElectiveAllocationStrategy.MERIT,
    });

    assert.equal(parsed.success, false, "a strategy override was accepted");
  });

  it("requires an offering", () => {
    assert.equal(allocateSchema.safeParse({}).success, false);
    assert.equal(allocateSchema.safeParse({ offeringId: "" }).success, false);
  });

  it("is strict about every other key", () => {
    assert.equal(
      allocateSchema.safeParse({ offeringId: "offering_1", semesterId: "sem_1" }).success,
      false
    );
  });
});

describe("lockSchema", () => {
  it("targets one offering", () => {
    assert.equal(lockSchema.safeParse({ offeringId: "offering_1" }).success, true);
  });

  it("carries NO target status — this endpoint locks and nothing else", () => {
    // A body able to name any status would make it a general transition
    // endpoint with a misleading name.
    assert.equal(
      lockSchema.safeParse({ offeringId: "offering_1", status: "ALLOCATED" }).success,
      false
    );
  });

  it("requires an offering", () => {
    assert.equal(lockSchema.safeParse({}).success, false);
  });
});

describe("allocation strategies", () => {
  it("names exactly the two the Phase 19 decision approved", () => {
    assert.deepEqual([...ALLOCATION_STRATEGIES], ["FCFS", "MERIT"]);
  });

  it("matches the enum the database stores", () => {
    assert.deepEqual(
      [...ALLOCATION_STRATEGIES].sort(),
      Object.values(ElectiveAllocationStrategy).sort()
    );
  });
});

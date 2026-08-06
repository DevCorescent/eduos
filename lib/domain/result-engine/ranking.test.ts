// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Ranking
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove the three numbering modes, the configurable tie-break chain,
//          and — above everything — that the same cohort ranks the same way
//          every time it is asked.
//
//          A rank list that reorders between two runs of identical data is not
//          a rank list, and the failure is invisible until a student compares
//          two printouts.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toScaled } from "@/lib/domain/result-engine/decimal";
import {
  RANK_KEY,
  RANK_MODE,
  RANK_SCOPE,
  rankCohort,
  type RankSubject,
  type RankingPolicy,
} from "@/lib/domain/result-engine/ranking";

function subject(
  subjectId: string,
  cgpa: string | null,
  overrides: Partial<RankSubject> = {}
): RankSubject {
  return {
    subjectId,
    cgpaScaled: cgpa === null ? null : toScaled(cgpa),
    ...overrides,
  };
}

function policy(overrides: Partial<RankingPolicy> = {}): RankingPolicy {
  return {
    scope: RANK_SCOPE.CLASS,
    mode: RANK_MODE.COMPETITION,
    keys: [RANK_KEY.CGPA],
    ...overrides,
  };
}

/** Rank and return "subjectId:rank" pairs, which read clearly in a failure. */
function ranks(subjects: readonly RankSubject[], config = policy()): readonly string[] {
  return rankCohort(subjects, config).ranked.map((entry) => `${entry.subjectId}:${entry.rank}`);
}

describe("rankCohort — ordering", () => {
  const cohort = [
    subject("c", "7.5"),
    subject("a", "9.1"),
    subject("b", "8.3"),
  ];

  it("orders by the primary key, highest first", () => {
    assert.deepEqual(ranks(cohort), ["a:1", "b:2", "c:3"]);
  });

  it("reports the cohort size on every entry", () => {
    for (const entry of rankCohort(cohort, policy()).ranked) {
      assert.equal(entry.outOf, 3);
    }
  });

  it("carries the scope and mode through unchanged", () => {
    const result = rankCohort(
      cohort,
      policy({ scope: RANK_SCOPE.UNIVERSITY, mode: RANK_MODE.DENSE })
    );

    assert.equal(result.scope, RANK_SCOPE.UNIVERSITY);
    assert.equal(result.mode, RANK_MODE.DENSE);
  });

  it("does not mutate the caller's array", () => {
    const input = [...cohort];
    rankCohort(input, policy());

    assert.deepEqual(input.map((entry) => entry.subjectId), ["c", "a", "b"]);
  });

  it("handles an empty cohort", () => {
    const result = rankCohort([], policy());

    assert.deepEqual(result.ranked, []);
    assert.deepEqual(result.unranked, []);
  });

  it("handles a cohort of one", () => {
    assert.deepEqual(ranks([subject("a", "6")]), ["a:1"]);
  });
});

describe("rankCohort — the three numbering modes", () => {
  // Two students tie for second, which is where the modes diverge.
  const cohort = [
    subject("a", "9.0"),
    subject("b", "8.0"),
    subject("c", "8.0"),
    subject("d", "7.0"),
  ];

  it("COMPETITION leaves a gap: 1, 2, 2, 4", () => {
    assert.deepEqual(ranks(cohort, policy({ mode: RANK_MODE.COMPETITION })), [
      "a:1",
      "b:2",
      "c:2",
      "d:4",
    ]);
  });

  it("DENSE leaves no gap: 1, 2, 2, 3", () => {
    assert.deepEqual(ranks(cohort, policy({ mode: RANK_MODE.DENSE })), [
      "a:1",
      "b:2",
      "c:2",
      "d:3",
    ]);
  });

  it("ORDINAL gives every subject its own number: 1, 2, 3, 4", () => {
    assert.deepEqual(ranks(cohort, policy({ mode: RANK_MODE.ORDINAL })), [
      "a:1",
      "b:2",
      "c:3",
      "d:4",
    ]);
  });

  it("marks a shared position as tied under every mode", () => {
    for (const mode of [RANK_MODE.COMPETITION, RANK_MODE.DENSE, RANK_MODE.ORDINAL]) {
      const result = rankCohort(cohort, policy({ mode }));
      const tied = result.ranked.filter((entry) => entry.isTied).map((entry) => entry.subjectId);

      assert.deepEqual(tied, ["b", "c"], mode);
    }
  });

  it("numbers a three-way tie correctly under COMPETITION", () => {
    const threeWay = [
      subject("a", "8.0"),
      subject("b", "8.0"),
      subject("c", "8.0"),
      subject("d", "7.0"),
    ];

    assert.deepEqual(ranks(threeWay, policy({ mode: RANK_MODE.COMPETITION })), [
      "a:1",
      "b:1",
      "c:1",
      "d:4",
    ]);
  });

  it("numbers a whole cohort tied as rank 1 under COMPETITION and DENSE", () => {
    const allTied = [subject("a", "8"), subject("b", "8"), subject("c", "8")];

    assert.deepEqual(ranks(allTied, policy({ mode: RANK_MODE.COMPETITION })), [
      "a:1",
      "b:1",
      "c:1",
    ]);
    assert.deepEqual(ranks(allTied, policy({ mode: RANK_MODE.DENSE })), ["a:1", "b:1", "c:1"]);
  });
});

describe("rankCohort — the tie-break chain is configuration", () => {
  const tied = [
    subject("alice", "8.0", {
      sgpaScaled: toScaled("7.0"),
      creditsEarnedScaled: toScaled("20"),
      percentageScaled: toScaled("81"),
      displayName: "Alice",
      enrollmentNumber: "2024002",
    }),
    subject("bob", "8.0", {
      sgpaScaled: toScaled("9.0"),
      creditsEarnedScaled: toScaled("18"),
      percentageScaled: toScaled("79"),
      displayName: "Bob",
      enrollmentNumber: "2024001",
    }),
  ];

  it("breaks on SGPA when configured to", () => {
    assert.deepEqual(
      ranks(tied, policy({ mode: RANK_MODE.ORDINAL, keys: [RANK_KEY.CGPA, RANK_KEY.SGPA] })),
      ["bob:1", "alice:2"]
    );
  });

  it("breaks on CREDITS when configured to — and reverses the answer", () => {
    assert.deepEqual(
      ranks(tied, policy({ mode: RANK_MODE.ORDINAL, keys: [RANK_KEY.CGPA, RANK_KEY.CREDITS] })),
      ["alice:1", "bob:2"]
    );
  });

  it("breaks on PERCENTAGE when configured to", () => {
    assert.deepEqual(
      ranks(tied, policy({ mode: RANK_MODE.ORDINAL, keys: [RANK_KEY.CGPA, RANK_KEY.PERCENTAGE] })),
      ["alice:1", "bob:2"]
    );
  });

  it("breaks ALPHABETICALLY ascending, which is the ordinary direction", () => {
    assert.deepEqual(
      ranks(tied, policy({ mode: RANK_MODE.ORDINAL, keys: [RANK_KEY.CGPA, RANK_KEY.ALPHABETICAL] })),
      ["alice:1", "bob:2"]
    );
  });

  it("breaks on ENROLLMENT ascending", () => {
    assert.deepEqual(
      ranks(tied, policy({ mode: RANK_MODE.ORDINAL, keys: [RANK_KEY.CGPA, RANK_KEY.ENROLLMENT] })),
      ["bob:1", "alice:2"]
    );
  });

  it("walks the chain, stopping at the first key that separates", () => {
    const chained = [
      subject("x", "8.0", { sgpaScaled: toScaled("8.0"), creditsEarnedScaled: toScaled("22") }),
      subject("y", "8.0", { sgpaScaled: toScaled("8.0"), creditsEarnedScaled: toScaled("24") }),
    ];

    assert.deepEqual(
      ranks(
        chained,
        policy({
          mode: RANK_MODE.ORDINAL,
          keys: [RANK_KEY.CGPA, RANK_KEY.SGPA, RANK_KEY.CREDITS],
        })
      ),
      ["y:1", "x:2"],
      "CGPA and SGPA are equal, so credits decide"
    );
  });

  it("ranks on a non-CGPA primary key when configured to", () => {
    const byPercentage = [
      subject("a", null, { percentageScaled: toScaled("71") }),
      subject("b", null, { percentageScaled: toScaled("88") }),
    ];

    assert.deepEqual(
      ranks(byPercentage, policy({ keys: [RANK_KEY.PERCENTAGE] })),
      ["b:1", "a:2"]
    );
  });

  it("ranks a subject missing a tie-break key BEHIND one that has it", () => {
    const partial = [
      subject("has", "8.0", { sgpaScaled: toScaled("6.0") }),
      subject("lacks", "8.0"),
    ];

    assert.deepEqual(
      ranks(partial, policy({ mode: RANK_MODE.ORDINAL, keys: [RANK_KEY.CGPA, RANK_KEY.SGPA] })),
      ["has:1", "lacks:2"]
    );
  });
});

describe("rankCohort — nulls are excluded, not ranked last", () => {
  it("excludes a subject with no value for the primary key", () => {
    // A withheld result is not a bad result. Ranking it last would publish a
    // statement about performance that nobody has made.
    const result = rankCohort(
      [subject("a", "9"), subject("withheld", null), subject("b", "7")],
      policy()
    );

    assert.deepEqual(result.ranked.map((entry) => entry.subjectId), ["a", "b"]);
    assert.deepEqual(result.unranked, ["withheld"]);
  });

  it("counts outOf over the RANKED cohort only", () => {
    const result = rankCohort(
      [subject("a", "9"), subject("withheld", null), subject("b", "7")],
      policy()
    );

    assert.equal(result.ranked[0].outOf, 2);
  });

  it("returns everyone as unranked when nobody has a value", () => {
    const result = rankCohort([subject("a", null), subject("b", null)], policy());

    assert.deepEqual(result.ranked, []);
    assert.deepEqual(result.unranked, ["a", "b"]);
  });
});

describe("rankCohort — determinism", () => {
  const identical = [
    subject("zed", "8.0"),
    subject("amy", "8.0"),
    subject("moe", "8.0"),
  ];

  it("orders subjects equal on every key by subjectId, not by input order", () => {
    const forward = ranks(identical, policy({ mode: RANK_MODE.ORDINAL }));
    const reversed = ranks([...identical].reverse(), policy({ mode: RANK_MODE.ORDINAL }));

    assert.deepEqual(forward, reversed);
    assert.deepEqual(forward, ["amy:1", "moe:2", "zed:3"]);
  });

  it("still reports them as TIED, because the id is not a tie-break", () => {
    const result = rankCohort(identical, policy({ mode: RANK_MODE.ORDINAL }));

    assert.ok(result.ranked.every((entry) => entry.isTied));
  });

  it("gives the identical answer across ten shuffles of the same cohort", () => {
    const cohort = Array.from({ length: 60 }, (_value, index) =>
      subject(`s${String(index).padStart(3, "0")}`, String((index % 7) + 3), {
        sgpaScaled: toScaled(String((index % 5) + 4)),
      })
    );

    const expected = ranks(cohort, policy({ keys: [RANK_KEY.CGPA, RANK_KEY.SGPA] }));

    for (let shuffle = 1; shuffle <= 10; shuffle += 1) {
      // A fixed, seedless rotation — no Math.random, so a failure reproduces.
      const rotated = [...cohort.slice(shuffle * 5), ...cohort.slice(0, shuffle * 5)];

      assert.deepEqual(
        ranks(rotated, policy({ keys: [RANK_KEY.CGPA, RANK_KEY.SGPA] })),
        expected,
        `shuffle ${shuffle}`
      );
    }
  });
});

describe("rankCohort — scale", () => {
  const large = Array.from({ length: 1000 }, (_value, index) =>
    subject(`student_${String(index).padStart(4, "0")}`, String(((index * 7) % 700) / 100 + 3), {
      enrollmentNumber: `2024${String(index).padStart(4, "0")}`,
    })
  );

  it("ranks a thousand students", () => {
    const result = rankCohort(large, policy({ keys: [RANK_KEY.CGPA, RANK_KEY.ENROLLMENT] }));

    assert.equal(result.ranked.length, 1000);
    assert.equal(result.unranked.length, 0);
    assert.equal(result.ranked[0].rank, 1);
  });

  it("assigns ranks that never decrease down the list", () => {
    const result = rankCohort(large, policy({ keys: [RANK_KEY.CGPA, RANK_KEY.ENROLLMENT] }));

    for (let index = 1; index < result.ranked.length; index += 1) {
      assert.ok(
        result.ranked[index].rank >= result.ranked[index - 1].rank,
        `rank fell at position ${index}`
      );
    }
  });

  it("orders a thousand students by descending value", () => {
    const result = rankCohort(large, policy({ keys: [RANK_KEY.CGPA, RANK_KEY.ENROLLMENT] }));

    for (let index = 1; index < result.ranked.length; index += 1) {
      assert.ok(
        result.ranked[index].valueScaled <= result.ranked[index - 1].valueScaled,
        `value rose at position ${index}`
      );
    }
  });

  it("gives every distinct score its own COMPETITION rank across a large cohort", () => {
    const distinct = Array.from({ length: 500 }, (_value, index) =>
      subject(`s${String(index).padStart(3, "0")}`, String(index / 100))
    );

    const result = rankCohort(distinct, policy());

    assert.deepEqual(
      result.ranked.map((entry) => entry.rank).slice(0, 5),
      [1, 2, 3, 4, 5]
    );
    assert.equal(result.ranked[499].rank, 500);
  });
});

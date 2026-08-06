// ============================================================================
// OWNER  : Gauransh
// MODULE : Repositories — Test Double
// LAYER  : Testing support
// PURPOSE: A recording stand-in for a Prisma delegate, so repository tests can
//          assert WHAT WAS ASKED of the database without needing one.
//
// WHY THIS EXISTS AT ALL
//   A repository in this project contains no logic, so "does it compute the
//   right answer" is not a meaningful question. The meaningful questions are
//   structural, and every one of them is a security or correctness property:
//
//     • Is every query scoped by tenantId?          — tenant isolation
//     • Is a scheme-scoped query also scoped by      — cross-regulation leakage
//       schemeId?
//     • Does a write carry its own tenant predicate  — TOCTOU on the compound
//       rather than inheriting one?                    selector
//     • Is the ordering the one the engine depends    — pipeline correctness
//       on?
//     • Is a cleared JSON column stored as SQL NULL   — third-state bug
//       rather than JSON null?
//
//   None of those need a database to verify, and all of them would be
//   invisible to a service-level test using a fake repository — because that
//   fake replaces the very code under inspection here.
//
// WHAT IT IS NOT
//   Not a Prisma emulator. It returns whatever the test placed on it and
//   records the arguments it was called with. It executes no query logic, so a
//   passing test proves something about the REPOSITORY rather than about this
//   file.
// ============================================================================

/** One recorded call: the delegate, the operation, and the arguments. */
export interface RecordedCall {
  model: string;
  operation: string;
  args: Record<string, unknown>;
}

/** A delegate's recorded calls plus the value it should return. */
interface DelegateConfig {
  result: unknown;
}

/**
 * A recording Prisma double.
 *
 * `calls` is the assertion surface. `resultFor` pre-loads what a given
 * model/operation pair should return, defaulting to null for single reads and
 * [] for findMany so an unconfigured call behaves like an empty database
 * rather than throwing.
 */
export class FakePrismaClient {
  readonly calls: RecordedCall[] = [];

  private readonly results = new Map<string, DelegateConfig>();

  /** Pre-load the value a model/operation pair returns. */
  resultFor(model: string, operation: string, result: unknown): this {
    this.results.set(`${model}.${operation}`, { result });
    return this;
  }

  /** Every recorded call to one model/operation pair, in order. */
  callsTo(model: string, operation: string): RecordedCall[] {
    return this.calls.filter((call) => call.model === model && call.operation === operation);
  }

  /** The single recorded call to a model/operation pair. Fails loudly if not exactly one. */
  onlyCallTo(model: string, operation: string): RecordedCall {
    const matches = this.callsTo(model, operation);

    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${model}.${operation} call, recorded ${matches.length}`
      );
    }

    return matches[0];
  }

  /** Total statements issued — the query-count assertion for N+1 regressions. */
  get callCount(): number {
    return this.calls.length;
  }

  private record(model: string, operation: string, args: Record<string, unknown>): unknown {
    this.calls.push({ model, operation, args });

    const configured = this.results.get(`${model}.${operation}`);

    if (configured !== undefined) {
      return configured.result;
    }

    // An unconfigured read behaves like an empty database rather than throwing,
    // so a test asserting only on query SHAPE need not also stub a return value.
    if (operation === "findMany") {
      return [];
    }

    if (operation === "aggregate") {
      // Mirrors Prisma's aggregate shape. An unconfigured aggregate reports no
      // maximum, which is what an empty table returns.
      return { _max: { sequenceNumber: null } };
    }

    if (operation === "count") {
      // An unconfigured count reports an empty table, matching findMany above.
      return 0;
    }

    if (operation === "updateMany") {
      return { count: 1 };
    }

    if (operation === "deleteMany" || operation === "createMany") {
      // Mirrors Prisma's batch-payload shape. The count reflects the rows
      // actually handed over, so a repository returning result.count is
      // exercised rather than stubbed.
      const rows = args.data;
      return { count: Array.isArray(rows) ? rows.length : 0 };
    }

    return null;
  }

  /** Build a delegate exposing the operations the repositories actually use. */
  private delegate(model: string) {
    return {
      findMany: async (args: Record<string, unknown>) => this.record(model, "findMany", args),
      count: async (args: Record<string, unknown>) => this.record(model, "count", args),
      findFirst: async (args: Record<string, unknown>) => this.record(model, "findFirst", args),
      aggregate: async (args: Record<string, unknown>) => this.record(model, "aggregate", args),
      create: async (args: Record<string, unknown>) => this.record(model, "create", args),
      createMany: async (args: Record<string, unknown>) => this.record(model, "createMany", args),
      update: async (args: Record<string, unknown>) => this.record(model, "update", args),
      updateMany: async (args: Record<string, unknown>) => this.record(model, "updateMany", args),
      delete: async (args: Record<string, unknown>) => this.record(model, "delete", args),
      deleteMany: async (args: Record<string, unknown>) => this.record(model, "deleteMany", args),
    };
  }

  get evaluationRule() {
    return this.delegate("evaluationRule");
  }

  get passingCriterion() {
    return this.delegate("passingCriterion");
  }

  get courseRegistration() {
    return this.delegate("courseRegistration");
  }

  // The reference delegates. Course Registration is the only module that
  // resolves rows it does not own — student, course, semester and section —
  // because no repository exists for any of them, and every one of those
  // lookups must be tenant-scoped or a cross-tenant enrolment becomes possible.
  get student() {
    return this.delegate("student");
  }

  get course() {
    return this.delegate("course");
  }

  get semester() {
    return this.delegate("semester");
  }

  get section() {
    return this.delegate("section");
  }

  get assessmentEvent() {
    return this.delegate("assessmentEvent");
  }

  get evaluationComponent() {
    return this.delegate("evaluationComponent");
  }

  get facultyMember() {
    return this.delegate("facultyMember");
  }

  get studentComponentScore() {
    return this.delegate("studentComponentScore");
  }

  // --- Phase 17 finance delegates -------------------------------------------
  //
  // Added additively for the Student Finance read layer. The existing getters
  // above are untouched, so every prior suite behaves exactly as before.

  get payment() {
    return this.delegate("payment");
  }

  get feeDemand() {
    return this.delegate("feeDemand");
  }

  get feeStructure() {
    return this.delegate("feeStructure");
  }
}

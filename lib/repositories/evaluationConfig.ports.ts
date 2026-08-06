// ============================================================================
// OWNER  : Gauransh
// MODULE : Phase 16 Configuration — Cross-Aggregate Ports
// LAYER  : Repository (contracts only)
// PURPOSE: The narrow read contracts the rule and criterion services need from
//          aggregates they do not own.
//
// WHY THESE ARE DECLARED HERE AND NOT ON THE OWNING REPOSITORIES
//   Interface Segregation: the CONSUMER owns the abstraction it depends on. The
//   rule service needs one read from EvaluationScheme and one from
//   EvaluationComponent, so it depends on exactly those two methods rather than
//   on two whole repository classes. Narrowing at the type level is what makes
//   it impossible for rule handling to quietly start mutating a component.
//
//   Declaring them here rather than inside the owning repositories also leaves
//   C1–C3 untouched, and puts every cross-aggregate dependency in this phase in
//   one file — so "what does the rule service reach into?" is answerable by
//   reading eight lines rather than by grepping.
//
// WHY NOT A DEDICATED QUERY
//   Both ports reuse an existing findById rather than adding a narrower
//   projection. The cost is a handful of extra columns on a configuration table
//   read once per mutation, which is not measurable; a second definition of a
//   read that already exists is a real maintenance cost. Optimize only where
//   measurable.
// ============================================================================

import type { EvaluationComponentRepository } from "@/lib/repositories/evaluationComponent.repository";
import type { EvaluationSchemeRepository } from "@/lib/repositories/evaluationScheme.repository";

/**
 * Reads the owning regulation so a service can decide whether its
 * configuration is still mutable. Returns the full scheme record; only
 * `status` is consulted.
 */
export type EvaluationSchemeLifecyclePort = Pick<EvaluationSchemeRepository, "findById">;

/**
 * Resolves a component within a scheme, so a service can prove a referenced
 * component exists and read its `maxMarks`. Scoped by tenant AND scheme by the
 * underlying query, so a component of another regulation is unreachable.
 */
export type EvaluationComponentLookupPort = Pick<EvaluationComponentRepository, "findById">;

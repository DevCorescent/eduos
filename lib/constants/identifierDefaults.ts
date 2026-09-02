// ============================================================================
// MODULE : Identifier engine — default sequences for a new university
// LAYER  : Constants
// PURPOSE: Give every provisioned university a working counter for each entity
//          the application actually issues identifiers for.
//
// WHY THIS EXISTS
//   generateIdentifier REFUSES to issue unless a sequence row is configured —
//   deliberately, so no identifier is ever minted from an invented format. But
//   nothing created those rows: not provisioning, not the seed. The result was
//   that two MVP modules could not run at all on a fresh tenant, because
//   neither has a field for the number and both generate it:
//
//     Admissions (PRD 8.2)  — APPLICANT + APPLICATION, issued inside the
//                             application transaction, which fails whole.
//     Certificates (PRD 19) — CERTIFICATE, and the issue form has no input
//                             for a certificate number at all.
//
//   Student, faculty and employee creation degrade more quietly: the number is
//   generated only when the caller omits it, so the automation PRD 51 lists as
//   MVP ("Automated student IDs", "Automated employee IDs") simply never ran.
//
// THESE ARE DEFAULTS, NOT POLICY
//   PRD 9.3 requires formats to be configurable, and /setup/identifiers already
//   is that surface. Provisioning seeds a working starting point; the
//   university changes prefix, padding, format and reset cycle there
//   afterwards. Nothing here overwrites an administrator's configuration —
//   see the upsert in universityProvisioning.
//
// WHY THE FORMAT IS THE PLAIN ONE
//   `{PREFIX}{YEAR}{SEQ}` is the engine's own default and uses only tokens that
//   need no context. PRD 9.2's richer examples embed {CAMPUS} and {DEPT}, which
//   resolve against records that do not exist yet when a tenant is created — a
//   default referring to them would render blank segments on the first ID
//   issued. A university that wants them adds them in the UI.
// ============================================================================

import { SequenceReset } from "@/app/generated/prisma/enums";
import type { IdentifierEntity } from "@/lib/services/identifier.service";

export interface DefaultSequence {
  readonly entityType: IdentifierEntity;
  readonly prefix: string;
}

/**
 * One default per entity the application issues identifiers for.
 *
 * The list is exactly IDENTIFIER_ENTITIES — every type with a real consumer.
 * A type present here but not there would create a counter nothing reads; the
 * reverse would leave a caller throwing NO_SEQUENCE, which is the bug this
 * fixes. A test asserts the two agree.
 *
 * Prefixes are distinct so an identifier is self-describing at a glance:
 * APL- and APP- separate the applicant from their application, which PRD 9.1
 * lists as two different numbers.
 */
export const DEFAULT_ID_SEQUENCES: readonly DefaultSequence[] = [
  { entityType: "APPLICANT", prefix: "APL-" },
  { entityType: "APPLICATION", prefix: "APP-" },
  { entityType: "STUDENT", prefix: "STU-" },
  { entityType: "FACULTY", prefix: "FAC-" },
  { entityType: "EMPLOYEE", prefix: "EMP-" },
  { entityType: "CERTIFICATE", prefix: "CERT-" },
];

/** The engine's own default format. Only context-free tokens. */
export const DEFAULT_ID_FORMAT = "{PREFIX}{YEAR}{SEQ}";

/**
 * Five digits, not the schema's four.
 *
 * Padding applies to {SEQ} alone and the counter resets yearly, so this is
 * "identifiers issued per year": four digits caps a university at 9,999
 * students in an intake, which a mid-sized institution passes. Five is the
 * smallest width that does not need revisiting, and widening it later would
 * make new identifiers sort differently from ones already printed.
 */
export const DEFAULT_ID_PADDING = 5;

/**
 * Yearly, matching the schema default and PRD 9.3 "Reset sequence annually".
 *
 * Safe precisely because {YEAR} is in the format: the counter restarting each
 * January cannot collide with last year's numbers.
 */
export const DEFAULT_ID_RESET: SequenceReset = SequenceReset.YEARLY;

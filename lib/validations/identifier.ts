import { z } from "zod";
import { identifier } from "@/lib/validations/shared";
import { SequenceReset } from "@/app/generated/prisma/enums";
import { IDENTIFIER_ENTITIES } from "@/lib/services/identifier.service";
import { unknownTokens } from "@/lib/domain/identifier/format";

// ============================================================================
// MODULE : Validations — Identifier Engine (PRD §9)
// PURPOSE: Refuse a sequence configuration that would issue a broken
//          identifier, at the boundary, before it can be saved.
//
// WHY THE FORMAT IS VALIDATED RATHER THAN ACCEPTED
//   A format is a template applied to every future record. "{PREFIX}{YAER}{SEQ}"
//   saves cleanly, renders "STU-0001" forever, and nobody notices until a year
//   of enrolment numbers is missing its year. The token list is closed and
//   checked here, so the typo is a 400 at configuration time rather than a
//   silent defect in the register.
// ============================================================================

/**
 * The sequence must actually issue a number.
 *
 * A format with no {SEQ} renders the same string for every record, which for
 * enrolment numbers means the second student collides with the first on the
 * unique index — a confusing 409 at admission time whose cause is a setting
 * saved months earlier.
 */
const formatString = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => value.includes("{SEQ}"), {
    message: "The format must contain {SEQ}, or every record would be issued the same identifier.",
  })
  .refine((value) => unknownTokens(value).length === 0, {
    message: "The format references a token this engine cannot render.",
  });

/**
 * Padding is capped at 12.
 *
 * Not arbitrary: the sequence is an Int, so anything beyond ten digits is
 * padding that can never be filled, and a hundred-character identifier does not
 * fit an ID card.
 */
const padding = z.coerce.number().int().min(0).max(12);

/**
 * The scope key, empty for a tenant-wide counter.
 *
 * Accepted as a plain string rather than validated as a campus id: the column
 * is a free dimension by design (campus today, programme tomorrow), and
 * constraining it to one relation here would prevent the other.
 */
const scopeKey = z.string().trim().max(64).default("");

export const createIdSequenceSchema = z
  .object({
    entityType: z.enum(IDENTIFIER_ENTITIES),
    scopeKey,
    prefix: z.string().trim().max(24).nullish(),
    suffix: z.string().trim().max(24).nullish(),
    format: formatString.default("{PREFIX}{YEAR}{SEQ}"),
    padding: padding.default(4),
    resetCycle: z.enum(SequenceReset).default(SequenceReset.YEARLY),
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * `lastSequence` is deliberately ABSENT from the update contract.
 *
 * Rewinding a counter reissues identifiers that are already printed on
 * certificates and quoted in transcripts — the one change to this table that
 * can corrupt records that have already left the building. Resetting is a
 * separate, explicit endpoint so it can never happen as a side effect of
 * editing a prefix.
 */
export const updateIdSequenceSchema = z
  .object({
    prefix: z.string().trim().max(24).nullish(),
    suffix: z.string().trim().max(24).nullish(),
    format: formatString.optional(),
    padding: padding.optional(),
    resetCycle: z.enum(SequenceReset).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Supply at least one field to update.",
  });

export const idSequenceParamSchema = z.object({ id: identifier });

export const previewIdSequenceQuerySchema = z
  .object({
    entityType: z.enum(IDENTIFIER_ENTITIES),
    scopeKey: z.string().trim().max(64).optional(),
  })
  .strict();

"use server";

// ============================================================================
// MODULE : Actions — Identifier Sequences (PRD §9)
// PURPOSE: The two writes the configuration screen performs, as Server Actions.
//
//          Neither issues an identifier. Generation happens only inside the
//          transaction that creates a student, faculty member, employee or
//          certificate — there is no path from the browser to a number.
// ============================================================================

import {
  createIdSequence,
  updateIdSequence,
  type IdSequenceInput,
} from "@/services/identifiers";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { SequenceReset } from "@/app/generated/prisma/enums";
import type { IdentifierEntity } from "@/lib/services/identifier.service";
import type { ActionResult } from "./setup";

/** An empty text input means "not set", not an empty prefix. */
function optionalText(values: FormValues, key: string): string | null {
  const value = String(values[key] ?? "").trim();
  return value === "" ? null : value;
}

function readInput(values: FormValues): Omit<IdSequenceInput, "entityType" | "scopeKey"> {
  return {
    prefix: optionalText(values, "prefix"),
    suffix: optionalText(values, "suffix"),
    format: String(values.format ?? "").trim(),
    padding: Number(values.padding),
    resetCycle: String(values.resetCycle) as SequenceReset,
    isActive: Boolean(values.isActive),
  };
}

export async function createIdSequenceAction(values: FormValues): Promise<ActionResult> {
  const result = await createIdSequence({
    entityType: String(values.entityType) as IdentifierEntity,
    scopeKey: String(values.scopeKey ?? "").trim(),
    ...readInput(values),
  });

  // A duplicate is a conflict on the entity/scope pair, so the message is put
  // on the field the reader must change rather than in a banner above the form.
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field: "entityType" };
  }

  return result;
}

/**
 * Edit one sequence's formatting, or retire it.
 *
 * `entityType`, `scopeKey` and `lastSequence` are not reachable from here —
 * the first two are the counter's identity, and the third is the counter. See
 * the route header for why rewinding is not an editable field.
 */
export async function updateIdSequenceAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  return updateIdSequence(id, readInput(values));
}

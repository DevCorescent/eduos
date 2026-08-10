// ============================================================================
// MODULE : Services — Identifier Sequences (PRD §9)
// PURPOSE: The registrar's view of the numbering configuration.
//
//          There is deliberately no `generate` here. Issuing a number is a
//          side effect of creating a record, performed server-side inside that
//          record's transaction — a frontend service that could burn numbers
//          would let a page refresh inflate a certificate series.
// ============================================================================

import type { ApiResponse } from "@/types";
import type { SequenceReset } from "@/app/generated/prisma/enums";
import type { IdentifierEntity } from "@/lib/services/identifier.service";
import { apiRequest } from "./client";

export interface IdSequenceRow {
  id: string;
  tenantId: string;
  entityType: IdentifierEntity;
  scopeKey: string;
  prefix: string | null;
  suffix: string | null;
  format: string;
  padding: number;
  lastSequence: number;
  resetCycle: SequenceReset;
  lastResetYear: number | null;
  lastResetMonth: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every sequence this institution has configured.
 *
 * Unpaginated by design: the entity union is closed and short, so the whole
 * collection is a handful of rows. The route says the same.
 */
export async function listIdSequences(): Promise<
  ApiResponse<{ sequences: IdSequenceRow[] }>
> {
  return apiRequest<{ sequences: IdSequenceRow[] }>("/api/identifier-sequences");
}

export interface IdSequenceInput {
  entityType: IdentifierEntity;
  scopeKey?: string;
  prefix?: string | null;
  suffix?: string | null;
  format?: string;
  padding?: number;
  resetCycle?: SequenceReset;
  isActive?: boolean;
}

export async function createIdSequence(
  input: IdSequenceInput
): Promise<ApiResponse<IdSequenceRow>> {
  return apiRequest<IdSequenceRow>("/api/identifier-sequences", {
    method: "POST",
    body: input,
  });
}

/**
 * `entityType`, `scopeKey` and `lastSequence` are absent from the update type.
 *
 * The first two form the counter's identity and the third is the counter. The
 * route rejects all three; the type says so here too, so a form cannot even be
 * built that offers to rewind a live series.
 */
export async function updateIdSequence(
  id: string,
  input: Omit<IdSequenceInput, "entityType" | "scopeKey">
): Promise<ApiResponse<IdSequenceRow>> {
  return apiRequest<IdSequenceRow>(`/api/identifier-sequences/${id}`, {
    method: "PATCH",
    body: input,
  });
}

/** What the next identifier would be. Reads only — issues nothing. */
export async function previewIdSequence(
  entityType: IdentifierEntity,
  scopeKey?: string
): Promise<ApiResponse<{ preview: string; nextSequence: number; willReset: boolean }>> {
  return apiRequest<{ preview: string; nextSequence: number; willReset: boolean }>(
    "/api/identifier-sequences/preview",
    { params: { entityType, ...(scopeKey ? { scopeKey } : {}) } }
  );
}

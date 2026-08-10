// ============================================================================
// MODULE : Services — AI (PRD §40.1)
// PURPOSE: The one AI endpoint a student may call, wrapped so no page touches
//          fetch directly.
//
// NOT MARKED "server-only"
//   Unlike services/portal.ts, this is called from a client component: the
//   assistant is a typed question and a rendered answer, which is interaction,
//   not data loading. It goes through the same apiRequest as every other
//   service, so a transport failure comes back as the standard envelope rather
//   than as a thrown rejection inside an event handler.
//
// THE OTHER TWO AI ROUTES ARE ABSENT ON PURPOSE
//   POST /api/ai/summarise and /api/ai/generate-questions exist and are
//   faculty-facing (§40.2). Wrapping them here would put them one import away
//   from a student screen; they belong in a faculty service when that portal
//   grows a use for them.
// ============================================================================

import type { ApiResponse } from "@/types";
import { apiRequest } from "./client";

export interface AskAiResult {
  /** The provider's answer, verbatim. The route does not trim or reformat it. */
  answer: string;
}

/**
 * Ask a free-text question.
 *
 * ACCESS : UNIVERSITY_ADMIN · FACULTY · STUDENT, enforced by the route.
 * RETURNS: the envelope. A provider timeout and a provider failure are both
 *          ordinary failure envelopes here — the caller renders the message and
 *          does not retry, because the route does not retry either.
 */
export async function askAi(question: string): Promise<ApiResponse<AskAiResult>> {
  return apiRequest<AskAiResult>("/api/ai/ask", {
    method: "POST",
    body: { question },
  });
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : AI (Groq) — Request Validation
// FLOW   : Validates the three AI request bodies before either reaches a route.
// ACCESS : Not defined. The README's Phase 14 table describes /api/ai/ask as
//          "General Q&A for students/faculty" but assigns no role to any of the
//          three endpoints, and no approved decision assigns one, so none is
//          assumed here. Access control is performed by requireRole and the
//          routes regardless — this module never inspects a caller.
// BACKEND: None. Zod schema definitions only — no database access, no Prisma
//          model, and no provider client. This is the first validation module in
//          the project with no Prisma model behind it: the schema declares no AI
//          model of any kind, so these schemas describe request payloads rather
//          than mirroring writable columns.
// PURPOSE: Keep AI request validation declarative and in one place, matching the
//          existing per-module validation convention.
// ============================================================================

import { z } from "zod";

/**
 * Body schema for POST /api/ai/ask.
 *
 * question is trimmed and must be non-empty once trimmed. It is a short,
 * user-typed prompt, so the project-wide treatment of short string inputs
 * applies: surrounding whitespace is insignificant and a whitespace-only
 * question is rejected rather than forwarded.
 *
 * Nothing else is asserted. No length bound, no language check, no model or
 * provider name, no token count, no temperature and no output contract — the
 * README names the endpoint and states no parameter for it, so anything further
 * would be inventing one.
 */
export const askAiSchema = z.object({
  question: z.string().trim().min(1),
});

export type AskAiInput = z.infer<typeof askAiSchema>;

/**
 * Body schema for POST /api/ai/summarise.
 *
 * content is required and must be non-empty, but is deliberately NOT trimmed.
 * Unlike a question it is source material — course notes, a transcript, a
 * document — and its leading and trailing whitespace can be significant to
 * whatever reads it, so it is preserved exactly as sent. This matches the
 * treatment of NotificationTemplate.body and Notification.body, where message
 * content is likewise stored verbatim while short fields around it are trimmed.
 *
 * The consequence is that a whitespace-only content passes .min(1), since there
 * is nothing to trim it down to zero length. That follows from preserving content
 * verbatim and is recorded as technical debt rather than resolved by adding a
 * rule.
 *
 * No length bound is applied. The endpoint has no declared maximum, no token
 * budget and no chunking rule, so a large document is accepted here and whatever
 * limit a provider imposes is the route's to discover.
 */
export const summariseSchema = z.object({
  content: z.string().min(1),
});

export type SummariseInput = z.infer<typeof summariseSchema>;

/**
 * Body schema for POST /api/ai/generate-questions.
 *
 * content follows the same rule as summarise: required, non-empty, preserved
 * verbatim with no trim, and no length bound.
 *
 * count is a required integer bounded to 1..20 inclusive. It is validated as a
 * plain z.number().int() rather than being coerced: this is a JSON request body,
 * where a number arrives as a number, and coercion is reserved in this project
 * for query strings, where every value arrives as text. The bounds are the
 * approved rule and are asserted exactly — 0 and 21 are rejected, 1 and 20 are
 * accepted — and a non-integer such as 5.5 is rejected rather than rounded.
 *
 * Nothing is asserted about the questions themselves: no type, no difficulty, no
 * format, no answer key and no output shape. The README describes the endpoint as
 * "Generate quiz from content" and defines no parameter beyond what is here.
 */
export const generateQuestionsSchema = z.object({
  content: z.string().min(1),
  count: z.number().int().min(1).max(20),
});

export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;

// Every schema is a plain z.object(), so an unknown key is stripped rather than
// rejected — the project-wide behaviour, since no schema in this project uses
// .strict(). A body naming a model, provider, temperature, maxTokens, language or
// format therefore has it dropped and never reaches a route.
//
// Nothing here validates an AI response. These schemas describe what a caller may
// send; what a provider returns is not a request and is not this module's to
// check. No markdown, HTML, token count or output shape is asserted anywhere.
//
// No persistence rule is expressed either. The schema declares no AI model, so
// there is nothing to write and no id param schema to declare — this module has
// no counterpart to the *IdParamSchema every other validation module exports.

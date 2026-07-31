// ============================================================================
// OWNER  : Gauransh
// MODULE : AI (Groq) — Quiz Generation
// FLOW   : Guard → tenant → body → one Groq completion → shape check → questions.
// ACCESS : UNIVERSITY_ADMIN · FACULTY · STUDENT. PARENT has no access. All three
//          permitted roles receive the identical treatment.
// BACKEND: lib/services/groq.ts only. This route touches no Prisma model: it
//          reads no row, writes no row and imports no client. requireTenant
//          resolves the tenant, which is a read the guard performs on every
//          protected route; the handler itself performs none.
// PURPOSE: Turn one block of supplied text into exactly `count` multiple-choice
//          questions and return them. Nothing is stored, remembered, cached or
//          logged.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { groqCompletion } from "@/lib/services/groq";
import { generateQuestionsSchema } from "@/lib/validations/ai";
import { ok, fail } from "@/types";

/** Built on provider failure — the provider's own response is never forwarded. */
function providerError(): NextResponse {
  return NextResponse.json(fail("AI provider request failed", "PROVIDER_ERROR"), { status: 502 });
}

/** Built when the provider did not answer within the deadline. */
function providerTimeout(): NextResponse {
  return NextResponse.json(fail("AI provider request timed out", "PROVIDER_TIMEOUT"), { status: 504 });
}

/** Options per question. Fixed by the approved rules, not by the request. */
const OPTIONS_PER_QUESTION = 4;

/**
 * The instruction sent with the caller's content.
 *
 * Unlike /api/ai/ask and /api/ai/summarise, this route DOES compose a prompt.
 * That is not a departure: those two are forbidden from modifying their input,
 * while this endpoint's contract is a specific structure — MCQ only, exactly
 * `count` questions, exactly four options each, one correct answer — and a model
 * cannot produce it unless it is told to. Every line below states an approved
 * rule and nothing else. No difficulty, topic, style, language or question type
 * beyond MCQ is specified, because none is defined anywhere.
 *
 * The caller's content is appended last and unaltered — not trimmed, not
 * truncated, not chunked and not reformatted. It is treated as raw text: no file
 * is opened, no URL is fetched and no markup is parsed.
 *
 * The no-duplicates rule is stated to the model rather than enforced in code.
 * Dropping a repeated question would break the exact-`count` guarantee, and the
 * rule itself is qualified — "when reasonably avoidable" — so it is a preference
 * the model applies, not an invariant this route can assert.
 */
function buildPrompt(content: string, count: number): string {
  return [
    `You generate multiple-choice quiz questions. Produce exactly ${count} question(s) from the material below.`,
    "",
    "Requirements:",
    `- Exactly ${count} question(s).`,
    `- Each question has exactly ${OPTIONS_PER_QUESTION} options.`,
    "- Exactly one option is correct.",
    '- The "answer" value must be the exact text of the correct option.',
    "- Avoid repeating a question where reasonably possible.",
    "",
    // The shape is described key by key rather than shown as a skeleton with
    // ellipsis placeholders. A skeleton is copied structurally and the model
    // reproduces its punctuation unreliably, which Groq's JSON mode then rejects
    // outright; a described shape produced valid JSON on every measured run.
    'Return only a JSON object with a single key "questions", whose value is an array of objects.',
    `Each object has exactly three keys: "question" (string), "options" (array of exactly ${OPTIONS_PER_QUESTION} strings), and "answer" (string).`,
    "Use standard JSON: double-quoted keys and strings, no trailing commas, no comments, no markdown.",
    "",
    "Material:",
    content,
  ].join("\n");
}

/** One question as the response contract declares it. */
type GeneratedQuestion = {
  question: string;
  options: string[];
  answer: string;
};

/**
 * Validate the model's output against the declared contract.
 *
 * Returns the questions when the payload matches exactly, or null when it does
 * not — which the caller reports as a provider failure, the same treatment
 * app/api/ai/ask gives a 200 carrying an unexpected shape. Nothing is repaired,
 * padded, trimmed to length or re-requested: this route does not retry.
 *
 * Only the stated rules are asserted: exactly `count` questions, exactly four
 * non-empty option strings each, a non-empty question and a non-empty answer.
 * That the answer must match one of the options is instructed in the prompt but
 * NOT asserted here — the response contract declares `answer` as a plain string,
 * and rejecting an otherwise well-formed set over a formatting nuance would
 * refuse a usable answer on a rule no source states.
 */
function parseQuestions(raw: string, count: number): GeneratedQuestion[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const questions = (payload as { questions?: unknown })?.questions;
  if (!Array.isArray(questions) || questions.length !== count) {
    return null;
  }

  const parsed: GeneratedQuestion[] = [];

  for (const entry of questions) {
    const question = (entry as { question?: unknown })?.question;
    const options = (entry as { options?: unknown })?.options;
    const answer = (entry as { answer?: unknown })?.answer;

    if (typeof question !== "string" || question.length === 0) return null;
    if (typeof answer !== "string" || answer.length === 0) return null;
    if (!Array.isArray(options) || options.length !== OPTIONS_PER_QUESTION) return null;
    if (!options.every((option) => typeof option === "string" && option.length > 0)) return null;

    // Rebuilt field by field rather than spread, so anything else the model
    // returned alongside — an id, an explanation, a difficulty — is dropped and
    // the response carries exactly the declared shape.
    parsed.push({ question, options: options as string[], answer });
  }

  return parsed;
}

// POST
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, decided by one requireRole
//              call — the same three roles the other two AI routes admit.
// VALIDATION : generateQuestionsSchema — content required and non-empty and
//              deliberately not trimmed, count a required integer in 1..20. Every
//              other key is stripped by the plain z.object(), so a body naming a
//              model, provider, temperature, top_p, max_tokens or stream has it
//              dropped and it never reaches the provider. The client cannot
//              influence any generation parameter, because none is read from the
//              request at any point.
// FLOW       : Authorise → resolve tenant → parse body → one completion →
//              validate the shape → return.
//
//              TENANT. requireTenant runs and its failure is returned as-is, so
//              an unresolvable host is refused before any provider call and no
//              request is billed for a caller whose tenant does not resolve. The
//              tenant is not sent to the provider, not mixed into the prompt and
//              not recorded.
//
//              PROVIDER. One call through lib/services/groq.ts, which holds the
//              URL, the model and the deadline. JSON output is requested because
//              this endpoint's declared contract is structured; that flag is set
//              here, server-side, and is unreachable from a request. The call is
//              not retried, not queued and not streamed.
//
//              SHAPE. The model's output is validated against the declared
//              contract before anything is returned, and a mismatch is a provider
//              failure rather than a partial answer — a caller receives exactly
//              `count` well-formed questions or an error, never a short or
//              malformed list.
//
//              NOT DONE HERE. Nothing is persisted: no prompt, no questions, no
//              usage figure. No Prisma model is imported, so no database row can
//              be read or written. Nothing is cached, so identical content is a
//              fresh call every time. Nothing is logged — like the other two AI
//              routes, this file contains no console call.
// RESPONSE   : { success: true, data: { questions: [{ question, options, answer }] } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN
//              404 NOT_FOUND · 502 PROVIDER_ERROR · 504 PROVIDER_TIMEOUT
//              500 SERVER_ERROR
//
//              502 and 504 carry fixed messages. The provider's status line, its
//              response body, the API key and any stack trace are never included
//              in a response.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY", "STUDENT");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = generateQuestionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { content, count } = parsed.data;

    const result = await groqCompletion(buildPrompt(content, count), { jsonObject: true });

    if (!result.ok) {
      return result.reason === "timeout" ? providerTimeout() : providerError();
    }

    const questions = parseQuestions(result.content, count);
    if (!questions) {
      return providerError();
    }

    return NextResponse.json(ok({ questions }));
  } catch {
    // Deliberately no console call and no error detail: this route must not log,
    // and a stack trace must never reach a caller.
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

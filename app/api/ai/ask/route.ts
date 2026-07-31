// ============================================================================
// OWNER  : Gauransh
// MODULE : AI (Groq) — General Q&A
// FLOW   : Guard → tenant → body → one Groq completion → answer.
// ACCESS : UNIVERSITY_ADMIN · FACULTY · STUDENT. PARENT has no access. All three
//          permitted roles receive the identical treatment — nothing about the
//          request or the answer varies by role.
// BACKEND: lib/services/groq.ts only. This route touches no Prisma model: it
//          reads no row, writes no row and imports no client. requireTenant
//          resolves the tenant, which is a read the guard performs on every
//          protected route; the handler itself performs none.
// PURPOSE: Answer one question with one model call and return the answer. Nothing
//          is stored, remembered, cached or logged.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { groqCompletion } from "@/lib/services/groq";
import { askAiSchema } from "@/lib/validations/ai";
import { ok, fail } from "@/types";

// The provider endpoint, the model and the request deadline used to be declared
// here. They now live in lib/services/groq.ts, which holds the identical values
// and the identical failure classification — so the URL called, the model used,
// the 30s deadline and the mapping of every failure onto 502 or 504 are unchanged.
// The client still cannot reach any of them: nothing below is read from a request.

/** Built on provider failure — the provider's own response is never forwarded. */
function providerError(): NextResponse {
  return NextResponse.json(fail("AI provider request failed", "PROVIDER_ERROR"), { status: 502 });
}

/** Built when the provider did not answer within the deadline. */
function providerTimeout(): NextResponse {
  return NextResponse.json(fail("AI provider request timed out", "PROVIDER_TIMEOUT"), { status: 504 });
}

// POST
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, decided by one requireRole
//              call. No elevated-first two-tier logic appears here: all three
//              roles get the same endpoint with the same behaviour, so there is
//              no second scope to define. PARENT and any unpermitted caller
//              receive the guard's 403.
// VALIDATION : askAiSchema — question required, trimmed, non-empty. Every other
//              key is stripped by the plain z.object(), so a body naming a model,
//              provider, temperature, top_p, max_tokens or stream has it dropped
//              and it never reaches the call below. The client cannot influence
//              any generation parameter, because none of them is read from the
//              request at any point.
// FLOW       : Authorise → resolve tenant → parse body → one HTTP call to Groq →
//              return the answer.
//
//              TENANT. requireTenant runs and its failure is returned as-is, so
//              an unresolvable host is refused before any provider call is made
//              and no request is billed for a caller whose tenant does not
//              resolve. The resolved tenant is not otherwise used: it is not sent
//              to the provider, not mixed into the prompt and not recorded,
//              because nothing here is stored and the schema declares no AI model
//              to scope.
//
//              PROMPT. The validated question is sent exactly as validated, as a
//              single user message. No system prompt is injected, no instruction
//              is prepended or appended, no conversation history is loaded and no
//              memory is consulted — the messages array is one element long on
//              every request. No file is read, no URL is fetched and no previous
//              chat is looked at.
//
//              PROVIDER. One fetch, to a fixed URL, with a fixed model. The call
//              is not retried, not queued and not scheduled: a failure is
//              reported, never re-attempted. The API key is read from the
//              environment at call time and appears only in the outbound
//              Authorization header.
//
//              The request carries no temperature, top_p, max_tokens or stream
//              field at all, so the provider's own defaults apply and there is
//              nothing for a client to override.
//
//              NOT DONE HERE. Nothing is persisted: no prompt, no answer, no
//              usage figure and no timing. Nothing is cached, so an identical
//              question is a fresh call every time. Nothing is logged — this is
//              the only route in the project with no console call, deliberately,
//              so a prompt or an answer cannot reach a log file. The answer is
//              returned as the provider's plain text; no markdown is rendered and
//              no HTML is generated.
// RESPONSE   : { success: true, data: { answer } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN
//              404 NOT_FOUND · 502 PROVIDER_ERROR · 504 PROVIDER_TIMEOUT
//              500 SERVER_ERROR
//
//              502 and 504 carry fixed messages. The provider's status line, its
//              response body, the API key and any stack trace are never included
//              in a response — a caller learns that the provider failed, and
//              nothing about how.
//
//              A missing GROQ_API_KEY is reported as 502 rather than 500: from a
//              caller's position the provider is unusable either way, and the
//              distinction would disclose server configuration.
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

    const parsed = askAiSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // One call, through the shared service. Not retried, not queued. The prompt
    // is the validated question exactly as validated, sent as a single user
    // message — the service injects no system message, loads no history and sends
    // no generation parameter. JSON mode is not requested, so the outbound body
    // is what this route sent before the extraction: model plus one user message.
    //
    // The service classifies every failure into the same two cases this route
    // handled inline — "timeout" for an elapsed deadline, "provider" for a missing
    // key, a network failure, a non-2xx status, an unparseable body or a 200
    // carrying an unexpected shape — so the status codes below are unchanged.
    const result = await groqCompletion(parsed.data.question);

    if (!result.ok) {
      return result.reason === "timeout" ? providerTimeout() : providerError();
    }

    // The answer is returned exactly as the provider produced it — not trimmed,
    // not rendered, not reformatted.
    return NextResponse.json(ok({ answer: result.content }));
  } catch {
    // Deliberately no console call and no error detail: this route must not log,
    // and a stack trace must never reach a caller.
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

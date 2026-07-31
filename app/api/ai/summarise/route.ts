// ============================================================================
// OWNER  : Gauransh
// MODULE : AI (Groq) — Content Summarisation
// FLOW   : Guard → tenant → body → one Groq completion → summary.
// ACCESS : UNIVERSITY_ADMIN · FACULTY · STUDENT. PARENT has no access. All three
//          permitted roles receive the identical treatment — nothing about the
//          request or the summary varies by role.
// BACKEND: lib/services/groq.ts only. This route touches no Prisma model: it
//          reads no row, writes no row and imports no client. requireTenant
//          resolves the tenant, which is a read the guard performs on every
//          protected route; the handler itself performs none.
// PURPOSE: Summarise one block of supplied text with one model call and return
//          the summary. Nothing is stored, remembered, cached or logged.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { groqCompletion } from "@/lib/services/groq";
import { summariseSchema } from "@/lib/validations/ai";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// The provider endpoint, the model and the request deadline used to be declared
// here, duplicated from app/api/ai/ask/route.ts because no shared client existed.
// lib/services/groq.ts now holds the identical values and the identical failure
// classification, so the URL called, the model used, the 30s deadline and the
// mapping of every failure onto 502 or 504 are unchanged. The client still cannot
// reach any of them: nothing below is read from a request.

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
//              call — the same three roles the ask route admits. No two-tier
//              logic: all three get the same endpoint with the same behaviour.
//              PARENT and any unpermitted caller receive the guard's 403.
// VALIDATION : summariseSchema — content required and non-empty, and deliberately
//              NOT trimmed, so the text is preserved exactly as sent. Every other
//              key is stripped by the plain z.object(), so a body naming a model,
//              provider, temperature, top_p, max_tokens, stream, length or format
//              has it dropped and it never reaches the call below. The client
//              cannot influence any generation parameter, because none is read
//              from the request at any point.
// FLOW       : Authorise → resolve tenant → parse body → one HTTP call to Groq →
//              return the summary.
//
//              TENANT. requireTenant runs and its failure is returned as-is, so
//              an unresolvable host is refused before any provider call is made
//              and no request is billed for a caller whose tenant does not
//              resolve. The resolved tenant is not otherwise used: it is not sent
//              to the provider, not mixed into the prompt and not recorded.
//
//              INPUT. The validated content is sent exactly as validated, as a
//              single user message. It is raw text and is treated as raw text: no
//              file is opened, no URL is fetched, no markdown is parsed and no
//              HTML is rendered. The content is not modified — not trimmed, not
//              truncated, not chunked and not reformatted — and nothing is
//              prepended or appended to it. No system prompt is injected, so the
//              messages array is one element long on every request; no
//              conversation history is loaded and no memory is consulted.
//
//              Note this means the instruction to summarise is not added by the
//              route. Nothing in the approved rules authorises composing a prompt
//              around the caller's text, and doing so would be modifying the
//              input — so the content is forwarded as the whole message and the
//              caller's own text decides what the model does with it.
//
//              PROVIDER. One fetch, to a fixed URL, with a fixed model. The call
//              is not retried, not queued and not streamed: a failure is
//              reported, never re-attempted. The request carries no temperature,
//              top_p, max_tokens or stream field at all, so the provider's
//              defaults apply and there is nothing for a client to override. The
//              API key is read from the environment at call time and appears only
//              in the outbound Authorization header.
//
//              NOT DONE HERE. Nothing is persisted: no request, no summary, no
//              usage figure and no timing. No Prisma model is imported, so no
//              Notification, Student or Course row can be read. Nothing is
//              cached, so identical content is a fresh call every time. Nothing
//              is logged — like the ask route, this file contains no console
//              call, so content or a summary cannot reach a log file.
// RESPONSE   : { success: true, data: { summary } }
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

    const parsed = summariseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    // One call, through the shared service. Not retried, not queued, not
    // streamed. The prompt is the validated content exactly as validated, sent as
    // a single user message — the service injects no system message, loads no
    // history and sends no generation parameter, so this route still prepends no
    // instruction of its own. JSON mode is not requested, so the outbound body is
    // what this route sent before the extraction: model plus one user message.
    //
    // The service classifies every failure into the same two cases this route
    // handled inline — "timeout" for an elapsed deadline, "provider" for a missing
    // key, a network failure, a non-2xx status, an unparseable body or a 200
    // carrying an unexpected shape — so the status codes below are unchanged.
    const result = await groqCompletion(parsed.data.content);

    if (!result.ok) {
      return result.reason === "timeout" ? providerTimeout() : providerError();
    }

    // The summary is returned exactly as the provider produced it — not trimmed,
    // not rendered, not reformatted.
    return NextResponse.json(ok({ summary: result.content }));
  } catch {
    // Deliberately no console call and no error detail: this route must not log,
    // and a stack trace must never reach a caller.
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// ============================================================================
// OWNER  : Gauransh
// MODULE : AI (Groq) — Provider Service
// FLOW   : Takes one prompt, performs one Groq completion, returns the model's
//          text or a typed failure. Callers map that failure to a status code.
// ACCESS : None. This module performs no authorisation and inspects no caller —
//          requireRole and requireTenant run in the routes, before this is
//          reached.
// BACKEND: Groq HTTP API only. No database access, no Prisma model and no
//          persistence. Nothing is cached, queued, retried or logged here.
// PURPOSE: Hold the provider details in one place so the three AI routes stop
//          duplicating them. Extracted verbatim from the inline implementation in
//          app/api/ai/ask/route.ts — same URL, same model, same deadline, same
//          failure classification — so behaviour is unchanged.
// ============================================================================

/** Provider endpoint. Fixed here, never taken from a request. */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Model. Fixed here, never taken from a request.
 *
 * The project declares GROQ_API_KEY and nothing else for this phase — no model
 * env var and no per-tenant configuration — so the model is a constant of this
 * service, which is what "fixed server-side" requires. This is the same model the
 * two existing AI routes hold inline.
 */
const GROQ_MODEL = "llama-3.3-70b-versatile";

/**
 * Request deadline. A timeout must exist for a 504 to be reachable, and no
 * duration is specified anywhere, so one is chosen here as an operational
 * constant. Matches the value the existing routes hold.
 */
const TIMEOUT_MS = 30_000;

/**
 * Outcome of one completion.
 *
 * A discriminated result rather than a thrown error, so a caller maps it to a
 * status code without a try/catch and without ever seeing the provider's own
 * response. The two failure reasons are exactly the two the routes distinguish:
 *
 *   "timeout"  — the deadline elapsed. Callers report 504.
 *   "provider" — anything else: no API key, a network failure, a non-2xx status,
 *                an unparseable body, or a 200 carrying an unexpected shape.
 *                Callers report 502.
 *
 * Nothing about the cause is carried in the result. The provider's status line,
 * its response body and the API key never leave this module, so a caller cannot
 * forward them even by accident.
 */
export type GroqResult =
  | { ok: true; content: string }
  | { ok: false; reason: "provider" | "timeout" };

/**
 * Options for one completion. Everything here is decided server-side by the
 * calling route; none of it is reachable from a request body.
 */
export type GroqOptions = {
  /**
   * Ask the provider to constrain its output to a single JSON object.
   *
   * Omitted by default, so the request body is byte-identical to what the two
   * existing routes send — model plus one user message and nothing else. Only a
   * route whose declared contract is structured output turns this on.
   */
  jsonObject?: boolean;
};

/**
 * Perform one Groq completion.
 *
 * ONE call. Not retried, not queued, not streamed, not cached: a failure is
 * returned, never re-attempted. The prompt is sent as a single user message
 * exactly as given — no system message is injected here and no history is
 * loaded, so the messages array is one element long on every request. Composing
 * that prompt is the caller's job; this module never alters it.
 *
 * No temperature, top_p or max_tokens is sent, so the provider's own defaults
 * apply and there is nothing for a client to override.
 *
 * The API key is read from the environment at call time and appears only in the
 * outbound Authorization header. A missing key is reported as a "provider"
 * failure rather than a distinct one: from a caller's position the provider is
 * unusable either way, and distinguishing it would disclose server
 * configuration.
 *
 * Nothing is logged. This module contains no console call, so a prompt, a
 * completion or a provider error body cannot reach a log file.
 */
export async function groqCompletion(
  prompt: string,
  options: GroqOptions = {}
): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "provider" };
  }

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        ...(options.jsonObject ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The deadline elapsed. Reported separately so the caller can answer 504.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    // Network failure, DNS failure, connection reset — the provider was not
    // reached. Nothing about the cause is carried out of this module.
    return { ok: false, reason: "provider" };
  }

  if (!response.ok) {
    return { ok: false, reason: "provider" };
  }

  // The body is parsed defensively: a 200 carrying an unexpected shape is a
  // provider failure, not a server error, and nothing from it is forwarded.
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "provider" };
  }

  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.length === 0) {
    return { ok: false, reason: "provider" };
  }

  // Returned exactly as the provider produced it — not trimmed, not rendered,
  // not reformatted.
  return { ok: true, content };
}

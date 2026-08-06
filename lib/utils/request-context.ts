// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Request Context
// LAYER  : Utility (route-layer plumbing)
// PURPOSE: Lift the three request facts an audit record needs — who acted, from
//          where, with what client — out of NextRequest and into a plain object
//          the service layer can consume.
//
//          This exists so the service never imports NextRequest. A service that
//          reads headers is a service coupled to HTTP, which cannot then be
//          driven by a background computation run or a unit test. The route
//          parses the request; that is its documented job.
// ============================================================================

import type { NextRequest } from "next/server";
import type { JwtPayload } from "@/lib/auth/jwt";

/** Proxy header carrying the originating client address, first entry wins. */
const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** Fallback header set by some proxies when x-forwarded-for is absent. */
const REAL_IP_HEADER = "x-real-ip";

/** Standard client identification header. */
const USER_AGENT_HEADER = "user-agent";

/** Separator between hops in an x-forwarded-for chain. */
const FORWARDED_FOR_SEPARATOR = ",";

/**
 * The actor and origin of a single mutating request.
 *
 * actorId is never optional: every write path in this module runs behind
 * requireRole, so an authenticated subject is always present by the time a
 * context is built. Address and client are nullable because a direct,
 * proxy-less request legitimately carries neither.
 */
export interface RequestContext {
  actorId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Read the first hop from an x-forwarded-for chain.
 *
 * The header may carry several comma-separated addresses; the leftmost is the
 * original client and every later entry is a proxy. An empty or whitespace-only
 * value yields null rather than an empty string, so the column stores NULL and
 * "absent" is not confused with "recorded as blank".
 */
function readClientAddress(request: NextRequest): string | null {
  const forwarded = request.headers.get(FORWARDED_FOR_HEADER);

  if (forwarded) {
    const [first] = forwarded.split(FORWARDED_FOR_SEPARATOR);
    const trimmed = first.trim();

    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const realIp = request.headers.get(REAL_IP_HEADER)?.trim();

  return realIp && realIp.length > 0 ? realIp : null;
}

/**
 * Build the audit context for a mutating request.
 *
 * INPUT   : the incoming request and the session already proven by requireRole.
 * RULES   : the actor is taken from the verified session subject, never from a
 *           header or body, so it cannot be spoofed by the caller.
 * RETURNS : a plain, serialisable object with no framework types attached.
 */
export function buildRequestContext(request: NextRequest, session: JwtPayload): RequestContext {
  const userAgent = request.headers.get(USER_AGENT_HEADER)?.trim();

  return {
    actorId: session.sub,
    ipAddress: readClientAddress(request),
    userAgent: userAgent && userAgent.length > 0 ? userAgent : null,
  };
}

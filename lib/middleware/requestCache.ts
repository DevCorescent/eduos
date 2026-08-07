// ============================================================================
// MODULE : Authentication — Request-Scoped Read Cache
// PURPOSE: Let the guard chain read the same row once per request instead of
//          once per guard, without weakening a single check.
//
// THE PROBLEM THIS SOLVES
//   A typical route runs requireRole(...) and then requireTenant(). Both call
//   requireAuth() internally, and requireTenant additionally re-reads the very
//   Tenant row that getTenantFromRequest just read. GET /api/assignments is
//   worse still: it asks requireRole twice, for two different role sets.
//
//   The result was seven database round trips of pure authorization before a
//   single domain row was touched. Against a Neon instance ~250 ms away that is
//   1.75 s per API call, and a dashboard composing nine calls paid it nine
//   times.
//
// WHY A WeakMap KEYED ON headers()
//   React's cache() is the idiomatic tool for this, and it is what
//   services/reference.ts uses — but it DOES NOT memoize inside a Route
//   Handler on Next 16. Verified directly: three calls to one cached function
//   in a single handler invoked the loader three times.
//
//   headers() does hold the property we need. It returns one stable object per
//   request and a distinct object for the next request, so it is a correct
//   request identity. Keying a WeakMap on it makes an entry unreachable — and
//   collectable — the moment the request ends. Nothing survives into the next
//   request, which is the property that matters when the cached value is
//   somebody's session.
//
// WHAT THIS DOES NOT CHANGE
//   Every guard still runs, in the same order, checking the same things. The
//   JWT is still verified on every call. Roles are still resolved live from
//   UserRole rather than trusted from the token, so a revoked role still takes
//   effect on the next request — exactly the guarantee requireRole documents.
//   This only stops the same question being asked of the database five times
//   while answering one request.
// ============================================================================

// NOT `import "server-only"`. The guards that use this module are covered by
// unit tests run under `node --test`, which has no React Server Component
// condition and therefore throws on that import — it broke three middleware
// suites. The module is server-only in fact regardless: it depends on
// next/headers, which is unavailable in a client bundle and would fail the
// build if one ever imported it.
import { headers } from "next/headers";

/**
 * Per-request memo buckets.
 *
 * Weak on purpose: the key is the request's own headers object, so an entry
 * becomes garbage the moment that request is done. A Map here would be a
 * per-process leak holding session rows indefinitely.
 */
const buckets = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * Run `load` once per request for a given key, and share the result.
 *
 * The PROMISE is cached rather than the resolved value, so two guards that ask
 * concurrently share one in-flight query instead of racing two identical ones.
 *
 * A rejected promise is evicted, so a transient database error does not become
 * a sticky failure for the rest of the request.
 *
 * @example
 * const roles = await requestScoped(`roles:${userId}`, () =>
 *   prisma.userRole.findMany({ where: { userId } })
 * )
 */
export async function requestScoped<T>(key: string, load: () => Promise<T>): Promise<T> {
  // Establishes request identity. Outside a request scope this throws, which is
  // correct: a guard has no business running there.
  const scope = await headers();

  let bucket = buckets.get(scope);
  if (!bucket) {
    bucket = new Map();
    buckets.set(scope, bucket);
  }

  const cached = bucket.get(key);
  if (cached) return cached as Promise<T>;

  const pending = load().catch((error) => {
    bucket.delete(key);
    throw error;
  });

  bucket.set(key, pending);
  return pending;
}

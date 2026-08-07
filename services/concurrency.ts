// ============================================================================
// MODULE : Services — Bounded Fan-Out
// PURPOSE: Run a per-row task across a list without issuing every request at
//          once.
//
// WHY THIS IS NEEDED
//   Several list screens enrich each row with a value only that row's own
//   endpoint can supply — an assignment's submissions, an examination's
//   results. There is no batch endpoint for either, so the fan-out is genuinely
//   one request per row.
//
//   Issuing them with a bare Promise.all over a page of 100 opens 100
//   simultaneous requests, each taking a database connection and most of them
//   opening a transaction. That is what exhausted the pool and produced
//   P2028 ("Unable to start a transaction in the given time") — a 500, or a
//   request that hung for tens of seconds, on a page that looked healthy at
//   ten rows and collapsed at a hundred.
//
//   Bounding the fan-out keeps the parallelism that makes enrichment fast while
//   keeping the peak connection demand flat and predictable. It changes no
//   value: every row is still processed, in order, with the same result.
// ============================================================================

/**
 * How many per-row requests may be in flight at once.
 *
 * Comfortably under the pool ceiling in lib/db/prisma.ts, leaving room for the
 * page's other requests and for concurrent users. Raising it trades pool
 * headroom for a shorter tail on very long lists.
 */
const DEFAULT_CONCURRENCY = 5;

/**
 * Map over `items`, running at most `limit` tasks concurrently.
 *
 * Results come back in INPUT ORDER regardless of completion order, so a caller
 * can zip them against the original list — the property a bare Promise.all also
 * has and which anything replacing it must keep.
 *
 * @example
 * const rows = await mapWithConcurrency(assignments, (a) => enrich(a))
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  // Each worker pulls the next index until the list is exhausted. Workers
  // rather than fixed chunks, so one slow row does not hold up a whole batch
  // while other workers sit idle.
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

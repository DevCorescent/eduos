import { PrismaClient } from "../../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Connection ceiling for the Neon pool.
 *
 * Sized against how this application actually loads the database. A single
 * server-rendered page issues its data as several HTTP requests to this app's
 * own API — the faculty dashboard makes twelve — and each of those handlers
 * takes its own connection, most of them inside a `$transaction([findMany,
 * count])` that holds it for the whole pair.
 *
 * The driver's default of 10 is below that peak, so the tail of a dashboard's
 * requests found no connection available. Twenty leaves headroom for one page
 * plus concurrent traffic without approaching what the pooled endpoint allows.
 */
const MAX_CONNECTIONS = 20;

/**
 * How long a query waits for a free connection before giving up, in ms.
 *
 * Long enough to ride out a burst rather than fail inside one. A dashboard's
 * requests arrive together and finish together; a caller that waits a moment
 * gets served, whereas one that fails fast turns a slow page into a 500.
 */
const CONNECTION_TIMEOUT_MS = 15_000;

/** How long an unused connection is kept before being released, in ms. */
const IDLE_TIMEOUT_MS = 30_000;

// PrismaNeon's first parameter is a neon.PoolConfig, so the pool is tuned here
// rather than through connection-string parameters: with a driver adapter,
// Prisma delegates pooling to the driver and `?connection_limit=` in the URL is
// not read.
const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
  max: MAX_CONNECTIONS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    /**
     * Interactive-transaction budgets.
     *
     * `maxWait` is how long a transaction may wait to START — to be handed a
     * connection. Prisma's default is 2000 ms, and exceeding it raises P2028
     * ("Unable to start a transaction in the given time"). That is exactly the
     * error the dashboards were producing: twelve concurrent requests, each
     * opening a transaction, against a pool that could not seat them inside two
     * seconds. The symptom was a 500 or a request that hung for tens of
     * seconds, not a slow query.
     *
     * `timeout` is how long a transaction may RUN once started. Raised in
     * proportion: every statement here costs a round trip to a database in
     * another region, so a two-statement transaction that would finish
     * instantly on a local database legitimately takes hundreds of milliseconds
     * here.
     *
     * Both are ceilings, not delays. A healthy request never approaches either;
     * they only change what happens when the pool is briefly saturated —
     * waiting instead of failing.
     */
    transactionOptions: {
      maxWait: 15_000,
      timeout: 20_000,
    },
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — JSON Serialization
// FLOW   : Walks a response payload and converts BigInt values to lossless
//          strings, leaving every other value structurally untouched.
// ACCESS : Shared helper — no access control of its own.
// BACKEND: No database access. Operates on values already read by Prisma.
// PURPOSE: BigInt has no toJSON, so JSON.stringify throws on it outright and
//          any route returning a BigInt column would fail with a 500. This is
//          the single project-wide strategy for that, so routes never perform
//          ad-hoc conversions of their own.
// ============================================================================

/**
 * The wire shape of a serialized value.
 *
 * bigint becomes string. Anything that defines its own toJSON — Date and
 * Prisma's Decimal both do — is preserved as-is, because JSON.stringify will
 * already call that method correctly. Everything else is mapped structurally.
 */
export type Serialized<T> = T extends bigint
  ? string
  : T extends { toJSON(): unknown }
    ? T
    : T extends Array<infer U>
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

/**
 * Recursive transform behind serialize().
 *
 * The toJSON check is load-bearing, not defensive: Date and Prisma's Decimal
 * are both typeof "object", so a plain deep walk would recurse into their
 * internal fields and destroy them. Prisma's Decimal already serializes to a
 * string such as "1499.5" on its own, and must be handed through intact.
 */
function transform(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(transform);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, transform(entry)])
  );
}

/**
 * Prepare a value for JSON serialization.
 *
 * INPUT   : any value destined for a response body.
 * RULES   : BigInt is converted to its decimal string form, which is lossless
 *           at any magnitude — unlike Number, which loses precision beyond
 *           2^53. Values that serialize themselves are left alone.
 * RETURNS : the same structure with BigInt replaced by string, typed to match.
 *
 * @example
 * return NextResponse.json(ok(serialize(subscriptions)));
 */
export function serialize<T>(value: T): Serialized<T> {
  return transform(value) as Serialized<T>;
}

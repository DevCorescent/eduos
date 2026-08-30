// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Publish state
// LAYER  : Domain (pure)
// PURPOSE: Say what state a university's website is actually in, in the terms
//          the person editing it thinks in.
//
// THE STATE THAT WAS MISSING
//   The row already carried everything needed to answer this — a draft, a
//   published copy, and a published timestamp — but the screen only ever showed
//   "Live" or "Draft". Those two labels cannot express the state an editor is
//   in most of the time: PUBLISHED, and edited since. An admin in that state
//   was shown "Live" beside a page that did not match what visitors saw, which
//   is the one thing a publishing workflow must never get wrong.
//
// COMPARING THE TWO COPIES
//   "Edited since publishing" is decided by comparing the draft with the
//   published copy, not by comparing timestamps. updatedAt moves when SEO
//   fields or the title change, and it moves when a save rewrites identical
//   blocks — neither is a change a visitor would see. Comparing the content
//   answers the question actually being asked.
// ============================================================================

/** What the editor is told, and what the badge says. */
export type PublishState =
  /** No published copy has ever existed. The public URL shows nothing. */
  | "NEVER_PUBLISHED"
  /** The published copy is exactly the draft. Nothing is waiting to go out. */
  | "PUBLISHED"
  /** Published, and edited since. Visitors still see the older published copy. */
  | "UNPUBLISHED_CHANGES"
  /** Was published, deliberately withdrawn. */
  | "ARCHIVED";

/**
 * A stable serialisation, so two structurally equal values compare equal.
 *
 * JSON.stringify preserves insertion order, and the draft is rebuilt from a
 * request body while the published copy was cloned from an earlier draft — so
 * the same content can arrive with its keys in a different order. Sorting the
 * keys is what stops that from being reported to the administrator as an
 * unpublished change they cannot find.
 */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";

  if (Array.isArray(value)) {
    // Order IS meaning for a block array — it is the order of the sections on
    // the page — so arrays are compared in order and never sorted.
    return `[${value.map(stable).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

/** True when the draft differs from what is published. */
export function hasUnpublishedChanges(draft: unknown, published: unknown): boolean {
  return stable(draft) !== stable(published);
}

/**
 * The state of one page.
 *
 * INPUT   : the stored row, or null for an institution that has never opened
 *           the editor.
 * RETURNS : one of four states. A page with no row at all is NEVER_PUBLISHED,
 *           which is the truth and renders the same empty-state guidance.
 */
export function publishState(
  page: {
    status: string;
    draftBlocks: unknown;
    publishedBlocks: unknown;
    publishedAt: Date | string | null;
  } | null
): PublishState {
  if (!page) return "NEVER_PUBLISHED";

  if (page.status === "ARCHIVED") return "ARCHIVED";

  // publishedAt rather than status: a row can only be PUBLISHED after a publish
  // wrote both, and this is the field the public read keys off.
  const everPublished = page.publishedAt !== null && page.publishedBlocks !== null;
  if (!everPublished) return "NEVER_PUBLISHED";

  return hasUnpublishedChanges(page.draftBlocks, page.publishedBlocks)
    ? "UNPUBLISHED_CHANGES"
    : "PUBLISHED";
}

/** The words shown on the badge, and the tone it is drawn in. */
export const PUBLISH_STATE_LABEL: Record<PublishState, string> = {
  NEVER_PUBLISHED: "Draft",
  PUBLISHED: "Published",
  UNPUBLISHED_CHANGES: "Unpublished changes",
  ARCHIVED: "Taken down",
};

/** True when the public URL currently serves this institution's page. */
export function isPubliclyVisible(state: PublishState): boolean {
  return state === "PUBLISHED" || state === "UNPUBLISHED_CHANGES";
}

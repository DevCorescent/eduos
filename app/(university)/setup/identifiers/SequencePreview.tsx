"use client";

import { useEffect, useState } from "react";
import { previewIdSequence } from "@/services/identifiers";
import type { IdentifierEntity } from "@/lib/services/identifier.service";

/**
 * What the next identifier would look like — PRD §9.3, "Rule preview and testing".
 *
 * A CLIENT COMPONENT FOR ONE REASON
 *   The preview must be re-readable after an edit without a full page reload,
 *   and it renders per row. The fetch it makes is read-only: the preview
 *   endpoint takes no row lock and increments nothing, so refreshing this a
 *   hundred times costs a hundred reads and burns no numbers.
 *
 * IT IS A PREVIEW, NOT A RESERVATION
 *   If somebody enrols a student between this render and the next issue, the
 *   number moves on. The tooltip says so rather than letting the value imply it
 *   is held.
 */
export function SequencePreview({
  entityType,
  scopeKey,
}: {
  entityType: IdentifierEntity;
  scopeKey: string;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; preview: string; willReset: boolean }
    | { kind: "unavailable" }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;

    previewIdSequence(entityType, scopeKey || undefined).then((result) => {
      // The row may have unmounted while the request was in flight; setting
      // state then would warn and, worse, show one row's preview under another.
      if (!active) return;

      setState(
        result.success
          ? {
              kind: "ready",
              preview: result.data.preview,
              willReset: result.data.willReset,
            }
          : { kind: "unavailable" }
      );
    });

    return () => {
      active = false;
    };
  }, [entityType, scopeKey]);

  if (state.kind === "loading") {
    return (
      <span
        className="inline-block h-4 w-28 animate-pulse rounded bg-muted"
        aria-label="Loading preview"
      />
    );
  }

  if (state.kind === "unavailable") {
    // Not an error banner: a preview that cannot be read leaves the rest of the
    // row perfectly usable, and the format column already shows the template.
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
        title="What the next identifier would be. Not reserved — if another record is created first, this moves on."
      >
        {state.preview}
      </code>
      {state.willReset && (
        <span className="text-[11px] text-muted-foreground">
          (counter restarts this cycle)
        </span>
      )}
    </span>
  );
}

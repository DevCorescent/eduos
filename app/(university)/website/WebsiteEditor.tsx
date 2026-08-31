"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : University Portal — Website Editor (W4, PRD §7.3)
// LAYER  : Presentation (client)
// PURPOSE: Wire the shared BlockEditor to THIS university's own endpoints.
//
// A THIN ADAPTER, AND THAT IS ITS ENTIRE JOB
//   The editor knows how to manipulate blocks; this knows which university's
//   page they belong to — which here is "the caller's own", because the API
//   resolves the tenant from the host and takes no id. So there is nothing to
//   pass and nothing to get wrong.
//
// WHY IT REFRESHES THE ROUTE
//   The status badge and the "last saved / last published" line are rendered by
//   the Server Component above, from the row. Without a refresh they would
//   still describe the state the page loaded in — an admin would publish, see
//   "Published" in the toast and "Unpublished changes" in the badge, and have no
//   way to tell which was true. router.refresh() re-runs the server read and
//   leaves this component's own state alone, so the edits on screen survive it.
// ============================================================================

import { useRouter } from "next/navigation";
import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import { BlockEditor } from "@/components/cms/BlockEditor";
import { publishMyPage, saveMyPage } from "@/services/cms";

export interface WebsiteEditorProps {
  initialBlocks: CmsBlocks;
  /**
   * The institution's own public address, or null when it has no published
   * website yet — the editor disables "View site" and says why rather than
   * opening a page that redirects visitors to the staff sign-in form.
   */
  previewUrl: string | null;
  /** Shown on the disabled button when previewUrl is null. */
  previewUnavailable: string;
  /**
   * What the button says. It names WHICH site a click opens — the institution's
   * published page, or the default one visitors see until it publishes.
   */
  previewLabel?: string;
  /**
   * True when the blocks on screen are the default template rather than a
   * saved draft — see the page's own note. The editor then reports unsaved
   * changes and Publish saves before it publishes.
   */
  initiallyUnsaved?: boolean;
}

export function WebsiteEditor({
  initialBlocks,
  previewUrl,
  previewUnavailable,
  previewLabel,
  initiallyUnsaved,
}: WebsiteEditorProps) {
  const router = useRouter();

  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      previewUrl={previewUrl}
      previewUnavailable={previewUnavailable}
      previewLabel={previewLabel}
      initiallyUnsaved={initiallyUnsaved}
      // Both handlers return an error MESSAGE or null. The editor owns the
      // toast; this owns the transport. Returning the envelope's own error text
      // means the reader sees what the API actually said, not a generic
      // "something went wrong" invented here.
      onSave={async (blocks) => {
        const result = await saveMyPage({ blocks });
        if (!result.success) return result.error;

        router.refresh();
        return null;
      }}
      onPublish={async () => {
        const result = await publishMyPage();
        if (!result.success) return result.error;

        router.refresh();
        return null;
      }}
    />
  );
}

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
// ============================================================================

import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import { BlockEditor } from "@/components/cms/BlockEditor";
import { publishMyPage, saveMyPage } from "@/services/cms";

export interface WebsiteEditorProps {
  initialBlocks: CmsBlocks;
  /** Where "View site" points — the institution's own hostname. */
  previewUrl: string;
}

export function WebsiteEditor({ initialBlocks, previewUrl }: WebsiteEditorProps) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      previewUrl={previewUrl}
      // Both handlers return an error MESSAGE or null. The editor owns the
      // toast; this owns the transport. Returning the envelope's own error text
      // means the reader sees what the API actually said, not a generic
      // "something went wrong" invented here.
      onSave={async (blocks) => {
        const result = await saveMyPage({ blocks });
        return result.success ? null : result.error;
      }}
      onPublish={async () => {
        const result = await publishMyPage();
        return result.success ? null : result.error;
      }}
    />
  );
}

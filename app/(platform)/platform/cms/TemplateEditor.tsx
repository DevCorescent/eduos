"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Console — Template Editor (W4, PRD §5.1, §7)
// LAYER  : Presentation (client)
// PURPOSE: Wire the shared BlockEditor to the platform-owned default template.
//
// NO PUBLISH BUTTON, AND THAT IS CORRECT
//   A template is never served to anyone. It is copied into a university's page
//   during onboarding, and that copy is what gets published — by the
//   institution, on their own domain. Giving this screen a Publish button would
//   imply the template goes live somewhere, which it does not.
// ============================================================================

import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import { BlockEditor } from "@/components/cms/BlockEditor";
import { saveTemplate } from "@/services/cms";

export function TemplateEditor({ initialBlocks }: { initialBlocks: CmsBlocks }) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      contextLabel="Default landing template"
      onSave={async (blocks) => {
        const result = await saveTemplate({ blocks });
        return result.success ? null : result.error;
      }}
    />
  );
}

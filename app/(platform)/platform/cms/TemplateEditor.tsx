"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Console — Template Editor (W4, PRD §5.1, §7)
// LAYER  : Presentation (client)
// PURPOSE: Wire the shared editors to the platform-owned default template.
//
// NO PUBLISH BUTTON, AND THAT IS CORRECT
//   A template is never served to anyone. It is copied into a university's page
//   during onboarding, and that copy is what gets published — by the
//   institution, on their own domain. Giving this screen a Publish button would
//   imply the template goes live somewhere, which it does not.
//
// PREVIEW INSTEAD, AND THAT IS WHY IT MATTERS MORE HERE THAN ANYWHERE
//   A tenant's editor can point at their live site; the template has no site to
//   point at, so without /cms-preview an operator edits the starting page every
//   future university receives and never sees it rendered. The preview opens in
//   a new tab so unsaved work in this one survives.
//
// TWO SAVES, TWO SCOPES
//   Sections and chrome are separate endpoints' worth of data on one row, and
//   each editor sends only what it owns. See the route's validation note on why
//   `blocks` is optional there.
// ============================================================================

import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import { TEMPLATE_CHROME_FIELDS } from "@/lib/domain/cms/fields";
import { saveCmsTemplateSchema, type SaveCmsTemplateInput } from "@/lib/validations/cms";
import { BlockEditor } from "@/components/cms/BlockEditor";
import { ChromeEditor } from "@/components/cms/ChromeEditor";
import { saveTemplate } from "@/services/cms";

export interface TemplateEditorProps {
  initialBlocks: CmsBlocks;
  /** Nav, footer, socials and site-wide type, already parsed by the page. */
  initialChrome: Record<string, unknown>;
}

export function TemplateEditor({ initialBlocks, initialChrome }: TemplateEditorProps) {
  return (
    <div className="space-y-8">
      <BlockEditor
        initialBlocks={initialBlocks}
        contextLabel="Default landing template"
        previewUrl="/cms-preview"
        previewLabel="Preview template"
        onSave={async (blocks) => {
          const result = await saveTemplate({ blocks });
          return result.success ? null : result.error;
        }}
      />

      <ChromeEditor<SaveCmsTemplateInput>
        fields={TEMPLATE_CHROME_FIELDS}
        initialValue={initialChrome}
        // The template's own schema, so the client check and the route's agree.
        // It admits a payload with no `blocks`, which is precisely what this
        // form sends — the sections above are not its business.
        schema={saveCmsTemplateSchema}
        title="Default navigation, footer and text style"
        description="What a new university's header, enquire dock and footer start as. Editing this changes nothing that already exists."
        onSave={async (value) => {
          const result = await saveTemplate(value);
          return result.success ? null : result.error;
        }}
      />
    </div>
  );
}

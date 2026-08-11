"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : University Portal — Header, Footer and Typography (W4c, PRD §7.1)
// LAYER  : Presentation (client)
// PURPOSE: Wire the shared ChromeEditor to THIS university's own endpoint.
//
// A THIN ADAPTER, AND THAT IS ITS ENTIRE JOB
//   The editor knows how to render a field spec; this knows whose site the
//   result belongs to — which here is "the caller's own", because the API
//   resolves the tenant from the host and takes no id. So there is nothing to
//   pass and nothing to get wrong.
// ============================================================================

import { SITE_CHROME_FIELDS } from "@/lib/domain/cms/fields";
import { saveCmsSiteSchema, type SaveCmsSiteInput } from "@/lib/validations/cms";
import { ChromeEditor } from "@/components/cms/ChromeEditor";
import { Alert } from "@/components/ui/Alert";
import { saveMySite } from "@/services/cms";

export function SiteChromeForm({ initialValue }: { initialValue: Record<string, unknown> }) {
  return (
    <ChromeEditor<SaveCmsSiteInput>
      fields={SITE_CHROME_FIELDS}
      initialValue={initialValue}
      schema={saveCmsSiteSchema}
      title="Header, footer and text style"
      description="Your menu, its hover dropdowns, the optional enquire dock, footer columns and the type used across the site."
      notice={
        <Alert variant="info" title="These changes go live as soon as you save" className="mb-4">
          Unlike your page sections, the menu and footer are not staged as a
          draft — a published page must never link through a menu nobody has
          approved.
        </Alert>
      }
      onSave={async (value) => {
        const result = await saveMySite(value);
        return result.success ? null : result.error;
      }}
    />
  );
}

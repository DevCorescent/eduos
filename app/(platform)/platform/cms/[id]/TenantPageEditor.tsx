"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Console — One University's Page Editor (W4, PRD §5.1, §7)
// LAYER  : Presentation (client)
// PURPOSE: Wire the shared BlockEditor to a NAMED university's endpoints.
//
// THE ONLY DIFFERENCE FROM THE UNIVERSITY'S OWN EDITOR IS THE tenantId
//   Same component, same block schema, same publish semantics. What separates
//   them is which door the write goes through: this one carries an explicit id
//   and is guarded by requirePlatformAdmin; the university's carries none and
//   is guarded by requireRole + requireTenant.
// ============================================================================

import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import { BlockEditor } from "@/components/cms/BlockEditor";
import { publishTenantPage, saveTenantPage } from "@/services/cms";

export interface TenantPageEditorProps {
  tenantId: string;
  tenantName: string;
  initialBlocks: CmsBlocks;
  previewUrl: string;
}

export function TenantPageEditor({
  tenantId,
  tenantName,
  initialBlocks,
  previewUrl,
}: TenantPageEditorProps) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      previewUrl={previewUrl}
      // Named on screen at all times. An operator with several universities
      // open should never have to check the URL to know whose homepage they are
      // about to publish.
      contextLabel={`Editing ${tenantName}`}
      onSave={async (blocks) => {
        const result = await saveTenantPage(tenantId, { blocks });
        return result.success ? null : result.error;
      }}
      onPublish={async () => {
        const result = await publishTenantPage(tenantId);
        return result.success ? null : result.error;
      }}
    />
  );
}

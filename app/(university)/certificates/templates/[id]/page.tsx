import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StateView } from "@/components/shared/StateView";
import { resolveFailureState } from "@/lib/ui-state";
import { buttonStyles } from "@/components/ui/Button";
import { getCertificateTemplate } from "@/services/finance";
import { TemplateEditor } from "../TemplateEditor";
import { VersionHistory } from "./VersionHistory";

export const metadata: Metadata = { title: "Edit certificate template" };

/**
 * Edit an existing template.
 *
 * The record is read through the EXISTING GET /api/certificate-templates/[id],
 * which is tenant-scoped and role-guarded, so this page adds no authorization
 * of its own and cannot reach another university's template.
 */
export default async function EditCertificateTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getCertificateTemplate(id);

  const header = (
    <PageHeader
      title={result.success ? result.data.name : "Certificate template"}
      subtitle="Edit the design your university issues from."
      breadcrumb={
        <Link
          href="/certificates/templates"
          className={buttonStyles({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Certificate templates
        </Link>
      }
    />
  );

  if (!result.success) {
    return (
      <>
        {header}
        <StateView
          state={resolveFailureState(result)}
          subject="this template"
          message={result.error}
        />
      </>
    );
  }

  const template = result.data;

  return (
    <>
      {header}
      <TemplateEditor
        templateId={template.id}
        initial={{
          name: template.name,
          type: template.type,
          htmlTemplate: template.htmlTemplate ?? "",
          cssStyles: template.cssStyles ?? "",
          isActive: template.isActive,
        }}
      />

      {/* Below the editor: the history explains why a save on an issued
          template produces a new version rather than changing this one. */}
      <div className="mt-4">
        <VersionHistory templateId={template.id} />
      </div>
    </>
  );
}

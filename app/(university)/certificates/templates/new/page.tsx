import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonStyles } from "@/components/ui/Button";
import { TemplateEditor } from "../TemplateEditor";
import { STARTER_TEMPLATE } from "@/lib/domain/certificate/starter";

export const metadata: Metadata = { title: "New certificate template" };

/**
 * Author a new certificate template.
 *
 * Opens on a formal starter rather than an empty box: a blank textarea is not
 * a starting point for anybody who has not written certificate markup before,
 * and the starter demonstrates the placeholder syntax the picker inserts.
 * Nothing is created until Save — this route writes nothing on its own.
 */
export default function NewCertificateTemplatePage() {
  return (
    <>
      <PageHeader
        title="New certificate template"
        subtitle="Design a certificate your university can issue."
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

      <TemplateEditor
        initial={{
          name: "",
          type: "COMPLETION",
          htmlTemplate: STARTER_TEMPLATE.html,
          cssStyles: STARTER_TEMPLATE.css,
          isActive: false,
        }}
      />
    </>
  );
}

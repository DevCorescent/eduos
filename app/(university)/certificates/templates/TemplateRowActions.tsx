"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonStyles } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import {
  createCertificateTemplate,
  getCertificateTemplate,
  updateCertificateTemplate,
} from "@/services/certificateTemplates";
import type { CertificateTemplate } from "@/types";

/**
 * Per-template actions: edit, duplicate, archive.
 *
 * ARCHIVE, NOT DELETE
 *   A template may be referenced by certificates that have already been issued
 *   and handed to people. Deleting the row would orphan those records, so the
 *   action sets isActive false through the SAME PATCH the editor uses — the
 *   template stops being offered when issuing and nothing already issued is
 *   touched. The confirmation says exactly that, because "archive" on its own
 *   does not tell an administrator what happens to documents already out in
 *   the world.
 *
 * DUPLICATE READS THE FULL RECORD FIRST
 *   The list projection does not carry htmlTemplate — the collection route
 *   omits it because a page of large templates would be enormous. So a copy
 *   fetches the original by id and posts its body; copying from the row would
 *   silently produce an empty template.
 */
export function TemplateRowActions({ template }: { template: CertificateTemplate }) {
  const router = useRouter();
  const { toast } = useToast();
  const archive = useDisclosure();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  function duplicate() {
    setBusy(true);
    startTransition(async () => {
      const full = await getCertificateTemplate(template.id);

      if (!full.success) {
        toast({ variant: "error", title: "Could not copy", description: full.error });
        setBusy(false);
        return;
      }

      const created = await createCertificateTemplate({
        name: `${full.data.name} — Copy`,
        type: full.data.type,
        htmlTemplate: full.data.htmlTemplate ?? "",
        ...(full.data.cssStyles ? { cssStyles: full.data.cssStyles } : {}),
        // A copy always starts as a draft. Publishing is a decision about the
        // copy, not one inherited from whatever it was copied from.
        isActive: false,
      });

      setBusy(false);

      if (!created.success) {
        toast({ variant: "error", title: "Could not copy", description: created.error });
        return;
      }

      toast({ variant: "success", title: `Copied to "${created.data.name}"` });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Link
        href={`/certificates/templates/${template.id}`}
        className={buttonStyles({ variant: "ghost", size: "sm" })}
      >
        Edit
      </Link>

      <Button variant="ghost" size="sm" isLoading={busy} onClick={duplicate}>
        Duplicate
      </Button>

      {template.isActive && (
        <Button variant="ghost" size="sm" onClick={archive.open}>
          Archive
        </Button>
      )}

      {/* The dialog owns the request, its loading state and its error surface —
          the project's shared confirmation contract. This component only says
          WHAT to run and what to do once it has succeeded. */}
      <ConfirmDialog
        isOpen={archive.isOpen}
        onClose={archive.close}
        title="Archive this template?"
        description="This template may be referenced by certificates that have already been issued. Archiving stops new certificates being issued from it and does not affect existing certificates."
        confirmLabel="Archive template"
        onConfirm={() => updateCertificateTemplate(template.id, { isActive: false })}
        onSuccess={() => {
          toast({ variant: "success", title: `${template.name} archived` });
          router.refresh();
        }}
      />
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { revokeCertificateAction } from "@/actions/finance";

export interface RevokeCertificateButtonProps {
  id: string;
  certificateNo: string;
  studentName: string;
}

/**
 * Revoke an issued certificate.
 *
 * Revocation is not deletion — the record stays, and the public verification
 * page starts reporting the document as revoked. That is the whole point: a
 * deleted certificate would simply read as "not found", which an employer
 * cannot distinguish from a typo in the number.
 */
export function RevokeCertificateButton({
  id,
  certificateNo,
  studentName,
}: RevokeCertificateButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useDisclosure();

  return (
    <>
      <button
        type="button"
        onClick={confirm.open}
        aria-label={`Revoke ${certificateNo}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Ban className="size-4" aria-hidden="true" />
      </button>

      {confirm.isOpen && (
        <ConfirmDialog
          isOpen
          onClose={confirm.close}
          title="Revoke this certificate?"
          description={`${certificateNo}, issued to ${studentName}, will be marked revoked. Anyone verifying it publicly will see that it no longer stands. The record itself is kept.`}
          confirmLabel="Revoke"
          onConfirm={() => revokeCertificateAction(id)}
          onSuccess={() => {
            toast({ variant: "success", title: "Certificate revoked" });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

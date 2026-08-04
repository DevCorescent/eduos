"use client";

import { useRouter } from "next/navigation";
import { BadgeMinus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { waiveFeeDemandAction } from "@/actions/finance";
import { formatCurrency } from "@/utils/format";

export interface WaiveDemandButtonProps {
  id: string;
  studentName: string;
  outstanding: number;
}

/**
 * Waive the outstanding balance on one demand.
 *
 * Behind a confirmation because it writes off money and cannot be undone from
 * this screen. The dialog names the student and the exact amount — "waive this
 * demand?" without the figure is not enough to decide on.
 */
export function WaiveDemandButton({ id, studentName, outstanding }: WaiveDemandButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useDisclosure();

  return (
    <>
      <button
        type="button"
        onClick={confirm.open}
        aria-label={`Waive ${studentName}'s outstanding fee`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-warning-bg hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BadgeMinus className="size-4" aria-hidden="true" />
      </button>

      {confirm.isOpen && (
        <ConfirmDialog
          isOpen
          onClose={confirm.close}
          title="Waive outstanding fee?"
          description={`${formatCurrency(outstanding)} outstanding for ${studentName} will be written off. The original charge stays on record so the concession remains auditable.`}
          confirmLabel="Waive"
          onConfirm={() => waiveFeeDemandAction(id)}
          onSuccess={() => {
            toast({ variant: "success", title: "Demand waived" });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

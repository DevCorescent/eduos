"use client";

// ============================================================================
// MODULE : Examination — allocate seats
// LAYER  : Client component
// PURPOSE: Ask the server to seat the candidates who hold a hall ticket.
//
// IT SENDS ONLY AN EXAMINATION ID.
//   No seat, no student, no plan. The allocator walks the issued tickets in
//   enrolment order server-side, so nothing here can dictate who sits where or
//   create a conflicting allocation.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/providers/ToastProvider";
import { allocateSeatsAction } from "@/actions/examinations";

export interface AllocateSeatsButtonProps {
  examinationId: string;
  issuedCount: number;
  seatedCount: number;
}

export function AllocateSeatsButton({
  examinationId,
  issuedCount,
  seatedCount,
}: AllocateSeatsButtonProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = Math.max(0, issuedCount - seatedCount);

  async function allocate() {
    setBusy(true);
    setError(null);

    const result = await allocateSeatsAction(examinationId);

    setBusy(false);

    if (!result.success) {
      setError(result.error);
      toast({
        variant: "error",
        title: "Could not allocate seats",
        description: result.error,
      });
      return;
    }

    toast({ variant: "success", title: "Seats allocated" });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={allocate} disabled={busy || issuedCount === 0}>
          <LayoutGrid className="h-4 w-4" />
          {busy ? "Allocating…" : "Allocate seats"}
        </Button>

        <p className="text-xs text-muted-foreground">
          {issuedCount === 0
            ? "Issue hall tickets before allocating seats."
            : pending === 0
              ? "Every ticket already has a seat. Existing allocations are never renumbered."
              : `${pending} ticket${pending === 1 ? "" : "s"} will be seated. Seats already assigned are kept.`}
        </p>
      </div>
    </div>
  );
}

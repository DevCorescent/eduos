"use client";

// ============================================================================
// MODULE : Attendance corrections — review (PRD §13.2)
// LAYER  : Client component
// PURPOSE: Show what is being disputed and let an authorised reviewer decide.
//
// IT SENDS A REQUEST ID AND A DECISION. NOTHING ELSE.
//   Not the attendance id, not the requested status, not the requester. The
//   server re-reads the request, re-checks that it is still PENDING, refuses
//   self-review, and applies the change itself — so nothing rendered here can
//   be edited into a different correction.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/providers/ToastProvider";
import { reviewCorrectionAction } from "@/actions/attendanceCorrections";
import type { AttendanceCorrectionRow } from "@/services/academics";

export interface CorrectionReviewPanelProps {
  request: AttendanceCorrectionRow;
  /** False for a lecturer, who may raise a correction but not decide one. */
  canReview: boolean;
}

export function CorrectionReviewPanel({ request, canReview }: CorrectionReviewPanelProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (request.status !== "PENDING") {
    return (
      <div className="text-xs text-muted-foreground">
        {request.status === "APPROVED" ? "Applied" : "Rejected"}
        {request.reviewNote ? ` — ${request.reviewNote}` : ""}
      </div>
    );
  }

  if (!canReview) {
    return (
      <Badge variant="warning">Awaiting review</Badge>
    );
  }

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(decision);
    setError(null);

    const result = await reviewCorrectionAction(request.id, decision, note || undefined);

    setBusy(null);

    if (!result.success) {
      setError(result.error);
      toast({ variant: "error", title: "Could not record the decision", description: result.error });
      return;
    }

    toast({
      variant: "success",
      title: decision === "APPROVE" ? "Correction applied" : "Correction rejected",
    });
    // The server changed the register; re-read rather than patch local state.
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && <Alert variant="error">{error}</Alert>}

      <Input
        label="Note"
        value={note}
        placeholder="Required when rejecting"
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide("APPROVE")} disabled={busy !== null}>
          <Check className="h-3.5 w-3.5" />
          {busy === "APPROVE" ? "Applying…" : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => decide("REJECT")}
          disabled={busy !== null}
        >
          <X className="h-3.5 w-3.5" />
          {busy === "REJECT" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}

"use client";

// ============================================================================
// MODULE : Examination — issue hall tickets
// LAYER  : Client component
// PURPOSE: One button. It asks the server to issue hall tickets to the eligible
//          cohort of one examination.
//
// IT SENDS ONLY AN EXAMINATION ID.
//   No student list, no eligibility verdict, no count. The server recomputes
//   who is eligible and issues to them, so nothing this component could send
//   would put a ticket in an ineligible student's hands.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TicketCheck } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/providers/ToastProvider";
import { issueHallTicketsAction } from "@/actions/examinations";

export interface IssueHallTicketsButtonProps {
  examinationId: string;
  /** How many of the cohort are eligible right now, for the label. */
  eligibleCount: number;
  /** How many already hold a ticket, so a no-op run is obvious in advance. */
  issuedCount: number;
}

export function IssueHallTicketsButton({
  examinationId,
  eligibleCount,
  issuedCount,
}: IssueHallTicketsButtonProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = Math.max(0, eligibleCount - issuedCount);

  async function issue() {
    setBusy(true);
    setError(null);

    const result = await issueHallTicketsAction(examinationId);

    setBusy(false);

    if (!result.success) {
      setError(result.error);
      toast({
        variant: "error",
        title: "Could not issue hall tickets",
        description: result.error,
      });
      return;
    }

    toast({ variant: "success", title: "Hall tickets issued" });
    // The server recomputed eligibility; re-read rather than trust the numbers
    // this component was rendered with.
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={issue} disabled={busy || eligibleCount === 0}>
          <TicketCheck className="h-4 w-4" />
          {busy ? "Issuing…" : "Issue hall tickets"}
        </Button>

        <p className="text-xs text-muted-foreground">
          {eligibleCount === 0
            ? "No student in this cohort is currently eligible."
            : pending === 0
              ? "Every eligible student already holds a ticket. Running this again issues nothing."
              : `${pending} eligible student${pending === 1 ? "" : "s"} will be issued a ticket.`}
        </p>
      </div>
    </div>
  );
}

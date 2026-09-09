"use client";

// ============================================================================
// MODULE : Semester Result — approval
// LAYER  : Client component
// PURPOSE: One button. It records the Controller of Examination's sign-off on
//          the cohort currently on screen — PRD §17.4, §49.4 stage 8.
//
// IT SENDS ONLY THE SEMESTER ID (and, optionally, a remark).
//   The status is fixed by which endpoint is called, the timestamp is the
//   server's, and the approving user is the authenticated subject. None of the
//   three is a value this component could influence. The action arrives
//   pre-bound with the semester id on the server, so the browser cannot
//   retarget it at a different cohort.
//
// APPROVING DOES NOT PUBLISH. §49.4 keeps Result Approval and Result
// Publication apart, and the confirmation says so — a controller pressing this
// must not believe they have released marks to students.
//
// CONFIRMED FIRST, because there is no un-approve: the stored approvedAt and
// approvedById are an audit fact, and the endpoint answers a second attempt
// with 409 rather than rewriting them. ConfirmDialog renders the failure inside
// itself, beside the button that caused it, which is where a 409 explaining an
// incomplete cohort needs to be.
//
// THIS IS NOT THE AUTHORIZATION. The page withholds this component from anyone
// outside SEMESTER_RESULT_APPROVE_ROLES; the endpoint refuses them regardless
// of what was rendered.
// ============================================================================

import { useRouter } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { approveSemesterResultAction } from "@/actions/evaluation";

export interface ApproveResultButtonProps {
  semesterId: string;
  /** Named in the confirmation, so the dialog says which cohort is signed off. */
  semesterName: string;
  /** How many students the sign-off covers. */
  cohortSize: number;
  /**
   * Whether the cohort currently meets every approval precondition.
   *
   * Derived by the backend from the same checks the endpoint enforces, so a
   * button that could only ever 409 is disabled rather than offered. The
   * endpoint re-checks regardless — this is courtesy, not a gate.
   */
  canApprove: boolean;
  /** Why it cannot be approved, when it cannot. Shown beside the button. */
  blockedReason: string | null;
}

export function ApproveResultButton({
  semesterId,
  semesterName,
  cohortSize,
  canApprove,
  blockedReason,
}: ApproveResultButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const dialog = useDisclosure();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={dialog.open} disabled={!canApprove}>
        <BadgeCheck className="size-4" aria-hidden="true" />
        Approve result
      </Button>

      {!canApprove && blockedReason && (
        <p className="max-w-xs text-right text-xs text-muted-foreground">{blockedReason}</p>
      )}

      <ConfirmDialog
        isOpen={dialog.isOpen}
        onClose={dialog.close}
        title="Approve this semester result?"
        description={`You are signing off ${semesterName} for ${cohortSize} student${
          cohortSize === 1 ? "" : "s"
        } as Controller of Examination. This records your approval against the cohort and cannot be undone. It does NOT publish the result to students — publication is a separate step.`}
        confirmLabel="Approve"
        // Nothing is removed; the red confirm button is for deletions and would
        // misdescribe a sign-off.
        destructive={false}
        onConfirm={() => approveSemesterResultAction(semesterId)}
        onSuccess={() => {
          toast({ variant: "success", title: "Semester result approved" });
          // The server recorded who and when; re-read rather than patch the
          // values this component was rendered with.
          router.refresh();
        }}
      />
    </div>
  );
}

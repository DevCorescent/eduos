"use client";

// ============================================================================
// MODULE : Assignment — publish
// LAYER  : Client component
// PURPOSE: One button. It moves a DRAFT assignment to PUBLISHED, which is what
//          makes the work visible to the students it was set for.
//
// WHY A DRAFT NEEDS THIS AT ALL
//   POST /api/assignments always creates a DRAFT — the schema omits `status`
//   and `publishedAt`, so the database defaults apply. Students read only
//   assignments whose publishedAt is set. Without this control a lecturer could
//   set work that no student would ever see, which is the state the Set
//   assignment dialog would otherwise have shipped in.
//
// IT SENDS ONLY AN ASSIGNMENT ID.
//   The transition is fixed, its target state is not the caller's to choose,
//   and both columns it writes are server-managed. The route re-checks that
//   this lecturer teaches the assignment's course before allowing it, and
//   notifies that course's registered students afterwards — narrowed to the
//   section when the assignment names one.
//
// PUBLICATION IS CONFIRMED FIRST because it notifies a cohort and there is no
// unpublish: AssignmentStatus moves DRAFT → PUBLISHED → CLOSED → GRADED and no
// transition runs backwards. The failure is rendered inside the dialog by
// ConfirmDialog itself, beside the button that caused it.
// ============================================================================

import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { publishAssignmentAction } from "@/actions/assignments";

export interface PublishAssignmentButtonProps {
  assignmentId: string;
  /** The assignment's title, so the confirmation names what is being published. */
  title: string;
  /** Who will see it — one section, or everyone taking the course. */
  audience: string;
}

export function PublishAssignmentButton({
  assignmentId,
  title,
  audience,
}: PublishAssignmentButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const dialog = useDisclosure();

  return (
    <>
      <Button onClick={dialog.open}>
        <Send className="size-4" aria-hidden="true" />
        Publish
      </Button>

      <ConfirmDialog
        isOpen={dialog.isOpen}
        onClose={dialog.close}
        title="Publish this assignment?"
        description={`"${title}" becomes visible to ${audience}, and they are notified. An assignment cannot be returned to draft once published.`}
        confirmLabel="Publish"
        // Not destructive: nothing is removed. The red confirm button is for
        // deletions, and using it here would misdescribe the action.
        destructive={false}
        onConfirm={() => publishAssignmentAction(assignmentId)}
        onSuccess={() => {
          toast({ variant: "success", title: "Assignment published" });
          // The server set publishedAt and moved the status; re-read rather
          // than patch the values this component was rendered with.
          router.refresh();
        }}
      />
    </>
  );
}

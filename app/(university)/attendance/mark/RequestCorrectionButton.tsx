"use client";

// ============================================================================
// MODULE : Attendance corrections — raise (PRD §13.2)
// LAYER  : Client component
// PURPOSE: Let the person who owns the register ask for a recorded mark to be
//          changed, from the screen where they are looking at that mark.
//
// WHY IT LIVES ON THE REGISTER AND NOT ON A FORM OF ITS OWN
//   A correction is always ABOUT one existing row. A standalone form would have
//   to make the requester identify that row by student, course, date and
//   session type — four chances to name a different register than the one they
//   are disputing. Here the row is the thing they are already looking at, so
//   the attendance id is never typed and never guessed.
//
// IT IS RENDERED ONLY WHERE A ROW ALREADY EXISTS
//   An unmarked session has nothing to correct; the register is simply taken.
//   The caller passes attendanceId only for students who already have a mark.
//
// THE BUTTON IS NOT THE GATE
//   POST /api/attendance/corrections applies
//   ATTENDANCE_CORRECTION_REQUEST_ROLES, resolves the requester from the
//   session, and refuses a no-op change and a second pending request on the
//   same row. Hiding this control is a courtesy to the roles that cannot use
//   it, not the thing that stops them.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/providers/ToastProvider";
import { raiseCorrectionAction } from "@/actions/attendanceCorrections";
import { ATTENDANCE_STATUS_LABELS } from "@/constants/labels";
import { ATTENDANCE_STATUS_VALUES, type AttendanceStatus } from "@/types";

export interface RequestCorrectionButtonProps {
  /** The existing register row being disputed. */
  attendanceId: string;
  /** Who the row is about — shown so the requester can see they picked right. */
  studentName: string;
  /** The mark as it stands. Offered statuses exclude it: a no-op is refused. */
  currentStatus: AttendanceStatus;
}

export function RequestCorrectionButton({
  attendanceId,
  studentName,
  currentStatus,
}: RequestCorrectionButtonProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [requestedStatus, setRequestedStatus] = useState("");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // The current status is left out rather than disabled: the service refuses a
  // no-op, so offering it would only produce a rejection the requester could
  // have been spared.
  const options = ATTENDANCE_STATUS_VALUES.filter((status) => status !== currentStatus).map(
    (status) => ({ value: status, label: ATTENDANCE_STATUS_LABELS[status] })
  );

  function close() {
    setIsOpen(false);
    setRequestedStatus("");
    setReason("");
    setError(null);
    setFieldError(null);
  }

  async function submit() {
    setIsSaving(true);
    setError(null);
    setFieldError(null);

    const result = await raiseCorrectionAction({ attendanceId, requestedStatus, reason });

    setIsSaving(false);

    if (!result.success) {
      // A field-scoped failure belongs beside the field; anything else is about
      // the request as a whole (already pending, record gone, refused).
      if (result.field) setFieldError(result.field);
      setError(result.error);
      return;
    }

    toast({
      variant: "success",
      title: "Correction requested",
      description: "It appears in the correction queue until somebody decides it.",
    });
    close();
    // Nothing on this register changed — the mark keeps its value until the
    // request is approved — but the page may show pending state elsewhere.
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<MessageSquareWarning className="size-4" />}
        onClick={() => setIsOpen(true)}
      >
        Request correction
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={close}
        title="Request a correction"
        description={`${studentName} — currently marked ${ATTENDANCE_STATUS_LABELS[currentStatus]}.`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={submit} isLoading={isSaving}>
              Send request
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}

          <Select
            label="Corrected status"
            required
            value={requestedStatus}
            onChange={setRequestedStatus}
            options={options}
            placeholder="Select the correct status"
            error={fieldError === "requestedStatus" ? error ?? undefined : undefined}
          />

          <Textarea
            label="Reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What happened, and why the mark is wrong."
            helperText="The reviewer sees this, and it stays on the record."
            error={fieldError === "reason" ? error ?? undefined : undefined}
          />

          {/* Said plainly, because the obvious reading of a form like this is
              that pressing the button changes the mark. It does not. */}
          <p className="text-xs text-muted-foreground">
            The register is not changed by this request. The mark keeps its current
            value until an approver accepts the change.
          </p>
        </div>
      </Modal>
    </>
  );
}

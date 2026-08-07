"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { allocateOfferingAction, lockOfferingAction } from "@/actions/electives";
import type { OpenElectiveOfferingDto } from "@/lib/dto/openElective.dto";

/**
 * Lock and Allocate, gated on the offering's own lifecycle.
 *
 * The two buttons are shown by status rather than always-shown-and-disabled: a
 * disabled "Allocate" next to an OPEN offering invites the question "why not",
 * and the answer — that choices are still being taken — is better expressed by
 * the button that IS there.
 *
 * Both are confirmed. Locking stops students editing choices they may not have
 * finished, and allocation assigns seats that a re-run cannot quietly undo;
 * neither should be one stray click away.
 */
export function OfferingActions({
  offeringId,
  status,
  courseName,
}: {
  offeringId: string;
  status: OpenElectiveOfferingDto["status"];
  courseName: string;
}) {
  const router = useRouter();
  const lock = useDisclosure();
  const allocate = useDisclosure();
  const [pending, setPending] = useState(false);

  if (status === "OPEN") {
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={lock.open}
          isLoading={pending}
        >
          Lock
        </Button>
        <ConfirmDialog
          isOpen={lock.isOpen}
          onClose={lock.close}
          title="Lock this offering?"
          description={`Students will no longer be able to add or change their choices for "${courseName}". Locking is required before seats can be allocated.`}
          confirmLabel="Lock"
          destructive={false}
          onConfirm={async () => {
            setPending(true);
            const result = await lockOfferingAction(offeringId);
            setPending(false);
            return result;
          }}
          onSuccess={() => router.refresh()}
        />
      </>
    );
  }

  if (status === "LOCKED") {
    return (
      <>
        <Button variant="primary" size="sm" onClick={allocate.open} isLoading={pending}>
          Allocate
        </Button>
        <ConfirmDialog
          isOpen={allocate.isOpen}
          onClose={allocate.close}
          title="Allocate seats?"
          description={`Seats on "${courseName}" will be assigned from the ranked choices on record. Students who are not allocated will see that outcome.`}
          confirmLabel="Allocate"
          destructive={false}
          onConfirm={async () => {
            setPending(true);
            const result = await allocateOfferingAction(offeringId);
            setPending(false);
            return result;
          }}
          onSuccess={() => router.refresh()}
        />
      </>
    );
  }

  // DRAFT has nothing to lock and nothing to settle; ALLOCATED is finished.
  return null;
}

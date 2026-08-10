"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { archiveTenant } from "@/services/tenants";
import { formatDateTime } from "@/utils/format";
import type { Tenant } from "@/types";

export interface TenantArchivePanelProps {
  tenant: Pick<Tenant, "id" | "name" | "status"> & { archivedAt?: string | null };
}

/**
 * PRD §5.1 "Tenant deletion and data archival" — the archival half.
 *
 * THERE IS NO DELETE BUTTON, DELIBERATELY
 *   Deleting a Tenant cascades away its users, campuses, students, results and
 *   certificates. §5.1 names deletion and archival as one capability and the
 *   specification defines neither a retention period nor a restore procedure,
 *   so shipping the destructive half alone would put an irreversible action
 *   behind a single click with none of its safeguards specified.
 *
 * ARCHIVING IS REVERSIBLE AND KEEPS EVERYTHING
 *   The university stops serving traffic through the same mechanism that
 *   already stops a suspended one. Nothing is removed.
 *
 * TYPE-TO-CONFIRM
 *   The operator types the university's name. Archiving takes an entire
 *   institution offline, and a confirm dialog whose button is in the same place
 *   as every other confirm dialog's is too easy to click through — this one
 *   requires the name to be read and reproduced.
 */
export function TenantArchivePanel({ tenant }: TenantArchivePanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArchived = tenant.status === "ARCHIVED";
  const nameMatches = confirmName.trim() === tenant.name;

  function close() {
    modal.close();
    setConfirmName("");
    setReason("");
    setError(null);
  }

  async function archive() {
    setError(null);
    setIsWorking(true);
    const result = await archiveTenant(tenant.id, { reason: reason.trim() || undefined });
    setIsWorking(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast({ variant: "success", title: `${tenant.name} archived`, description: "All data retained." });
    close();
    router.refresh();
  }

  async function restore() {
    setError(null);
    setIsWorking(true);
    const result = await archiveTenant(tenant.id, { restore: true });
    setIsWorking(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast({
      variant: "success",
      title: `${tenant.name} restored`,
      description: "Now Suspended. Set it to Active when ready.",
    });
    router.refresh();
  }

  return (
    <>
      <Card>
        <h2 className="text-sm font-semibold text-heading">Archive</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          An archived university stops resolving and nobody can sign in. Every record it owns is
          kept — archiving is not deletion, and it can be undone.
        </p>

        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}

        {isArchived ? (
          <>
            <Alert variant="warning" className="mt-3">
              Archived{tenant.archivedAt ? ` on ${formatDateTime(tenant.archivedAt)}` : ""}. Restoring
              returns it to Suspended, not Active.
            </Alert>
            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={restore}
                isLoading={isWorking}
                leftIcon={<ArchiveRestore className="size-4" />}
              >
                Restore university
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-4">
            <Button
              variant="destructive"
              onClick={modal.open}
              leftIcon={<Archive className="size-4" />}
            >
              Archive university
            </Button>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Permanent deletion is not available. The specification defines archival without a
          retention period, export format or restore window, so no destructive action has been
          built on top of it.
        </p>
      </Card>

      <Modal
        isOpen={modal.isOpen}
        onClose={close}
        title={`Archive ${tenant.name}?`}
        description="Every student, faculty member and administrator loses access from the next request. No data is deleted, and you can restore the university at any time."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isWorking}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={archive}
              isLoading={isWorking}
              // The name must be reproduced exactly — this is the guard against
              // archiving the wrong institution from a list of similar ones.
              disabled={!nameMatches}
            >
              Archive university
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contract ended"
            helperText="Recorded with the archival. Optional."
          />
          <Input
            label={`Type "${tenant.name}" to confirm`}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}

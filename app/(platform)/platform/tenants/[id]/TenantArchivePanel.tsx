"use client";

import { useState } from "react";
import Link from "next/link";
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
  /**
   * True when the last attempt failed because the PLATFORM SESSION had expired.
   *
   * The same distinction TenantStatusControl draws, for the same reason and on
   * the same page: this panel was server-rendered while the session was valid,
   * so nothing on screen looks signed out. A bare "Unauthorized" therefore reads
   * as "this university may not be archived" — a permission refusal — rather
   * than "your session ended, sign in again".
   */
  const [sessionExpired, setSessionExpired] = useState(false);

  const isArchived = tenant.status === "ARCHIVED";
  const nameMatches = confirmName.trim() === tenant.name;

  function close() {
    modal.close();
    setConfirmName("");
    setReason("");
    setError(null);
    // sessionExpired is deliberately NOT cleared here. Archiving closes this
    // dialog on an expired session so the card's explanation is visible, and
    // clearing the flag on the way out would remove the very message the close
    // was performed to reveal. Each new attempt resets it below.
  }

  /**
   * Report a refused write.
   *
   * ONLY 401 becomes "your session expired". requirePlatformAdmin answers 403
   * when the caller IS somebody who may not do this — a tenant user, a
   * deactivated operator, or one whose PLATFORM_ADMIN grant was revoked — and
   * signing in again resolves none of those. Folding it in here would describe a
   * genuine permission refusal as a timeout and send the operator round a loop
   * that cannot end, so a 403 keeps its own message.
   *
   * Returns true when the failure was an expired session, so the archive path
   * can close its dialog and uncover the card behind it.
   */
  function reportFailure(result: { error: string; code?: string }): boolean {
    if (result.code === "UNAUTHORIZED") {
      setSessionExpired(true);
      return true;
    }

    setError(result.error);
    return false;
  }

  async function archive() {
    setError(null);
    setSessionExpired(false);
    setIsWorking(true);
    const result = await archiveTenant(tenant.id, { reason: reason.trim() || undefined });
    setIsWorking(false);

    if (!result.success) {
      // On an expired session the explanation and its Sign in link live on the
      // card, behind this dialog. Closing hands the operator to them; leaving
      // the dialog open would cover the one thing that tells them what to do.
      if (reportFailure(result)) close();
      return;
    }

    toast({ variant: "success", title: `${tenant.name} archived`, description: "All data retained." });
    close();
    router.refresh();
  }

  async function restore() {
    setError(null);
    setSessionExpired(false);
    setIsWorking(true);
    const result = await archiveTenant(tenant.id, { restore: true });
    setIsWorking(false);

    if (!result.success) {
      // No dialog to close — this control lives on the card, where both
      // messages already render.
      reportFailure(result);
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

        {sessionExpired && (
          <Alert variant="error" className="mt-3">
            Your platform session has expired, so this change was not saved. Sign in again to
            continue.{" "}
            <Link href="/super-admin/login" className="font-medium underline underline-offset-2">
              Sign in
            </Link>
          </Alert>
        )}

        {error && !sessionExpired && (
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

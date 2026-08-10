"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { updateTenant } from "@/services/tenants";
import { TENANT_STATUS_LABELS } from "@/constants/labels";
import { TENANT_STATUS_VALUES, type Tenant, type TenantStatus } from "@/types";

export interface TenantStatusControlProps {
  tenant: Pick<Tenant, "id" | "name" | "status">;
}

/**
 * Statuses that stop a university being usable.
 *
 * Both are refused in TWO places already, which is what makes this control
 * meaningful rather than cosmetic: lib/services/tenant.ts will not resolve the
 * hostname, and /api/auth/login will not issue a session. So deactivating here
 * ends access on the next request — it does not merely relabel a row.
 */
const BLOCKING_STATUSES: TenantStatus[] = ["SUSPENDED", "CANCELLED", "ARCHIVED"];

/**
 * ARCHIVED is not offered in this dropdown.
 *
 * Archiving is its own endpoint with its own confirmation, because it records a
 * reason and a timestamp that a generic status change would not. Leaving it
 * selectable here would give an operator two routes to the same state, only one
 * of which keeps the record. Restoring is likewise done from the archive panel.
 */
const STATUSES_SET_BY_DROPDOWN = TENANT_STATUS_VALUES.filter((s) => s !== "ARCHIVED");

/**
 * Change a university's status (W1.4 — activate / deactivate).
 *
 * DEACTIVATION IS A STATUS CHANGE, NOT A DELETE
 *   Deleting a Tenant cascades away its users, roles, campuses, students and
 *   every record they own. Suspension stops access while keeping all of it, and
 *   is reversed by setting the status back.
 *
 * A move INTO a blocking status is confirmed; a move out of one is not — the
 * first removes access for an entire institution, and the second restores it
 * and is trivially reversed by the control that did it.
 */
export function TenantStatusControl({ tenant }: TenantStatusControlProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useDisclosure();

  const [selected, setSelected] = useState<TenantStatus>(tenant.status);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBlocked = BLOCKING_STATUSES.includes(tenant.status);
  const willBlock = BLOCKING_STATUSES.includes(selected);
  const changed = selected !== tenant.status;

  async function apply(status: TenantStatus) {
    setError(null);
    setIsSaving(true);
    const result = await updateTenant(tenant.id, { status });
    setIsSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast({
      variant: "success",
      title: `${tenant.name} is now ${TENANT_STATUS_LABELS[status]}`,
    });
    // Re-runs the server page, so the header badge and this control re-read the
    // saved record rather than stale client state that merely looks saved.
    router.refresh();
  }

  return (
    <>
      <Card>
        <h2 className="text-sm font-semibold text-heading">Status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A suspended or cancelled university stops resolving and its users cannot sign in. No
          data is deleted, and setting the status back restores access.
        </p>

        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}

        {isBlocked && (
          <Alert variant="warning" className="mt-3">
            Nobody at {tenant.name} can sign in while it is{" "}
            {TENANT_STATUS_LABELS[tenant.status]}.
          </Alert>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Select
            label="Status"
            value={selected}
            onChange={(value) => setSelected(value as TenantStatus)}
            options={STATUSES_SET_BY_DROPDOWN.map((value) => ({
              value,
              label: TENANT_STATUS_LABELS[value],
            }))}
            // An archived university cannot be moved out of ARCHIVED from here:
            // restoring goes through the archive panel, which is where the
            // record of the archival lives.
            disabled={tenant.status === "ARCHIVED"}
            containerClassName="w-48"
          />
          <Button
            disabled={!changed}
            isLoading={isSaving}
            variant={willBlock ? "destructive" : "primary"}
            onClick={() => (willBlock ? confirm.open() : apply(selected))}
          >
            {willBlock ? "Deactivate university" : "Apply"}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        isOpen={confirm.isOpen}
        onClose={confirm.close}
        title={`Set ${tenant.name} to ${TENANT_STATUS_LABELS[selected]}?`}
        description={`Every student, faculty member and administrator at ${tenant.name} will be unable to sign in, and its address will stop resolving, from the next request. Nothing is deleted — you can restore access by setting the status back.`}
        confirmLabel={TENANT_STATUS_LABELS[selected]}
        onConfirm={() => updateTenant(tenant.id, { status: selected })}
        onSuccess={() => {
          confirm.close();
          toast({
            variant: "success",
            title: `${tenant.name} is now ${TENANT_STATUS_LABELS[selected]}`,
          });
          router.refresh();
        }}
      />
    </>
  );
}

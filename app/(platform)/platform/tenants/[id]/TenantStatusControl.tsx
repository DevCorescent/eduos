"use client";

import { useState } from "react";
import Link from "next/link";
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
import {
  TENANT_STATUS_VALUES,
  type ApiResponse,
  type Tenant,
  type TenantStatus,
} from "@/types";

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
  /**
   * True when the last attempt failed because the PLATFORM SESSION had expired.
   *
   * Distinguished from every other failure because the recovery is different
   * and the operator cannot guess it: nothing about the console looks signed
   * out — it was server-rendered while the session was still valid — so a bare
   * "Unauthorized" reads as "this university may not be changed" rather than
   * "your session ended". See the message rendered below.
   */
  const [sessionExpired, setSessionExpired] = useState(false);

  const isBlocked = BLOCKING_STATUSES.includes(tenant.status);
  const willBlock = BLOCKING_STATUSES.includes(selected);
  const changed = selected !== tenant.status;

  /**
   * The ONE write both controls perform.
   *
   * The "Apply" button calls it directly; the confirmation dialog calls it
   * through its own onConfirm. That is the point — the 401 handling below used
   * to live here while the dialog called updateTenant() itself, so a move to
   * TRIAL reported an expired session correctly and a move to SUSPENDED or
   * CANCELLED — the two that go through the dialog — showed a bare
   * "Unauthorized" instead. One implementation cannot disagree with itself.
   *
   * Returns the envelope so the dialog can decide whether to stay open. Nothing
   * about the request or its authorization differs between the two callers.
   */
  async function apply(status: TenantStatus): Promise<ApiResponse<Tenant>> {
    setError(null);
    setSessionExpired(false);
    setIsSaving(true);
    const result = await updateTenant(tenant.id, { status });
    setIsSaving(false);

    if (!result.success) {
      // The platform session lasts one hour; a console left open longer than
      // that holds an expired edu_platform cookie. requirePlatformAdmin then
      // answers 401 UNAUTHORIZED, which this panel used to render verbatim as
      // "Unauthorized" — a dead end that looked like a permission refusal.
      //
      // NOTHING about the authorization is changed here: the request is still
      // refused, and it should be. What changes is that the operator is told
      // WHY and given the one action that resolves it.
      //
      // ONLY 401. A 403 is NOT folded in here: requirePlatformAdmin answers 403
      // when the caller IS somebody — a tenant user, a deactivated operator, or
      // one whose PLATFORM_ADMIN grant was revoked — and signing in again does
      // not resolve any of those. Calling that "your session expired" would
      // send the operator round a loop that cannot end, and would describe a
      // genuine permission refusal as a timeout. It keeps the message below.
      if (result.code === "UNAUTHORIZED") {
        setSessionExpired(true);
        return result;
      }

      setError(result.error);
      return result;
    }

    toast({
      variant: "success",
      title: `${tenant.name} is now ${TENANT_STATUS_LABELS[status]}`,
    });
    // Re-runs the server page, so the header badge and this control re-read the
    // saved record rather than stale client state that merely looks saved.
    router.refresh();

    return result;
  }

  return (
    <>
      <Card>
        <h2 className="text-sm font-semibold text-heading">Status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A suspended or cancelled university stops resolving and its users cannot sign in. No
          data is deleted, and setting the status back restores access.
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

      {/* Mounted only while open — the idiom RevokeCertificateButton and
          WaiveDemandButton already use. ConfirmDialog keeps its own `error`
          state, and this panel closes the dialog on an expired session (below);
          left mounted, that state would survive the close and greet the next
          attempt with the previous one's message. */}
      {confirm.isOpen && (
        <ConfirmDialog
          isOpen
          onClose={confirm.close}
          title={`Set ${tenant.name} to ${TENANT_STATUS_LABELS[selected]}?`}
          description={`Every student, faculty member and administrator at ${tenant.name} will be unable to sign in, and its address will stop resolving, from the next request. Nothing is deleted — you can restore access by setting the status back.`}
          confirmLabel={TENANT_STATUS_LABELS[selected]}
          // The same apply() the Apply button uses, so this path cannot lose the
          // session handling. It also carries the toast and the refresh, which
          // is why no onSuccess is needed — ConfirmDialog closes itself on
          // success, and duplicating them here would toast twice.
          onConfirm={async () => {
            const result = await apply(selected);

            // An expired platform session is answered by the PANEL, which is
            // where the explanation and its Sign in link live. Closing hands the
            // operator to it; leaving the dialog open would cover that message
            // with ConfirmDialog's own rendering of the raw "Unauthorized" —
            // exactly the dead end the Apply button was fixed to avoid.
            //
            // Every other failure stays in the dialog, as it does on every other
            // screen: a 403, a 409 or a 500 is about the action just attempted,
            // and belongs next to the button that attempted it.
            if (!result.success && result.code === "UNAUTHORIZED") confirm.close();

            return result;
          }}
        />
      )}
    </>
  );
}

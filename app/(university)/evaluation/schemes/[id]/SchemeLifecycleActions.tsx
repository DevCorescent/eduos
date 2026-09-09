"use client";

// ============================================================================
// MODULE : Evaluation Scheme — lifecycle
// LAYER  : Client component
// PURPOSE: The two transitions a regulation has: put a draft into force, and
//          retire an active one.
//
// WHY TRANSITIONS AND NOT A STATUS FIELD
//   Neither is a write to `status`. Activation has preconditions the edit form
//   cannot check — the component tree's weightings must total correctly and the
//   cited grade scale must itself be active — and those belong to the
//   transition. EVALUATION_SCHEME_TRANSITIONS states the whole machine:
//   DRAFT → ACTIVE → ARCHIVED, and ARCHIVED goes nowhere.
//
// EACH SENDS ONLY THE SCHEME ID.
//   The target state is not the caller's to choose; it is fixed by which
//   endpoint is called. The action arrives pre-bound with the id on the server,
//   so the browser cannot retarget it at another regulation.
//
// BOTH ARE CONFIRMED FIRST because neither runs backwards. Activating publishes
// the regulation every result under it will be computed by; archiving retires
// it. The failure is rendered inside the dialog by ConfirmDialog, beside the
// button that caused it — which is where a 409 explaining an invalid tree or an
// inactive grade scale needs to be.
// ============================================================================

import { useRouter } from "next/navigation";
import { Archive, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { activateSchemeAction, archiveSchemeAction } from "@/actions/evaluation";

export interface SchemeLifecycleActionsProps {
  schemeId: string;
  /** Shown in the confirmation, so it names the regulation being changed. */
  schemeName: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  /**
   * Whether the component tree currently validates.
   *
   * Activation is withheld when it does not: the endpoint would answer 409, and
   * the violations are already listed above the fold with what to fix.
   */
  canActivate: boolean;
}

export function SchemeLifecycleActions({
  schemeId,
  schemeName,
  status,
  canActivate,
}: SchemeLifecycleActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const activate = useDisclosure();
  const archive = useDisclosure();

  // ARCHIVED is terminal — the transition table gives it no successor — so it
  // renders no control at all rather than a disabled one.
  if (status === "ARCHIVED") return null;

  if (status === "DRAFT") {
    if (!canActivate) return null;

    return (
      <>
        <Button onClick={activate.open}>
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Activate
        </Button>

        <ConfirmDialog
          isOpen={activate.isOpen}
          onClose={activate.close}
          title="Activate this regulation?"
          description={`"${schemeName}" comes into force and can no longer be amended or discarded — every result computed under it must stay explicable. Retiring it later is done by archiving.`}
          confirmLabel="Activate"
          // Nothing is removed; the red confirm button is for deletions and
          // would misdescribe this.
          destructive={false}
          onConfirm={() => activateSchemeAction(schemeId)}
          onSuccess={() => {
            toast({ variant: "success", title: "Scheme activated" });
            router.refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={archive.open}>
        <Archive className="size-4" aria-hidden="true" />
        Archive
      </Button>

      <ConfirmDialog
        isOpen={archive.isOpen}
        onClose={archive.close}
        title="Archive this regulation?"
        description={`"${schemeName}" is retired and stops governing new results. It is kept in full, because results already computed under it must remain explicable. This cannot be undone.`}
        confirmLabel="Archive"
        destructive={false}
        onConfirm={() => archiveSchemeAction(schemeId)}
        onSuccess={() => {
          toast({ variant: "success", title: "Scheme archived" });
          router.refresh();
        }}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { updatePlatformUser } from "@/services/platformUsers";
import type { PlatformUser } from "@/types";
import { ResetPasswordAction } from "./ResetPasswordAction";

export interface PlatformUserActionsProps {
  user: PlatformUser;
  /**
   * The signed-in operator's id.
   *
   * Used to withhold "Deactivate" on the caller's own row. The API refuses it
   * anyway (409) — this only avoids offering a control that cannot work.
   */
  currentUserId: string;
}

/**
 * The per-row actions on the platform user list: edit, reset password and
 * activate/deactivate.
 *
 * WHY DEACTIVATING IS CONFIRMED AND ACTIVATING IS NOT
 *   Deactivating removes somebody's access to the console and is not undoable
 *   by the person it happens to. Activating grants access and is reversed by
 *   the button that replaces it, so a confirmation there would be ceremony.
 *
 * Every mutation ends in router.refresh(), which re-runs the server page and
 * re-fetches the list. That is why the rows are not held in client state: there
 * is no cache to invalidate by hand and no way for the table and the server to
 * disagree.
 */
export function PlatformUserActions({ user, currentUserId }: PlatformUserActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const deactivate = useDisclosure();
  const [isActivating, setIsActivating] = useState(false);

  const isSelf = user.id === currentUserId;

  async function activate() {
    setIsActivating(true);
    const result = await updatePlatformUser(user.id, { isActive: true });
    setIsActivating(false);

    if (!result.success) {
      toast({ variant: "error", title: "Could not activate", description: result.error });
      return;
    }

    toast({ variant: "success", title: `${user.email} can sign in again` });
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Link
        href={`/platform/users/${user.id}`}
        className={buttonStyles({ variant: "ghost", size: "sm" })}
        aria-label={`Edit ${user.email}`}
      >
        <Pencil className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only sm:ml-1.5">Edit</span>
      </Link>

      <ResetPasswordAction user={user} variant="ghost" size="sm" compact />

      {user.isActive ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={deactivate.open}
          // The API answers 409 for this case; the control is disabled so the
          // refusal is never the way somebody finds out.
          disabled={isSelf}
          title={isSelf ? "You cannot deactivate your own account" : undefined}
        >
          Deactivate
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={activate} isLoading={isActivating}>
          Activate
        </Button>
      )}

      <ConfirmDialog
        isOpen={deactivate.isOpen}
        onClose={deactivate.close}
        title="Deactivate this operator?"
        description={`${user.firstName} ${user.lastName} (${user.email}) will lose the platform console on their next request and will not be able to sign in. Their account and role are kept, and you can activate them again at any time.`}
        confirmLabel="Deactivate"
        onConfirm={() => updatePlatformUser(user.id, { isActive: false })}
        onSuccess={() => {
          toast({ variant: "success", title: `${user.email} deactivated` });
          router.refresh();
        }}
      />
    </div>
  );
}

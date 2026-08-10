"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDisclosure } from "@/hooks/useDisclosure";
import { resetPlatformUserPassword } from "@/services/platformUsers";
import type { PlatformUser } from "@/types";
import { TemporaryPasswordDialog } from "./TemporaryPasswordDialog";

export interface ResetPasswordActionProps {
  user: PlatformUser;
  /** Styling for the trigger. The list row wants a quiet button, the detail page a solid one. */
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Hides the trigger's text below `sm`, for the dense table row. */
  compact?: boolean;
}

/**
 * "Reset password" — the trigger, its confirmation and the one-time disclosure.
 *
 * Kept as one component used by both the list row and the detail page, because
 * the three pieces belong together: the plaintext arrives in the confirmation's
 * response and must be handed straight to the dialog. Splitting them would mean
 * lifting a credential into a parent that has no other reason to hold one.
 *
 * WHY THE CONFIRMATION EXISTS
 *   The reset takes effect immediately — the operator's current password stops
 *   working the moment it succeeds. That is recoverable, but not by the person
 *   it happens to, and the trigger sits beside a harmless "Edit" in a dense
 *   table where a mis-click is easy.
 */
export function ResetPasswordAction({
  user,
  variant = "secondary",
  size = "md",
  compact = false,
}: ResetPasswordActionProps) {
  const router = useRouter();
  const confirm = useDisclosure();
  // Held only while the dialog is open, then dropped. Never persisted and never
  // put in the URL — the server keeps nothing but its bcrypt hash.
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={confirm.open}
        leftIcon={<KeyRound className="size-4" />}
        aria-label={`Reset the password for ${user.email}`}
      >
        <span className={compact ? "sr-only sm:not-sr-only" : undefined}>Reset password</span>
      </Button>

      <ConfirmDialog
        isOpen={confirm.isOpen}
        onClose={confirm.close}
        title="Reset this operator's password?"
        description={`A new temporary password will be generated for ${user.email} and shown to you once. Their current password stops working immediately, and they must choose a new one before they can use the console.`}
        confirmLabel="Reset password"
        onConfirm={async () => {
          const result = await resetPlatformUserPassword(user.id);
          if (result.success) {
            // Captured here rather than in onSuccess, which receives nothing —
            // the plaintext exists in this response and nowhere else.
            setTemporaryPassword(result.data.temporaryPassword);
          }
          return result;
        }}
        onSuccess={() => {
          confirm.close();
          router.refresh();
        }}
      />

      {temporaryPassword && (
        <TemporaryPasswordDialog
          isOpen
          email={user.email}
          password={temporaryPassword}
          // Dropping the value unmounts the dialog, so the plaintext is not
          // left sitting in component state behind a closed modal.
          onClose={() => setTemporaryPassword(null)}
        />
      )}
    </>
  );
}

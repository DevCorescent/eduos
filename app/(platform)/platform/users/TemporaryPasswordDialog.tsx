"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface TemporaryPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Who the password belongs to. Named so it cannot be handed to the wrong person. */
  email: string;
  /** The plaintext, held in component state only. */
  password: string;
}

/**
 * Shows a generated password once, and says plainly that it is once.
 *
 * WHY THIS IS A MODAL AND NOT A TOAST
 *   A toast dismisses itself. This value cannot be re-read from anywhere — the
 *   database holds only its bcrypt hash — so an operator who looks away while a
 *   toast expires has to issue a second reset and lock the account's owner out
 *   again in the meantime. It stays until it is deliberately dismissed.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 *   It does not persist the password, put it in the URL, or send it anywhere.
 *   The value lives in the parent's state for as long as the dialog is open and
 *   is dropped on close. Copying uses the clipboard API and nothing else.
 */
export function TemporaryPasswordDialog({
  isOpen,
  onClose,
  email,
  password,
}: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      // Reverts the confirmation so a second copy is visibly a second copy.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some browsers and over plain HTTP. The
      // password is on screen and selectable either way, so this is not worth
      // an error banner — the button simply does not confirm.
    }
  }

  function close() {
    setCopied(false);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Temporary password"
      description={`Give this to ${email}. It is shown once and cannot be retrieved again.`}
      footer={
        <div className="flex justify-end">
          <Button onClick={close}>Done</Button>
        </div>
      }
    >
      <div className="flex items-center gap-2">
        {/* Monospace and selectable: this gets read aloud and copied by hand. */}
        <code className="flex-1 rounded-lg bg-muted px-3 py-2.5 font-mono text-sm break-all text-foreground">
          {password}
        </code>
        <Button
          variant="secondary"
          onClick={copy}
          leftIcon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <Alert variant="info" className="mt-4">
        They will be asked to choose their own password when they sign in, and cannot use the
        console until they do.
      </Alert>
    </Modal>
  );
}

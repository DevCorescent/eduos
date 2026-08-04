"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { ApiResponse } from "@/types";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** What will happen, and to what. Name the specific record. */
  description: string;
  /** @default "Delete" */
  confirmLabel?: string;
  /** Styles the confirm button as destructive. @default true */
  destructive?: boolean;
  onConfirm: () => Promise<ApiResponse<unknown>>;
  onSuccess?: () => void;
}

/**
 * Confirmation before an irreversible action.
 *
 * The failure is rendered inside the dialog rather than closing and toasting,
 * because the common failure here is a 409 the user can act on — "Campus still
 * has schools or departments" tells them what to remove first, and it belongs
 * next to the button they just pressed rather than in a corner after the
 * context has gone.
 *
 * @example
 * ```tsx
 * <ConfirmDialog
 *   isOpen={confirm.isOpen}
 *   onClose={confirm.close}
 *   title="Delete campus?"
 *   description={`"${campus.name}" will be permanently removed.`}
 *   onConfirm={() => deleteCampusAction(campus.id)}
 *   onSuccess={() => router.refresh()}
 * />
 * ```
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  onConfirm,
  onSuccess,
}: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setIsSubmitting(true);

    const result = await onConfirm();
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    onSuccess?.();
    close();
  }

  function close() {
    setError(null);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={handleConfirm}
            isLoading={isSubmitting}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">{description}</p>

      {error && (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      )}
    </Modal>
  );
}

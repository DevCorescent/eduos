"use client";

import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  EntityFormModal,
  type FormField,
  type FormValues,
} from "./EntityFormModal";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import type { ApiResponse } from "@/types";

/** What a Server Action returns, plus the optional field a conflict belongs to. */
type ActionResult = ApiResponse<unknown> & { field?: string };

// --- Create -----------------------------------------------------------------

export interface EntityCreateButtonProps {
  /** Singular entity name, e.g. "Campus". Drives the button and dialog copy. */
  entityLabel: string;
  fields: FormField[];
  initialValues: FormValues;
  /** Pre-bound Server Action taking only the form values. */
  action: (values: FormValues) => Promise<ActionResult>;
  size?: "sm" | "md" | "lg";
  modalSize?: "sm" | "md" | "lg";
  /** Overrides the default "Add {entityLabel}" label. */
  label?: string;
}

/**
 * "Add …" button and its create dialog.
 *
 * On success it calls router.refresh(), which re-runs the Server Component page
 * and re-fetches the list. The table is never held in client state, so there is
 * no cache to invalidate by hand and no way for the rows on screen to disagree
 * with the server.
 */
export function EntityCreateButton({
  entityLabel,
  fields,
  initialValues,
  action,
  size = "md",
  modalSize = "md",
  label,
}: EntityCreateButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();

  return (
    <>
      <Button size={size} leftIcon={<Plus className="size-4" />} onClick={modal.open}>
        {label ?? `Add ${entityLabel.toLowerCase()}`}
      </Button>

      {/* Mounted only while open, so every opening starts from a fresh form.
          Keeping it mounted would mean resetting state from an effect, which
          renders the stale values first. */}
      {modal.isOpen && (
        <EntityFormModal
          isOpen
          onClose={modal.close}
          title={`Add ${entityLabel.toLowerCase()}`}
          fields={fields}
          initialValues={initialValues}
          submitLabel="Create"
          size={modalSize}
          onSubmit={action}
          onSuccess={() => {
            toast({ variant: "success", title: `${entityLabel} created` });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// --- Row actions ------------------------------------------------------------

export interface EntityRowActionsProps {
  entityLabel: string;
  /** The specific record's name, used in the delete confirmation. */
  recordName: string;
  /** Omit to hide the edit action. */
  editFields?: FormField[];
  editValues?: FormValues;
  /** Pre-bound update action, e.g. `updateCampusAction.bind(null, row.id)`. */
  onUpdate?: (values: FormValues) => Promise<ActionResult>;
  /** Pre-bound delete action. Omit to hide the delete action. */
  onDelete?: () => Promise<ActionResult>;
  /** Extra description shown in the delete dialog, e.g. what will cascade. */
  deleteWarning?: string;
  modalSize?: "sm" | "md" | "lg";
}

/**
 * Per-row edit and delete controls.
 *
 * Each row renders its own instance, so each owns the dialog for its own
 * record. A single shared dialog lifted to the page would need the "currently
 * selected row" tracked in state and passed down, which is the usual source of
 * "deleted the wrong record" bugs when a list re-orders between selection and
 * confirmation.
 *
 * The cost is one small client component per row, but the dialogs render
 * through a portal only while open, so a closed row costs two buttons.
 *
 * Actions arrive pre-bound with their record id via `.bind(null, id)` on the
 * server. That keeps the id out of the client payload as a mutable value — the
 * browser cannot retarget the action at a different record.
 */
export function EntityRowActions({
  entityLabel,
  recordName,
  editFields,
  editValues,
  onUpdate,
  onDelete,
  deleteWarning,
  modalSize = "md",
}: EntityRowActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const editModal = useDisclosure();
  const deleteModal = useDisclosure();

  const canEdit = Boolean(onUpdate && editFields && editValues);

  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <button
          type="button"
          onClick={editModal.open}
          aria-label={`Edit ${recordName}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={deleteModal.open}
          aria-label={`Delete ${recordName}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      )}

      {canEdit && editModal.isOpen && (
        <EntityFormModal
          isOpen
          onClose={editModal.close}
          title={`Edit ${entityLabel.toLowerCase()}`}
          description={recordName}
          fields={editFields!}
          initialValues={editValues!}
          submitLabel="Save changes"
          size={modalSize}
          onSubmit={onUpdate!}
          onSuccess={() => {
            toast({ variant: "success", title: `${entityLabel} updated` });
            router.refresh();
          }}
        />
      )}

      {onDelete && (
        <ConfirmDialog
          isOpen={deleteModal.isOpen}
          onClose={deleteModal.close}
          title={`Delete ${entityLabel.toLowerCase()}?`}
          description={
            deleteWarning ??
            `"${recordName}" will be permanently removed. This cannot be undone.`
          }
          onConfirm={onDelete}
          onSuccess={() => {
            toast({ variant: "success", title: `${entityLabel} deleted` });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

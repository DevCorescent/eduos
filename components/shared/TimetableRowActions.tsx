"use client";

import { useRouter } from "next/navigation";
import { CalendarX2, CalendarCheck2, Pencil } from "lucide-react";
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

export interface TimetableRowActionsProps {
  /** The class this row is, named in every dialog. e.g. "CS101 · Mon 09:00". */
  recordName: string;
  fields: FormField[];
  values: FormValues;
  /** Pre-bound, e.g. `rescheduleClassAction.bind(null, slot.id)`. */
  onReschedule: (values: FormValues) => Promise<ActionResult>;
  /** Whether the class is currently on the timetable. Decides which action shows. */
  isActive: boolean;
  /** Pre-bound cancel — used when `isActive`. */
  onCancel: () => Promise<ActionResult>;
  /** Pre-bound restore — used when the class is already cancelled. */
  onRestore: () => Promise<ActionResult>;
}

/**
 * Per-row reschedule and cancel controls for a timetable slot.
 *
 * WHY NOT EntityRowActions
 *   It is the right component for a CRUD row and this is not one. Its second
 *   action is a delete: a trash icon, a "Delete class?" dialog, a "permanently
 *   removed. This cannot be undone" description, and a "Class deleted" toast.
 *   None of that is true here — cancelling a class flips `isActive`, the row
 *   survives because Attendance references it, and the action is reversible
 *   from this very menu. Passing a cancel through a control labelled delete
 *   would tell the user their attendance history was about to be destroyed.
 *
 *   It also has no third state. A cancelled class needs RESTORE where a live
 *   one needs cancel, which is one button with two meanings — expressible here
 *   and not there.
 *
 * Everything else is deliberately identical to EntityRowActions: the same
 * primitives, the same icon-button styling, the same per-row dialog ownership
 * (so a list re-ordering between opening and confirming cannot retarget the
 * action), the same toast-then-refresh on success, and the same pre-bound
 * server actions so the slot id never exists in the client payload as a
 * mutable value.
 */
export function TimetableRowActions({
  recordName,
  fields,
  values,
  onReschedule,
  isActive,
  onCancel,
  onRestore,
}: TimetableRowActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const editModal = useDisclosure();
  const statusModal = useDisclosure();

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={editModal.open}
        aria-label={`Reschedule ${recordName}`}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={statusModal.open}
        aria-label={`${isActive ? "Cancel" : "Restore"} ${recordName}`}
        className={
          isActive
            ? "rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        {isActive ? (
          <CalendarX2 className="size-4" aria-hidden="true" />
        ) : (
          <CalendarCheck2 className="size-4" aria-hidden="true" />
        )}
      </button>

      {/* Mounted only while open, so the values reseed on every open rather than
          being reset from an effect — see EntityFormModal for why that matters
          when a second row is edited. */}
      {editModal.isOpen && (
        <EntityFormModal
          isOpen
          onClose={editModal.close}
          title="Reschedule class"
          description={recordName}
          fields={fields}
          initialValues={values}
          submitLabel="Save changes"
          size="lg"
          onSubmit={onReschedule}
          onSuccess={() => {
            toast({ variant: "success", title: "Class rescheduled" });
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={statusModal.isOpen}
        onClose={statusModal.close}
        title={isActive ? "Cancel this class?" : "Restore this class?"}
        description={
          isActive
            ? `"${recordName}" will be removed from student and faculty timetables, and everyone affected will be notified. Attendance already recorded against it is kept, and the class can be restored later.`
            : `"${recordName}" will be put back on student and faculty timetables, and everyone affected will be notified. It will be refused if another class has taken the period in the meantime.`
        }
        confirmLabel={isActive ? "Cancel class" : "Restore class"}
        // Restoring is not destructive, so it does not get the destructive
        // button. Cancelling does — it takes a class off a whole section's
        // timetable, even though the row itself survives.
        destructive={isActive}
        onConfirm={isActive ? onCancel : onRestore}
        onSuccess={() => {
          toast({
            variant: "success",
            title: isActive ? "Class cancelled" : "Class restored",
          });
          router.refresh();
        }}
      />
    </div>
  );
}

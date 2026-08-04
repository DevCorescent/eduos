"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/providers/ToastProvider";
import { assignRoleAction, unassignRoleAction } from "@/actions/users";
import { roleLabel } from "@/constants/roles";

interface RoleRef {
  id: string;
  name: string;
}

export interface UserRolesPanelProps {
  userId: string;
  userName: string;
  assignedRoles: RoleRef[];
  allRoles: RoleRef[];
}

/**
 * Grant and revoke a user's roles.
 *
 * Kept out of the edit dialog on purpose. A role change is a one-click write
 * against its own endpoint — POST/DELETE /api/users/[id]/roles — not a field on
 * the user record, and routing it through a form would make the commonest
 * administrative action a four-step one.
 *
 * `pendingRoleId` tracks which specific chip is being revoked rather than a
 * single boolean, so only that chip shows a pending state. One shared flag
 * would grey out every chip on the panel for a change to one of them.
 */
export function UserRolesPanel({
  userId,
  userName,
  assignedRoles,
  allRoles,
}: UserRolesPanelProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const assignedIds = new Set(assignedRoles.map((role) => role.id));
  // Already-held roles are excluded rather than shown and rejected — offering a
  // choice whose only outcome is a 409 is not a choice.
  const available = allRoles.filter((role) => !assignedIds.has(role.id));

  async function handleAssign() {
    if (!selectedRoleId) return;

    setIsAssigning(true);
    const result = await assignRoleAction(userId, selectedRoleId);
    setIsAssigning(false);

    if (!result.success) {
      toast({ variant: "error", title: "Couldn't assign role", description: result.error });
      return;
    }

    toast({ variant: "success", title: "Role assigned" });
    setSelectedRoleId("");
    router.refresh();
  }

  async function handleUnassign(roleId: string, name: string) {
    setPendingRoleId(roleId);
    const result = await unassignRoleAction(userId, roleId);
    setPendingRoleId(null);

    if (!result.success) {
      toast({ variant: "error", title: "Couldn't remove role", description: result.error });
      return;
    }

    toast({ variant: "success", title: `${roleLabel(name)} removed` });
    router.refresh();
  }

  return (
    <Card header={<h2 className="text-sm font-semibold text-heading">Roles</h2>}>
      {assignedRoles.length === 0 ? (
        <Alert variant="warning" title="No roles assigned">
          {userName} can sign in but will not be able to reach any module.
        </Alert>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {assignedRoles.map((role) => (
            <li key={role.id}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-1 text-sm">
                <span className="text-foreground">{roleLabel(role.name)}</span>
                <button
                  type="button"
                  onClick={() => handleUnassign(role.id, role.name)}
                  disabled={pendingRoleId === role.id}
                  aria-label={`Remove ${roleLabel(role.name)} from ${userName}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-danger-bg hover:text-danger disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-border pt-4">
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {userName} holds every role defined in this university.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              containerClassName="flex-1"
              label="Add a role"
              value={selectedRoleId}
              onChange={setSelectedRoleId}
              placeholder="Select a role"
              options={available.map((role) => ({
                value: role.id,
                label: roleLabel(role.name),
              }))}
            />
            <Button
              onClick={handleAssign}
              disabled={!selectedRoleId}
              isLoading={isAssigning}
              leftIcon={<Plus className="size-4" />}
            >
              Assign
            </Button>
          </div>
        )}
      </div>

      {assignedRoles.length > 1 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Holding several roles grants the union of their permissions.{" "}
          <Badge variant="neutral" size="sm">
            {assignedRoles.length} roles
          </Badge>
        </p>
      )}
    </Card>
  );
}

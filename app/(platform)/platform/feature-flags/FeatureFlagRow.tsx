"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { updateFeatureFlagsAction } from "@/actions/platform";

/**
 * One tenant's feature flags.
 *
 * The stored value is untyped JSON, so a key may hold anything. Only booleans
 * are editable here — a switch cannot honestly represent a string or a nested
 * object, and silently coercing one to `true` would destroy a value the
 * platform may be reading. Non-boolean keys are therefore shown read-only and
 * passed through untouched on save.
 *
 * Save sends the WHOLE map because PATCH replaces the column rather than
 * merging into it. Sending one changed key would delete every other flag.
 */
export function FeatureFlagRow({
  subscriptionId,
  tenantName,
  plan,
  features,
  knownFlags,
}: {
  subscriptionId: string;
  tenantName: string;
  plan: string;
  features: Record<string, unknown>;
  knownFlags: string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, unknown>>(features);
  const [newFlag, setNewFlag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Every flag this row could show: the ones it holds, plus the ones its peers
  // hold. A flag absent from the map is off, which is the same as false.
  const flags = Array.from(new Set([...Object.keys(draft), ...knownFlags])).sort();

  const isDirty = JSON.stringify(draft) !== JSON.stringify(features);

  function toggle(flag: string, value: boolean) {
    setSaved(false);
    setDraft((current) => ({ ...current, [flag]: value }));
  }

  function addFlag() {
    const key = newFlag.trim();
    if (key === "" || key in draft) return;

    setSaved(false);
    setDraft((current) => ({ ...current, [key]: true }));
    setNewFlag("");
  }

  async function save() {
    setError(null);
    setSaved(false);
    setIsSaving(true);

    const result = await updateFeatureFlagsAction(subscriptionId, draft);

    setIsSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {tenantName}
        </h3>
        <Badge variant="neutral" size="sm">
          {plan}
        </Badge>
      </div>

      {flags.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No flag is set for this tenant. Add one below.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flags.map((flag) => {
            const value = draft[flag];
            const isBoolean = typeof value === "boolean" || value === undefined;

            return (
              <div key={flag} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {flag}
                </span>
                {isBoolean ? (
                  <Switch
                    checked={value === true}
                    onChange={(event) => toggle(flag, event.target.checked)}
                    aria-label={`${flag} for ${tenantName}`}
                  />
                ) : (
                  // Read-only for the reason in the component doc: a switch
                  // cannot represent this value, and writing one would lose it.
                  <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
                    {JSON.stringify(value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Input
          aria-label="New flag name"
          placeholder="new_flag_name"
          value={newFlag}
          onChange={(event) => setNewFlag(event.target.value)}
          className="w-48"
        />
        <Button variant="secondary" size="sm" onClick={addFlag} disabled={newFlag.trim() === ""}>
          <Plus className="mr-1 size-4" aria-hidden="true" />
          Add
        </Button>
        <Button size="sm" onClick={save} isLoading={isSaving} disabled={!isDirty}>
          Save
        </Button>
      </div>

      {error && (
        <Alert variant="error" className="mt-3">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert variant="success" className="mt-3">
          Flags saved.
        </Alert>
      )}
    </div>
  );
}

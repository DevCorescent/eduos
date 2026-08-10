"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Blocks } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { Badge } from "@/components/ui/Badge";
import { StateView } from "@/components/shared/StateView";
import { useToast } from "@/providers/ToastProvider";
import { updateTenantModules, type TenantModules } from "@/services/tenants";

export interface TenantModulesPanelProps {
  tenantId: string;
  data: TenantModules | null;
  error: string | null;
}

/**
 * PRD §5.1 "Assign enabled modules" / §2.1 "Module allocation", over the §57
 * catalogue.
 *
 * THE CATALOGUE COMES FROM THE SERVER
 *   `data.catalogue` is rendered as given rather than hard-coded here, so the
 *   PRD list lives in exactly one place (lib/constants/modules.ts) and this
 *   screen cannot drift from what the API will accept.
 *
 * WHAT THE BANNER SAYS, AND WHY IT SAYS IT
 *   Selection persists; nothing yet READS it. The PRD names module allocation
 *   in §2.1, §5.1 and §57 and nowhere defines what a disabled module does — no
 *   hidden navigation, no refusal, no redirect — so no such behaviour was
 *   invented. A switch that silently does nothing while looking authoritative
 *   is worse than one that says what it is, so the panel says it.
 *
 * ALWAYS-ON MODULES ARE SHOWN, NOT HIDDEN
 *   §57 lists Dashboard and Settings among the University Administration areas.
 *   They are rendered as fixed rather than dropped, so the catalogue on screen
 *   matches the catalogue in the PRD.
 */
export function TenantModulesPanel({ tenantId, data, error }: TenantModulesPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, boolean>>(data?.modules ?? {});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (error || !data) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-heading">Enabled modules</h2>
        <StateView state="error" subject="modules" message={error ?? undefined} className="mt-3" />
      </Card>
    );
  }

  const { catalogue, unknown } = data;
  const unknownKeys = Object.keys(unknown);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(data.modules);
  const enabledCount = catalogue.filter((m) => m.alwaysOn || draft[m.key]).length;

  async function save() {
    setSaveError(null);
    setIsSaving(true);

    // Always-on modules are sent as true rather than omitted, so the stored map
    // states the full selection instead of leaving it to be inferred.
    const payload: Record<string, boolean> = {};
    for (const entry of catalogue) {
      payload[entry.key] = entry.alwaysOn ? true : Boolean(draft[entry.key]);
    }

    const result = await updateTenantModules(tenantId, payload);
    setIsSaving(false);

    if (!result.success) {
      setSaveError(result.error);
      return;
    }

    toast({ variant: "success", title: "Modules updated" });
    router.refresh();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-heading">Enabled modules</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The university areas this institution is subscribed to.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {enabledCount} of {catalogue.length} enabled
        </p>
      </div>

      {/* Stated plainly rather than implied. See the component header. */}
      <Alert variant="info" className="mt-3">
        Selection is stored on the subscription. Nothing in the product reads it yet — the
        specification defines module allocation but not what disabling one does, so no
        enforcement has been assumed.
      </Alert>

      {saveError && (
        <Alert variant="error" className="mt-3">
          {saveError}
        </Alert>
      )}

      {unknownKeys.length > 0 && (
        <Alert variant="warning" className="mt-3">
          {unknownKeys.length === 1 ? "One stored key is" : `${unknownKeys.length} stored keys are`}{" "}
          not in the catalogue and {unknownKeys.length === 1 ? "is" : "are"} shown here for
          visibility: <span className="font-mono">{unknownKeys.join(", ")}</span>. They are kept
          untouched when you save, and are not modules.
        </Alert>
      )}

      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {catalogue.map((entry) => (
          <div key={entry.key} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{entry.label}</p>
              <p className="font-mono text-xs text-muted-foreground">{entry.prdSection}</p>
            </div>

            {entry.alwaysOn ? (
              <Badge variant="neutral" size="sm" withDot={false}>
                Always on
              </Badge>
            ) : (
              <Switch
                checked={Boolean(draft[entry.key])}
                onChange={(e) =>
                  setDraft((current) => ({ ...current, [entry.key]: e.target.checked }))
                }
                aria-label={entry.label}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={save}
          isLoading={isSaving}
          disabled={!isDirty}
          leftIcon={<Blocks className="size-4" />}
        >
          Save modules
        </Button>
        {isDirty && <p className="text-xs text-muted-foreground">Unsaved changes.</p>}
      </div>
    </Card>
  );
}

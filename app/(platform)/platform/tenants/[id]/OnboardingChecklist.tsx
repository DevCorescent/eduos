"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateView } from "@/components/shared/StateView";
import { useToast } from "@/providers/ToastProvider";
import {
  clearOnboardingStage,
  markOnboardingStage,
  type OnboardingProgress,
  type OnboardingStageStatus,
} from "@/services/tenants";
import { formatDateTime } from "@/utils/format";

export interface OnboardingChecklistProps {
  tenantId: string;
  progress: OnboardingProgress | null;
  /** The list request's failure message, when it failed. */
  error: string | null;
}

/**
 * PRD §5.1 "Track onboarding progress" and "University readiness checklist",
 * over the twelve §49.1 stages.
 *
 * TWO SIGNALS PER ROW, AND THEY ARE NOT THE SAME SIGNAL
 *   The tick is what an operator SIGNED OFF. The evidence line is what the
 *   DATABASE can prove. They are shown side by side because the interesting
 *   case is when they disagree: a ticked "User Creation" on a university with
 *   no administrator is exactly the situation a checklist exists to surface,
 *   and a single green row would hide it.
 *
 *   Stages the product cannot observe — Commercial Approval, Training, UAT,
 *   and Data Import until W1.6 builds it — say so rather than showing a
 *   confident grey tick. A checklist that claims to have verified something it
 *   cannot is worse than one that admits the limit.
 *
 * Optimistic state is deliberately NOT used: every mutation returns the whole
 * recomputed progress object, because ticking Go Live changes what other rows
 * say about themselves. Guessing locally would show a stale checklist.
 */
export function OnboardingChecklist({ tenantId, progress, error }: OnboardingChecklistProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [current, setCurrent] = useState<OnboardingProgress | null>(progress);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle(row: OnboardingStageStatus) {
    setActionError(null);
    setPendingStage(row.stage);

    const result = row.completed
      ? await clearOnboardingStage(tenantId, row.stage)
      : await markOnboardingStage(tenantId, row.stage);

    setPendingStage(null);

    if (!result.success) {
      setActionError(result.error);
      return;
    }

    // The server's recomputed view replaces local state wholesale.
    setCurrent(result.data);
    toast({
      variant: "success",
      title: row.completed ? `${row.label} cleared` : `${row.label} recorded`,
    });
    // Refreshes the rest of the page — the status badge and admin panel read
    // the same underlying facts this checklist reports on.
    router.refresh();
  }

  if (error || !current) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-heading">Onboarding</h2>
        <div className="mt-3">
          <StateView state="error" subject="onboarding progress" message={error ?? undefined} />
        </div>
      </Card>
    );
  }

  const { stages, completedCount, totalCount, dataReady } = current;
  const percent = Math.round((completedCount / totalCount) * 100);
  const blocking = stages.filter((s) => s.evidence === false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-heading">Onboarding progress</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The twelve stages of the university onboarding workflow.
          </p>
        </div>
        <p className="text-sm font-medium text-foreground">
          {completedCount} of {totalCount} signed off
        </p>
      </div>

      {/* A plain proportional bar. aria-hidden because the count above already
          states the same thing in text, and a screen reader should hear it once. */}
      <div
        aria-hidden="true"
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${percent}%` }} />
      </div>

      {actionError && (
        <Alert variant="error" className="mt-4">
          {actionError}
        </Alert>
      )}

      {!dataReady && (
        <Alert variant="warning" className="mt-4">
          {blocking.length === 1
            ? `Not ready: ${blocking[0].label.toLowerCase()} is incomplete.`
            : `Not ready: ${blocking.length} stages are incomplete in the data, whatever is signed off below.`}
        </Alert>
      )}

      <ul className="mt-4 divide-y divide-border">
        {stages.map((row) => (
          <li key={row.stage} className="flex items-start gap-3 py-3">
            <EvidenceIcon evidence={row.evidence} />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.evidenceDetail}</p>
              {row.completed && row.completedAt && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Signed off {formatDateTime(row.completedAt)}
                  {row.note ? ` — ${row.note}` : ""}
                </p>
              )}
            </div>

            <Button
              variant={row.completed ? "ghost" : "secondary"}
              size="sm"
              isLoading={pendingStage === row.stage}
              onClick={() => toggle(row)}
            >
              {row.completed ? "Clear" : "Mark done"}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The evidence state, as an icon.
 *
 * Three states, three glyphs — never colour alone, which would carry no meaning
 * to a reader who cannot distinguish them.
 */
function EvidenceIcon({ evidence }: { evidence: boolean | null }) {
  if (evidence === true) {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-bg-foreground">
        <Check className="size-3.5" aria-label="Verified in the data" />
      </span>
    );
  }

  if (evidence === false) {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-bg-foreground">
        <AlertTriangle className="size-3.5" aria-label="Not done" />
      </span>
    );
  }

  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Minus className="size-3.5" aria-label="Cannot be verified automatically" />
    </span>
  );
}

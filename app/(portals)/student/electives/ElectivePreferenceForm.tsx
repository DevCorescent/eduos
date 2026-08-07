"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Library, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/layout/EmptyState";
import { submitPreferencesAction } from "@/actions/electives";
import type { PreferenceDto, StudentOfferingDto } from "@/lib/dto/openElective.dto";

/**
 * The upper bound the API enforces on a preference list.
 *
 * Mirrored here so the UI stops the student at the limit rather than letting
 * them build a list the server will reject wholesale — losing the ordering they
 * just spent time on.
 */
const MAX_PREFERENCES = 10;

/**
 * Rank open electives by preference.
 *
 * Ranks are POSITIONAL: the order of `chosen` is the order submitted, as 1..n
 * with no gaps. The API rejects a non-contiguous or duplicated ranking outright,
 * so the list is the single source of the ranks and no per-row rank input
 * exists to disagree with it.
 *
 * Ineligible offerings are shown, not hidden, and carry the reason the backend
 * gave. A student who cannot see an elective they expected has no way to tell a
 * missing offering from an eligibility rule they did not know about.
 */
export function ElectivePreferenceForm({
  semesterId,
  offerings,
  existing,
  isEditable,
}: {
  semesterId: string;
  offerings: StudentOfferingDto[];
  existing: PreferenceDto[];
  isEditable: boolean;
}) {
  const router = useRouter();

  // Seeded from what is on record, in rank order, so re-opening the page shows
  // the choices as they stand rather than an empty list.
  const [chosen, setChosen] = useState<string[]>(() =>
    [...existing]
      .sort((a, b) => a.preferenceRank - b.preferenceRank)
      .map((preference) => preference.offeringId)
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const byId = new Map(offerings.map((offering) => [offering.id, offering]));
  const available = offerings.filter((offering) => !chosen.includes(offering.id));

  function add(offeringId: string) {
    setSaved(false);
    setChosen((current) =>
      current.length >= MAX_PREFERENCES ? current : [...current, offeringId]
    );
  }

  function remove(offeringId: string) {
    setSaved(false);
    setChosen((current) => current.filter((id) => id !== offeringId));
  }

  function move(index: number, direction: -1 | 1) {
    setSaved(false);
    setChosen((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    setSaved(false);
    setIsSubmitting(true);

    const result = await submitPreferencesAction(
      semesterId,
      // Rank is derived from position at the moment of submission — see the
      // component doc for why there is no per-row rank field.
      chosen.map((offeringId, index) => ({ offeringId, preferenceRank: index + 1 }))
    );

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        header={
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-heading">Your choices</h2>
            <span className="text-xs text-muted-foreground">
              {chosen.length} of {MAX_PREFERENCES}
            </span>
          </div>
        }
        noPadding
      >
        {chosen.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Library />}
              title="Nothing chosen yet"
              description="Add electives from the list, then order them with the most wanted first."
            />
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {chosen.map((offeringId, index) => {
              const offering = byId.get(offeringId);

              return (
                <li key={offeringId} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {offering?.course.name ?? offeringId}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {offering?.course.code} · {offering?.offeringDepartmentName}
                    </p>
                  </div>
                  {isEditable && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${offering?.course.name ?? "choice"} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${offering?.course.name ?? "choice"} down`}
                        disabled={index === chosen.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${offering?.course.name ?? "choice"}`}
                        onClick={() => remove(offeringId)}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {isEditable && (
          <div className="border-t border-border px-5 py-4">
            {error && (
              <Alert variant="error" className="mb-3">
                {error}
              </Alert>
            )}
            {saved && (
              <Alert variant="success" className="mb-3">
                Your choices have been recorded.
              </Alert>
            )}
            <Button
              onClick={handleSubmit}
              isLoading={isSubmitting}
              disabled={chosen.length === 0}
            >
              Save choices
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Saving replaces every choice previously on record for this semester.
            </p>
          </div>
        )}
      </Card>

      <Card
        header={<h2 className="text-sm font-semibold text-heading">Available electives</h2>}
        noPadding
      >
        {available.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Every elective on offer is already in your list.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {available.map((offering) => (
              <li key={offering.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{offering.course.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {offering.course.code} · {offering.offeringDepartmentName} ·{" "}
                    {offering.course.credits} credits
                  </p>
                  {/* The reason, not just the refusal — see the component doc. */}
                  {!offering.isEligible && offering.ineligibilityReasons.length > 0 && (
                    <p className="mt-1 text-xs text-warning">
                      {offering.ineligibilityReasons.join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={offering.isFull ? "danger" : "neutral"}
                    size="sm"
                  >
                    {offering.seatsRemaining} left
                  </Badge>
                  {isEditable && (
                    <Button
                      variant="secondary"
                      size="sm"
                      // Full and ineligible are different refusals with the same
                      // effect here; both are stated above rather than implied.
                      disabled={
                        !offering.isEligible ||
                        offering.isFull ||
                        !offering.acceptsPreferences ||
                        chosen.length >= MAX_PREFERENCES
                      }
                      onClick={() => add(offering.id)}
                    >
                      Add
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

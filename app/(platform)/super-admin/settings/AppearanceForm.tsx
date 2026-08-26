"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { updateOwnPlatformProfile } from "@/services/platformUsers";
import {
  PLATFORM_ACCENTS,
  PLATFORM_ACCENT_LABELS,
  PLATFORM_ACCENT_SWATCHES,
  type PlatformAccent,
} from "@/lib/constants/platformAccent";

/**
 * Choose the console accent for the signed-in operator.
 *
 * A RADIO GROUP, NOT A ROW OF BUTTONS
 *   Picking one of six mutually exclusive options is what radios are for, and
 *   using them means the browser supplies the semantics and the keyboard
 *   behaviour: arrow keys move between options, Space selects, the group is one
 *   tab stop, and a screen reader announces "Blue, radio button, 2 of 6,
 *   selected". None of that has to be reimplemented, and none of it can drift.
 *
 * SELECTION IS NEVER SIGNALLED BY COLOUR ALONE
 *   Each option carries a swatch, a text label, a ring on the selected card and
 *   a check mark inside the selected swatch. Somebody who cannot distinguish
 *   the swatches still has the label, the ring, the tick and the radio's own
 *   checked state. The swatch is the illustration, not the message.
 *
 * The preference is saved to the operator's own PlatformUser row, so it is the
 * database and not this component that remembers it — it survives a refresh, a
 * new session and a different browser. The subject is never sent: the route
 * resolves it from the platform session.
 */
export function AppearanceForm({ initialAccent }: { initialAccent: PlatformAccent }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<PlatformAccent>(initialAccent);

  function choose(accent: PlatformAccent) {
    if (accent === selected || pending) return;

    // Optimistic only for the radio's own checked state, so the control does
    // not feel dead while the request is in flight. The accent itself is
    // repainted by the server on refresh() below — this component never writes
    // a CSS variable, because the layout owns that and reads it from the row.
    setSelected(accent);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await updateOwnPlatformProfile({ accentColor: accent });

      if (!result.success) {
        // Put the control back where it was — leaving it on a value that was
        // not saved would misreport the account.
        setSelected(initialAccent);
        setError(result.error);
        return;
      }

      setSaved(true);
      // Re-reads the layout, which resolves the accent from the row and swaps
      // the data attribute. This is what makes the change visible immediately
      // without this component touching a style.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      {saved && !error && (
        <Alert variant="success" role="status">
          Your console accent has been updated.
        </Alert>
      )}

      <fieldset disabled={pending} className="min-w-0">
        <legend className="sr-only">Console accent colour</legend>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PLATFORM_ACCENTS.map((accent) => {
            const isSelected = selected === accent;

            return (
              <label
                key={accent}
                className={[
                  "relative flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all",
                  // The ring is a second, non-colour signal of selection, and it
                  // uses the border/ring tokens rather than the accent so the
                  // indicator stays legible whichever accent is active.
                  isSelected
                    ? "border-primary ring-2 ring-ring ring-offset-1 ring-offset-background"
                    : "border-border hover:bg-muted",
                  pending && "opacity-60",
                  // Focus lands on the visually hidden input; this lifts the
                  // indicator onto the card the user actually sees.
                  "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input
                  type="radio"
                  name="platform-accent"
                  value={accent}
                  checked={isSelected}
                  onChange={() => choose(accent)}
                  // sr-only rather than hidden: a hidden input is not focusable,
                  // which would take the whole group off the keyboard.
                  className="sr-only"
                />

                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border"
                  style={{ backgroundColor: PLATFORM_ACCENT_SWATCHES[accent] }}
                >
                  {isSelected && <Check className="size-3.5 text-white" strokeWidth={3} />}
                </span>

                <span className="min-w-0 truncate text-sm text-foreground">
                  {PLATFORM_ACCENT_LABELS[accent]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Applies to your platform console only. Other operators and every
        university portal are unaffected.
      </p>
    </div>
  );
}

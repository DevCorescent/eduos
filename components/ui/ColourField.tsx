"use client";

import { Input } from "@/components/ui/Input";
import { swatchFor } from "@/lib/utils/colour";

/**
 * A colour, chosen visually or typed as hex.
 *
 * WHY BOTH CONTROLS AND NOT JUST A PICKER
 *   A brand guideline specifies an exact value — "#1D4ED8, exactly" — and
 *   nudging a gradient until the readout matches is not how anyone enters a
 *   known colour. The text box stays the source of truth and keeps the label,
 *   the placeholder and the validation error the form already had; the picker
 *   is added beside it for choosing a colour you do NOT already know.
 *
 * WHY THE PICKER'S VALUE IS DERIVED RATHER THAN STORED
 *   <input type="color"> speaks only #rrggbb. It cannot represent an empty
 *   field or the three-digit #abc that this project's HEX_COLOUR regex — and
 *   therefore the branding API — accepts. Feeding it a value it cannot parse
 *   makes it silently show black, so `swatch` below expands #abc to #aabbcc for
 *   DISPLAY and falls back to a neutral grey when the field is empty or invalid.
 *
 *   That derivation never travels back to the form. Typing #abc leaves #abc
 *   stored and #abc saved: the picker showing an expanded form of it does not
 *   rewrite what the operator entered, because silently normalising a value the
 *   backend already accepts would change what they chose without telling them.
 *   Only actually USING the picker writes a value, and that value is the
 *   six-digit one the control produces.
 *
 * Mirrors ColorControl in components/cms/fieldControls.tsx, which established
 * this swatch-plus-hex pattern for the CMS editor.
 */
export function ColourField({
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}) {
  // Display only — see the header above. Never written back to the form.
  const swatch = swatchFor(value);

  return (
    <div className="flex items-end gap-2">
      <input
        type="color"
        value={swatch}
        // The text box carries the visible <label>; this control needs its own
        // accessible name, and "Primary colour" alone would announce two
        // controls identically.
        aria-label={`${label} — colour picker`}
        onChange={(event) => onChange(event.target.value)}
        className="mb-px size-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      {/* The project's own Input, so the label association, the error slot and
          the field styling are the ones this form already used. */}
      <Input
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        placeholder={placeholder}
        spellCheck={false}
        containerClassName="min-w-0 flex-1"
      />
    </div>
  );
}


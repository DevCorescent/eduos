"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { updateBrandingAction } from "@/actions/branding";
import { isValidBrandColour, isSafeAssetUrl } from "@/lib/domain/tenant/branding";
import type { TenantBrandingRow } from "@/services/branding";

/**
 * The branding form and its live preview (PRD §45).
 *
 * A CLIENT COMPONENT BECAUSE THE PREVIEW IS THE POINT
 *   A colour picked without seeing it is picked blind, and branding is the one
 *   setting whose effect is entirely visual. The swatches below update as the
 *   reader types, using the SAME validator the server and the renderer use — so
 *   a value the preview refuses is a value that would have been dropped, and
 *   the reader finds out now rather than after saving.
 *
 * VALIDATION HERE IS A COURTESY, NOT THE DEFENCE
 *   The API validates independently with the identical predicates. This exists
 *   so the reader gets an answer without a round trip, never as the thing that
 *   keeps a brace out of a stylesheet.
 */
export function BrandingForm({ branding }: { branding: TenantBrandingRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [values, setValues] = useState({
    logoUrl: branding.logoUrl ?? "",
    faviconUrl: branding.faviconUrl ?? "",
    primaryColor: branding.primaryColor ?? "",
    accentColor: branding.accentColor ?? "",
  });

  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setValues((current) => ({ ...current, [key]: event.target.value }));
  };

  // Empty is valid — it clears the field and returns to the design system.
  const colourError = (value: string) =>
    value.trim() === "" || isValidBrandColour(value)
      ? undefined
      : "Use a hex colour such as #1A73E8.";

  const urlError = (value: string) =>
    value.trim() === "" || isSafeAssetUrl(value)
      ? undefined
      : "Use an https:// address or a path beginning with /.";

  const hasBlockingError = Boolean(
    colourError(values.primaryColor) ||
      colourError(values.accentColor) ||
      urlError(values.logoUrl) ||
      urlError(values.faviconUrl)
  );

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);

        startTransition(async () => {
          const result = await updateBrandingAction(values);
          if (result.success) {
            setSaved(true);
            // Re-runs the Server Component tree, so the new brand colours reach
            // the root layout and the whole shell repaints.
            router.refresh();
            return;
          }
          // The button comes back either way — a control left disabled after a
          // failure is indistinguishable from one still working.
          setError(result.error ?? "That did not save. Try again in a moment.");
        });
      }}
    >
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}
      {saved && <Alert variant="success">Branding saved.</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Input
            label="Logo URL"
            value={values.logoUrl}
            onChange={set("logoUrl")}
            error={urlError(values.logoUrl)}
            helperText="Shown in the sidebar and on the sign-in screen. Leave empty to use the eduOS mark."
            placeholder="https://cdn.university.edu/logo.svg"
          />
          <Input
            label="Favicon URL"
            value={values.faviconUrl}
            onChange={set("faviconUrl")}
            error={urlError(values.faviconUrl)}
            helperText="The browser-tab icon for every page on your domain."
            placeholder="https://cdn.university.edu/favicon.ico"
          />
          <Input
            label="Primary colour"
            value={values.primaryColor}
            onChange={set("primaryColor")}
            error={colourError(values.primaryColor)}
            helperText="Hex only. Leave empty to use the eduOS palette."
            placeholder="#1A73E8"
          />
          <Input
            label="Accent colour"
            value={values.accentColor}
            onChange={set("accentColor")}
            error={colourError(values.accentColor)}
            helperText="Hex only."
            placeholder="#34A853"
          />
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-heading">Preview</p>

          <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              {values.logoUrl && isSafeAssetUrl(values.logoUrl) ? (
                /* eslint-disable-next-line @next/next/no-img-element --
                   next/image requires every remote host in an allow-list, and a
                   tenant's logo host is by definition unknown at build time.
                   This is one small logo in a preview panel. */
                <img
                  src={values.logoUrl}
                  alt=""
                  className="h-8 w-auto max-w-[10rem] object-contain"
                />
              ) : (
                <span className="text-sm text-muted-foreground">No logo set</span>
              )}
              <span className="font-semibold text-foreground">{branding.name}</span>
            </div>

            <div className="flex flex-wrap gap-3">
              <Swatch label="Primary" value={values.primaryColor} />
              <Swatch label="Accent" value={values.accentColor} />
            </div>

            <p className="text-xs text-muted-foreground">
              Your colours accent the interface. The rest of the palette stays as it is,
              so every screen remains legible whatever you choose.
            </p>
          </div>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={pending || hasBlockingError}>
          {pending ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </form>
  );
}

/** One colour chip. Only a validated value is ever used as a style. */
function Swatch({ label, value }: { label: string; value: string }) {
  const valid = isValidBrandColour(value);

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-8 rounded-md border border-border"
        style={valid ? { backgroundColor: value.trim() } : undefined}
      />
      <span className="text-xs text-muted-foreground">
        {label}
        {!valid && value.trim() !== "" && " (not applied)"}
      </span>
    </div>
  );
}

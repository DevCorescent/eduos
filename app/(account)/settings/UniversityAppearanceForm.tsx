"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ColourField } from "@/components/ui/ColourField";
import { updateMyBranding } from "@/services/branding";
import {
  UNIVERSITY_THEME_TOKENS,
  isThemeColour,
  type UniversityTheme,
  type UniversityThemeKey,
} from "@/lib/domain/tenant/theme";

/**
 * Let a University Admin choose their university's colours.
 *
 * WHAT THIS TOUCHES, AND WHAT IT CANNOT
 *   Six brand surfaces, and nothing else. There is no control here for success,
 *   warning, danger or info: those encode meaning rather than identity, and a
 *   university must not be able to make a failed payment read as a successful
 *   one. The set comes from UNIVERSITY_THEME_TOKENS, so the form cannot drift
 *   from what the API accepts or from what the stylesheet paints.
 *
 * DRAFT UNTIL SAVED
 *   Every change edits local state and the preview beside it. Nothing reaches
 *   the database until Save, so an administrator can try a colour, look at it,
 *   and walk away. Cancel restores what was last saved; Reset clears every
 *   token so the university returns to the product's own design system — which
 *   the API expresses as null per token, not as a separate endpoint.
 *
 * The portal around this form does NOT recolour as you type. That is
 *   deliberate: the preview is the thing being previewed, and repainting the
 *   chrome you are standing in makes it impossible to compare against what you
 *   currently have.
 */
export function UniversityAppearanceForm({ initial }: { initial: UniversityTheme }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<UniversityTheme>(initial);
  const [draft, setDraft] = useState<UniversityTheme>(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dirty = UNIVERSITY_THEME_TOKENS.some((t) => draft[t.key] !== saved[t.key]);

  // Mirrors the API's predicate, so the button is disabled for exactly the
  // values the server would refuse. The server validates independently.
  const invalid = UNIVERSITY_THEME_TOKENS.filter((t) => !isThemeColour(draft[t.key]));

  function set(key: UniversityThemeKey, value: string) {
    setDone(false);
    setError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function submit(next: UniversityTheme | null) {
    setError(null);
    setDone(false);

    startTransition(async () => {
      // null on every token is how "reset to the product default" is expressed:
      // clearing the stored value rather than writing the default back, so a
      // later change to the product's own palette still reaches this university.
      const body = next
        ? {
            primaryColor: next.primaryColor,
            accentColor: next.accentColor,
            theme: {
              sidebar: next.sidebar,
              sidebarText: next.sidebarText,
              sidebarActive: next.sidebarActive,
              header: next.header,
            },
          }
        : {
            primaryColor: null,
            accentColor: null,
            theme: { sidebar: null, sidebarText: null, sidebarActive: null, header: null },
          };

      const result = await updateMyBranding(body);

      if (!result.success) {
        setError(result.error);
        return;
      }

      const applied = next ?? defaultsOf();
      setSaved(applied);
      setDraft(applied);
      setDone(true);
      // Re-renders the portal shell, which re-reads the row and repaints the
      // real chrome. This is the moment the change becomes visible.
      router.refresh();
    });
  }

  function defaultsOf(): UniversityTheme {
    return Object.fromEntries(
      UNIVERSITY_THEME_TOKENS.map((t) => [t.key, t.fallback])
    ) as UniversityTheme;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      )}

      {done && !error && (
        <Alert variant="success" role="status">
          Your university&apos;s colours have been updated. Everyone at your university sees them.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          {UNIVERSITY_THEME_TOKENS.map((token) => (
            <div key={token.key}>
              <ColourField
                label={token.label}
                value={draft[token.key]}
                onChange={(value) => set(token.key, value)}
                error={
                  isThemeColour(draft[token.key])
                    ? undefined
                    : "Use a hex colour, such as #1d4ed8."
                }
                placeholder={token.fallback}
              />
              {/* Says what the colour paints. Read out with the field because
                  a colour name alone does not tell anyone what it changes. */}
              <p className="mt-1 text-xs text-muted-foreground">{token.description}</p>
            </div>
          ))}
        </div>

        <ThemePreview theme={draft} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          isLoading={pending}
          disabled={!dirty || invalid.length > 0}
          onClick={() => submit(draft)}
        >
          Save colours
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={pending || !dirty}
          onClick={() => {
            setDraft(saved);
            setError(null);
            setDone(false);
          }}
        >
          Cancel
        </Button>

        <Button type="button" variant="ghost" disabled={pending} onClick={() => submit(null)}>
          Reset to default
        </Button>
      </div>
    </div>
  );
}

/**
 * A miniature of the portal, painted with the draft.
 *
 * Uses the SAME custom properties the real shell consumes, set on this element
 * only — so what it shows is what the tokens actually do, and it cannot repaint
 * anything outside itself. An invalid draft value simply does not paint; the
 * field beside it is already showing the error.
 */
function ThemePreview({ theme }: { theme: UniversityTheme }) {
  const safe = (value: string, fallback: string) => (isThemeColour(value) ? value : fallback);

  const sidebar = safe(theme.sidebar, "#d1e2d3");
  const sidebarText = safe(theme.sidebarText, "#202d21");
  const sidebarActive = safe(theme.sidebarActive, "#ffffff");
  const header = safe(theme.header, "#ffffff");
  const primary = safe(theme.primaryColor, "#4a4e52");
  const accent = safe(theme.accentColor, "#55875b");

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-foreground" id="theme-preview-label">
        Preview
      </p>

      <div
        role="img"
        aria-labelledby="theme-preview-label"
        // A picture of a portal, not an interactive one — announced as an image
        // with a name so a screen reader does not walk a fake sidebar.
        aria-describedby="theme-preview-desc"
        className="overflow-hidden rounded-lg border border-border"
      >
        <div className="flex h-40">
          <div className="flex w-20 shrink-0 flex-col gap-1 p-2" style={{ background: sidebar }}>
            <span
              className="rounded px-1.5 py-1 text-[10px] font-medium"
              style={{ background: sidebarActive, color: sidebarText }}
            >
              Active
            </span>
            <span className="px-1.5 py-1 text-[10px] opacity-80" style={{ color: sidebarText }}>
              Students
            </span>
            <span className="px-1.5 py-1 text-[10px] opacity-80" style={{ color: sidebarText }}>
              Courses
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="h-7 border-b border-border" style={{ background: header }} />
            <div className="flex flex-1 flex-col gap-2 bg-surface p-3">
              <span
                className="w-fit rounded px-2 py-1 text-[10px] font-medium text-white"
                style={{ background: primary }}
              >
                Primary button
              </span>
              <span className="text-[10px]" style={{ color: primary }}>
                A link
              </span>
              <span
                className="h-1.5 w-12 rounded-full"
                style={{ background: accent }}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>

      <p id="theme-preview-desc" className="mt-1.5 text-xs text-muted-foreground">
        Sidebar, active navigation, header, button, link and accent. Nothing is saved until you
        choose Save.
      </p>
    </div>
  );
}

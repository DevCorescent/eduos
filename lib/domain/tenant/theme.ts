// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant — University theme
// LAYER  : Domain (pure)
// PURPOSE: The closed set of design tokens a University Admin may set for THEIR
//          university, and the single place that decides what a missing or
//          malformed value means.
//
// WHERE THIS LIVES, AND WHY NOTHING NEW WAS CREATED
//   Two of the six tokens are the EXISTING Tenant.primaryColor and
//   Tenant.accentColor columns — already written by the tenant branding API and
//   by the platform branding panel. They are reused, not duplicated.
//
//   The other four have no column. Rather than add four to Tenant, they live
//   under the EXISTING Tenant.settings JSON column, namespaced as
//   `settings.theme`. That column already exists, is already merged into by the
//   archive route and already accepted by platform tenant update, so this adds
//   a key to a general-purpose bag rather than a second branding system or a
//   second source of truth. No migration; see the report.
//
// WHY ONLY SIX TOKENS
//   "Do not blindly expose every CSS property." Each token below maps to a real
//   surface an administrator can point at — the sidebar, the item they are on,
//   the top bar, the buttons. Exposing the full token set would let a
//   university produce an unreadable portal and would make every future design
//   change a breaking one.
//
// WHAT A UNIVERSITY MAY NEVER SET
//   success, warning, danger/error and info. Those encode MEANING. A maroon
//   university must not be able to make a failed payment look like a successful
//   one. No token below maps to them, and the stylesheet block that consumes
//   these never mentions them — asserted by test.
// ============================================================================

/** A token an administrator may set. */
export interface UniversityThemeToken {
  /** Stable key. Two are columns; four live in Tenant.settings.theme. */
  readonly key: UniversityThemeKey;
  /** Shown beside the control. */
  readonly label: string;
  /** Read by a screen reader and shown as help text — says what it paints. */
  readonly description: string;
  /** The CSS custom property it feeds. */
  readonly cssVariable: string;
  /** Where it is stored. */
  readonly storage: "column" | "settings";
  /** Used when the university has set nothing. */
  readonly fallback: string;
}

export const UNIVERSITY_THEME_KEYS = [
  "primaryColor",
  "accentColor",
  "sidebar",
  "sidebarText",
  "sidebarActive",
  "header",
] as const;

export type UniversityThemeKey = (typeof UNIVERSITY_THEME_KEYS)[number];

/**
 * The tokens, in the order the Settings screen shows them.
 *
 * `fallback` is the product's own value, so a university that sets nothing gets
 * exactly the portal it has today — this feature is invisible until used.
 */
export const UNIVERSITY_THEME_TOKENS: readonly UniversityThemeToken[] = [
  {
    key: "primaryColor",
    label: "Primary colour",
    description: "Buttons, links and the main call to action across your portals.",
    cssVariable: "--university-primary",
    storage: "column",
    fallback: "#4a4e52",
  },
  {
    key: "accentColor",
    label: "Accent colour",
    description: "Highlights and secondary emphasis.",
    cssVariable: "--university-accent",
    storage: "column",
    fallback: "#55875b",
  },
  {
    key: "sidebar",
    label: "Sidebar background",
    description: "The navigation panel down the left of every portal.",
    cssVariable: "--university-sidebar",
    storage: "settings",
    fallback: "#d1e2d3",
  },
  {
    key: "sidebarText",
    label: "Sidebar text",
    description: "Navigation labels. Choose a colour that reads clearly on the sidebar.",
    cssVariable: "--university-sidebar-text",
    storage: "settings",
    fallback: "#202d21",
  },
  {
    key: "sidebarActive",
    label: "Active navigation",
    description: "The page a user is currently on.",
    cssVariable: "--university-sidebar-active",
    storage: "settings",
    fallback: "#ffffff",
  },
  {
    key: "header",
    label: "Header background",
    description: "The bar across the top of every portal.",
    cssVariable: "--university-header",
    storage: "settings",
    fallback: "#ffffff",
  },
] as const;

/** The four keys that live in Tenant.settings.theme rather than a column. */
export const THEME_SETTINGS_KEYS = UNIVERSITY_THEME_TOKENS.filter(
  (t) => t.storage === "settings"
).map((t) => t.key);

/** A resolved theme — every token present, so consumers never branch on null. */
export type UniversityTheme = Record<UniversityThemeKey, string>;

/**
 * The same predicate the branding API validates with: #rgb or #rrggbb.
 *
 * Anything else — a bare word, an rgb() call, a CSS fragment, a url() — is not
 * a colour this product stores. Restated here rather than imported from the
 * validation layer because this module is pure domain and must not depend on
 * Zod; the accompanying test asserts the two agree.
 */
export const THEME_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True when `value` is a colour this product will store and render. */
export function isThemeColour(value: unknown): value is string {
  return typeof value === "string" && THEME_HEX.test(value.trim());
}

/**
 * Build a complete theme from whatever the row holds.
 *
 * INPUT   : the two branding columns, and the raw Tenant.settings JSON.
 * RETURNS : every token, always. A value that is absent, null, the wrong type,
 *           or not a hex colour falls back to the product default — a theme can
 *           never break the portal that renders it, and a value that somehow
 *           reached the column cannot become CSS.
 *
 * Never throws. Never reads a key outside the closed set above, so unrelated
 * contents of Tenant.settings are ignored rather than interpreted.
 */
export function resolveUniversityTheme(input: {
  primaryColor?: string | null;
  accentColor?: string | null;
  settings?: unknown;
}): UniversityTheme {
  const stored = extractThemeSettings(input.settings);

  const resolved = {} as UniversityTheme;

  for (const token of UNIVERSITY_THEME_TOKENS) {
    const raw =
      token.storage === "column"
        ? (input[token.key as "primaryColor" | "accentColor"] ?? null)
        : stored[token.key];

    resolved[token.key] = isThemeColour(raw) ? raw.trim() : token.fallback;
  }

  return resolved;
}

/**
 * The `theme` object inside Tenant.settings, or an empty one.
 *
 * Defensive by design: settings is a free-form JSON column that other code
 * already writes to, so anything at all may be there.
 */
export function extractThemeSettings(settings: unknown): Partial<Record<string, unknown>> {
  if (typeof settings !== "object" || settings === null) return {};

  const theme = (settings as Record<string, unknown>).theme;
  if (typeof theme !== "object" || theme === null) return {};

  return theme as Record<string, unknown>;
}

/**
 * Merge a theme patch into an existing Tenant.settings value.
 *
 * READ-MERGE-WRITE, and that matters: Tenant.settings is shared. The archive
 * route writes an `archive` key into it and platform tenant update accepts a
 * whole settings object. Replacing the column would silently destroy those.
 * Everything outside `theme` is carried through untouched, and inside `theme`
 * only the keys being changed are touched.
 *
 * A null value REMOVES the key, which is how a university resets one token to
 * the product default — different from omitting it, which leaves it alone.
 */
export function mergeThemeIntoSettings(
  settings: unknown,
  patch: Partial<Record<string, string | null>>
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof settings === "object" && settings !== null
      ? { ...(settings as Record<string, unknown>) }
      : {};

  const theme: Record<string, unknown> = { ...extractThemeSettings(settings) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete theme[key];
      continue;
    }
    if (value !== undefined) theme[key] = value;
  }

  // An empty theme is removed rather than stored as {}, so "reset everything"
  // leaves the column as it was before this feature existed.
  if (Object.keys(theme).length === 0) {
    delete base.theme;
    return base;
  }

  base.theme = theme;
  return base;
}

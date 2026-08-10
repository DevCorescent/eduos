// ============================================================================
// MODULE : Constants — University module catalogue (W1.5)
// SOURCE : PRD §57 "Recommended Product Navigation" → University Administration
// PURPOSE: The closed set of modules a platform operator may enable for a
//          university (PRD §2.1 "Module allocation", §5.1 "Assign enabled
//          modules", §57 Central Super Admin → "Modules").
//
// WHY THIS IS A CONSTANT AND NOT A TABLE
//   The catalogue is a fixed list transcribed from a document. It is not tenant
//   data, nobody may add to it at runtime, and every entry corresponds to a
//   numbered PRD section that either exists in this product or does not. A
//   `Module` table would invite rows the PRD never named — which is exactly how
//   `{"jhjj": true}` ended up in Subscription.features.
//
// WHY THE KEYS ARE WHAT THEY ARE
//   Transcribed from §57's University Administration navigation, in §57's own
//   order, one key per entry. Nothing is added, renamed, merged or split. Two
//   entries — Dashboard and Settings — are included because §57 lists them, and
//   are marked alwaysOn: a university without a dashboard or settings screen is
//   not a configuration the PRD describes, and offering a switch that would
//   produce one would be inventing a capability.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DECIDE
//   What a DISABLED module does. The PRD names module allocation in three
//   places and nowhere states the effect of disabling one — no hidden
//   navigation, no 403, no 404, no redirect. That behaviour is therefore not
//   implemented and is recorded as the remaining half of GAP-01. This file
//   describes WHICH modules exist, not what switching one off means.
// ============================================================================

/** One entry of the PRD §57 University Administration navigation. */
export interface ModuleDefinition {
  /** Stored as a key in Subscription.features. Stable; never renamed. */
  readonly key: string;
  /** §57's own wording. */
  readonly label: string;
  /** The PRD section this module corresponds to, for traceability. */
  readonly prdSection: string;
  /**
   * Present for every university and not offered as a switch.
   *
   * Only for entries whose absence the PRD does not describe. This is not a
   * judgement about importance — Fees and Examinations are more important than
   * Settings, and both are switchable.
   */
  readonly alwaysOn?: boolean;
}

/**
 * PRD §57 → University Administration, verbatim and in order.
 *
 * The `prdSection` values are the numbered sections each navigation entry maps
 * to, so a reader can check any row against the source document.
 */
export const UNIVERSITY_MODULES: readonly ModuleDefinition[] = [
  { key: "dashboard", label: "Dashboard", prdSection: "§6", alwaysOn: true },
  { key: "admissions", label: "Admissions", prdSection: "§8" },
  { key: "students", label: "Students", prdSection: "§10" },
  { key: "academics", label: "Academics", prdSection: "§11, §12" },
  { key: "learning", label: "Learning", prdSection: "§14" },
  { key: "examinations", label: "Examinations", prdSection: "§17" },
  { key: "certificates", label: "Certificates", prdSection: "§19, §20" },
  { key: "fees", label: "Fees", prdSection: "§23" },
  { key: "finance", label: "Finance", prdSection: "§24" },
  { key: "faculty", label: "Faculty", prdSection: "§21" },
  { key: "employees", label: "Employees", prdSection: "§22" },
  { key: "research", label: "Research", prdSection: "§30" },
  { key: "placements", label: "Placements", prdSection: "§29" },
  { key: "alumni", label: "Alumni", prdSection: "§31" },
  { key: "library", label: "Library", prdSection: "§26" },
  { key: "hostel", label: "Hostel", prdSection: "§27" },
  { key: "transport", label: "Transport", prdSection: "§28" },
  { key: "inventory", label: "Inventory", prdSection: "§36" },
  { key: "procurement", label: "Procurement", prdSection: "§36, §37" },
  { key: "support", label: "Support", prdSection: "§38" },
  { key: "analytics", label: "Analytics", prdSection: "§41" },
  { key: "websiteCms", label: "Website CMS", prdSection: "§7" },
  { key: "settings", label: "Settings", prdSection: "§45", alwaysOn: true },
] as const;

/** Every catalogue key, for validation. */
export const MODULE_KEYS: readonly string[] = UNIVERSITY_MODULES.map((m) => m.key);

/** The keys an operator may actually toggle. */
export const TOGGLEABLE_MODULE_KEYS: readonly string[] = UNIVERSITY_MODULES.filter(
  (m) => !m.alwaysOn
).map((m) => m.key);

const MODULE_KEY_SET = new Set(MODULE_KEYS);

/** True when `key` is a PRD §57 module. */
export function isModuleKey(key: string): boolean {
  return MODULE_KEY_SET.has(key);
}

/**
 * Split a stored Subscription.features map into recognised modules and
 * everything else.
 *
 * `unknown` is returned rather than dropped, and that is the point. The column
 * predates the catalogue and holds keys nobody can account for — a real tenant
 * currently carries `{"jhjj": true}`. Silently discarding them on the next save
 * would destroy data the platform may be reading; silently promoting them to
 * modules would let a typo become an official capability. They are surfaced as
 * unrecognised and passed through untouched.
 */
export function partitionFeatures(features: Record<string, unknown> | null | undefined): {
  modules: Record<string, boolean>;
  unknown: Record<string, unknown>;
} {
  const modules: Record<string, boolean> = {};
  const unknown: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(features ?? {})) {
    if (isModuleKey(key)) {
      // Only a boolean is a module state. A string or object under a module key
      // is not coerced — it is preserved as unrecognised, because coercing it
      // would rewrite a value the platform may depend on.
      if (typeof value === "boolean") {
        modules[key] = value;
        continue;
      }
    }
    unknown[key] = value;
  }

  return { modules, unknown };
}
